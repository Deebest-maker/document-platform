import { Inflate, zlibSync } from "fflate";

// Bounded zlib decoding for untrusted PDF streams.
//
// Why raw inflate and not `unzlibSync`: pdf-lib 1.17 trims a trailing LF or CR
// from a stream whose /Length is an indirect reference, even when that byte is
// real data. For a Flate stream the last byte is the low byte of the Adler-32
// checksum, so the loaded stream can be missing 1-2 checksum bytes. The deflate
// data itself is intact, so we inflate the raw data, verify the checksum
// against whatever bytes remain, and rewrite the stream with a correct trailer.

export type ZlibTrailer = "valid" | "truncated" | "invalid";

export type InflateResult =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      readonly trailer: ZlibTrailer;
    }
  | { readonly ok: false; readonly reason: "limit" | "corrupt" };

class LimitSignal extends Error {}

const STEP = 16 * 1024;

export function adler32(chunks: readonly Uint8Array[]): number {
  let a = 1;
  let b = 0;
  for (const chunk of chunks) {
    let index = 0;
    while (index < chunk.length) {
      // 5552 is the largest block that cannot overflow 32 bits before the modulo.
      const end = Math.min(index + 5552, chunk.length);
      for (; index < end; index++) {
        a += chunk[index];
        b += a;
      }
      a %= 65521;
      b %= 65521;
    }
  }
  return ((b << 16) | a) >>> 0;
}

function isLineEnd(byte: number): boolean {
  return byte === 0x0a || byte === 0x0d;
}

// The checksum is stored big-endian. `lost` low-order bytes may have been
// trimmed, but only if each of them is a line-ending byte.
function classifyTrailer(data: Uint8Array, checksum: number): ZlibTrailer {
  const expected = [
    (checksum >>> 24) & 0xff,
    (checksum >>> 16) & 0xff,
    (checksum >>> 8) & 0xff,
    checksum & 0xff,
  ];
  for (let lost = 0; lost <= 2; lost++) {
    const present = 4 - lost;
    if (data.length < 2 + present) continue;
    let matches = true;
    for (let index = 0; index < present; index++)
      if (data[data.length - present + index] !== expected[index]) {
        matches = false;
        break;
      }
    if (!matches) continue;
    for (let index = present; index < 4; index++)
      if (!isLineEnd(expected[index])) matches = false;
    if (matches) return lost === 0 ? "valid" : "truncated";
  }
  return "invalid";
}

export function inflateZlibBounded(
  data: Uint8Array,
  maxBytes: number,
): InflateResult {
  if (data.length < 3) return { ok: false, reason: "corrupt" };
  const cmf = data[0];
  const flg = data[1];
  if ((cmf & 0x0f) !== 8 || ((cmf << 8) | flg) % 31 !== 0 || (flg & 0x20) !== 0)
    return { ok: false, reason: "corrupt" };
  const chunks: Uint8Array[] = [];
  let total = 0;
  const inflate = new Inflate((chunk) => {
    total += chunk.length;
    if (total > maxBytes) throw new LimitSignal();
    chunks.push(chunk);
  });
  const body = data.subarray(2);
  try {
    if (body.length === 0) inflate.push(body, true);
    for (let offset = 0; offset < body.length; offset += STEP)
      inflate.push(
        body.subarray(offset, Math.min(offset + STEP, body.length)),
        offset + STEP >= body.length,
      );
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof LimitSignal ? "limit" : "corrupt",
    };
  }
  const trailer = classifyTrailer(data, adler32(chunks));
  const bytes = new Uint8Array(total);
  let position = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, position);
    position += chunk.length;
  }
  return { ok: true, bytes, trailer };
}

export function deflateZlib(bytes: Uint8Array): Uint8Array {
  return zlibSync(bytes, { level: 9 });
}
