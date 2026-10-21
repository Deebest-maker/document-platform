import { describe, expect, it } from "vitest";
import { zlibSync, deflateSync } from "fflate";
import {
  adler32,
  deflateZlib,
  inflateZlibBounded,
} from "../src/compress-inflate";
import { noiseSamples } from "./helpers/compress-fixtures";

const text = (value: string) => new TextEncoder().encode(value);

// Finds a payload whose Adler-32 ends in the given low-order bytes.
function payloadWithChecksum(
  matches: (checksum: number) => boolean,
): Uint8Array {
  for (let seed = 1; seed < 200_000; seed++) {
    const data = noiseSamples(300, seed);
    if (matches(adler32([data]))) return data;
  }
  throw new Error("no payload found");
}

describe("adler32", () => {
  it("matches the reference value", () => {
    expect(adler32([text("Wikipedia")])).toBe(0x11e60398);
    expect(adler32([text("Wiki"), text("pedia")])).toBe(0x11e60398);
    expect(adler32([])).toBe(1);
  });

  it("does not overflow on long, high-valued input", () => {
    const data = new Uint8Array(200_000).fill(255);
    expect(adler32([data])).toBe(
      adler32([data.subarray(0, 100_000), data.subarray(100_000)]),
    );
  });
});

describe("bounded zlib inflation", () => {
  it("round-trips and reports a valid trailer", () => {
    const original = noiseSamples(5000, 3);
    const result = inflateZlibBounded(zlibSync(original), 1_000_000);
    expect(result).toMatchObject({ ok: true, trailer: "valid" });
    if (result.ok) expect(result.bytes).toEqual(original);
  });

  it("handles empty and large outputs", () => {
    expect(inflateZlibBounded(zlibSync(new Uint8Array()), 10)).toMatchObject({
      ok: true,
    });
    const big = new Uint8Array(3_000_000);
    const result = inflateZlibBounded(zlibSync(big), 4_000_000);
    expect(result.ok && result.bytes.length).toBe(3_000_000);
  });

  it("stops at the byte limit (decompression bomb)", () => {
    const bomb = zlibSync(new Uint8Array(50_000_000));
    expect(bomb.length).toBeLessThan(100_000);
    expect(inflateZlibBounded(bomb, 1_000_000)).toEqual({
      ok: false,
      reason: "limit",
    });
    expect(inflateZlibBounded(bomb, 49_999_999)).toEqual({
      ok: false,
      reason: "limit",
    });
    expect(inflateZlibBounded(bomb, 50_000_000)).toMatchObject({ ok: true });
  });

  it("recognises a trailer shortened by one line-ending byte", () => {
    const data = payloadWithChecksum(
      (c) => (c & 0xff) === 0x0a || (c & 0xff) === 0x0d,
    );
    const full = zlibSync(data);
    const cut = full.subarray(0, full.length - 1);
    expect(inflateZlibBounded(full, 1e6)).toMatchObject({
      ok: true,
      trailer: "valid",
    });
    const result = inflateZlibBounded(cut, 1e6);
    expect(result).toMatchObject({ ok: true, trailer: "truncated" });
    if (result.ok) expect(result.bytes).toEqual(data);
  });

  it("recognises a trailer shortened by two line-ending bytes", () => {
    // The low 16 bits of Adler-32 are the byte sum plus one, so a short
    // payload with a chosen sum yields a checksum ending in two line endings.
    for (const target of [0x0a0a, 0x0a0d, 0x0d0a, 0x0d0d]) {
      const data = new Uint8Array(Math.ceil((target - 1) / 255));
      data.fill(255);
      data[data.length - 1] = target - 1 - 255 * (data.length - 1);
      expect(adler32([data]) & 0xffff).toBe(target);
      const full = zlibSync(data);
      const result = inflateZlibBounded(full.subarray(0, full.length - 2), 1e6);
      expect(result).toMatchObject({ ok: true, trailer: "truncated" });
      if (result.ok) expect(result.bytes).toEqual(data);
    }
  });

  it("does not excuse a missing byte that was not a line ending", () => {
    const data = payloadWithChecksum(
      (c) => (c & 0xff) !== 0x0a && (c & 0xff) !== 0x0d,
    );
    const full = zlibSync(data);
    expect(
      inflateZlibBounded(full.subarray(0, full.length - 1), 1e6),
    ).toMatchObject({
      ok: true,
      trailer: "invalid",
    });
  });

  it("flags a wrong checksum as invalid", () => {
    const full = zlibSync(noiseSamples(2000, 5));
    const bad = new Uint8Array(full);
    bad[bad.length - 4] ^= 0xff;
    expect(inflateZlibBounded(bad, 1e6)).toMatchObject({
      ok: true,
      trailer: "invalid",
    });
  });

  it("rejects bad headers, raw deflate and truncated deflate data", () => {
    expect(inflateZlibBounded(new Uint8Array([1, 2]), 100)).toEqual({
      ok: false,
      reason: "corrupt",
    });
    expect(
      inflateZlibBounded(new Uint8Array([0x78, 0x00, 0, 0, 0]), 100),
    ).toEqual({ ok: false, reason: "corrupt" });
    expect(inflateZlibBounded(deflateSync(text("raw deflate")), 100)).toEqual({
      ok: false,
      reason: "corrupt",
    });
    // Preset dictionary flag is unsupported.
    expect(
      inflateZlibBounded(new Uint8Array([0x78, 0xbb, 0, 0, 0, 0]), 100),
    ).toEqual({ ok: false, reason: "corrupt" });
    const full = zlibSync(noiseSamples(4000, 9));
    expect(inflateZlibBounded(full.subarray(0, 100), 1e6)).toEqual({
      ok: false,
      reason: "corrupt",
    });
    const garbage = new Uint8Array(full);
    garbage.fill(0xff, 10, 60);
    const result = inflateZlibBounded(garbage, 1e6);
    expect(!result.ok || result.trailer === "invalid").toBe(true);
  });

  it("re-deflates smaller than a fast setting without changing content", () => {
    const original = new Uint8Array(200_000);
    for (let i = 0; i < original.length; i++) original[i] = (i * i) % 251;
    const fast = zlibSync(original, { level: 1 });
    const best = deflateZlib(original);
    expect(best.length).toBeLessThanOrEqual(fast.length);
    const round = inflateZlibBounded(best, 1e7);
    expect(round.ok && round.trailer).toBe("valid");
    expect(round.ok && round.bytes).toEqual(original);
  });
});
