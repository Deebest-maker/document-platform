import { describe, expect, it } from "vitest";
import {
  IDENTITY,
  decodeName,
  multiply,
  scanContentStream,
  type Matrix,
} from "../src/compress-scan";

const enc = (text: string) => new TextEncoder().encode(text);

function dos(content: string | Uint8Array, remaining = 1_000_000) {
  const found: { name: string; ctm: Matrix }[] = [];
  const budget = { remaining };
  const complete = scanContentStream(
    typeof content === "string" ? enc(content) : content,
    (name, ctm) => found.push({ name, ctm }),
    budget,
  );
  return { found, complete, budget };
}

describe("matrix multiplication", () => {
  it("applies the left operand first", () => {
    const scale: Matrix = [2, 0, 0, 3, 0, 0];
    const move: Matrix = [1, 0, 0, 1, 10, 20];
    expect(multiply(scale, move)).toEqual([2, 0, 0, 3, 10, 20]);
    expect(multiply(move, scale)).toEqual([2, 0, 0, 3, 20, 60]);
    expect(multiply(IDENTITY, scale)).toEqual(scale);
  });
});

describe("content stream scanner", () => {
  it("reports Do with the current transformation matrix", () => {
    const { found, complete } = dos("q 200 0 0 100 10 20 cm /Im1 Do Q");
    expect(complete).toBe(true);
    expect(found).toEqual([{ name: "Im1", ctm: [200, 0, 0, 100, 10, 20] }]);
  });

  it("restores the matrix on Q and nests q/cm", () => {
    const { found } = dos(
      "q 2 0 0 2 0 0 cm q 10 0 0 10 5 5 cm /A Do Q /B Do Q /C Do",
    );
    expect(found.map((f) => f.name)).toEqual(["A", "B", "C"]);
    expect(found[0].ctm).toEqual([20, 0, 0, 20, 10, 10]);
    expect(found[1].ctm).toEqual([2, 0, 0, 2, 0, 0]);
    expect(found[2].ctm).toEqual(IDENTITY);
  });

  it("ignores an unbalanced Q", () => {
    expect(dos("Q Q /A Do").found[0].ctm).toEqual(IDENTITY);
  });

  it("parses signed and fractional numbers", () => {
    const { found } = dos("-.5 0 0 +4. 1.25 -2 cm /A Do");
    expect(found[0].ctm).toEqual([-0.5, 0, 0, 4, 1.25, -2]);
  });

  it("does not see operators inside strings, hex strings and comments", () => {
    const { found } = dos(
      "(text /Fake Do \\) /Fake2 Do) Tj <2f446f20> Tj % /Fake3 Do\n/Real Do",
    );
    expect(found.map((f) => f.name)).toEqual(["Real"]);
  });

  it("decodes #xx escapes in names", () => {
    expect(dos("/Im#201 Do").found[0].name).toBe("Im 1");
    expect(decodeName(enc("A#4"), 0, 3)).toBe("A#4");
    expect(decodeName(enc("A#zz"), 0, 4)).toBe("A#zz");
  });

  it("handles dictionaries and arrays in marked content", () => {
    const { found } = dos(
      "/OC << /MCID 0 /K [1 2 3] >> BDC q 4 0 0 4 0 0 cm /A Do Q EMC",
    );
    expect(found).toHaveLength(1);
    expect(found[0].ctm).toEqual([4, 0, 0, 4, 0, 0]);
  });

  it("uses only the name directly before Do", () => {
    expect(dos("/A /B Do").found.map((f) => f.name)).toEqual(["B"]);
    expect(dos("1 2 Do").found).toHaveLength(0);
  });

  it("skips inline images, including binary that contains EI", () => {
    const head = enc("q BI /W 2 /H 2 /BPC 8 /CS /G ID ");
    const binary = new Uint8Array([0x00, 0x45, 0x49, 0x20, 0x80, 0xff]);
    const tail = enc("\nEI Q q 5 0 0 5 0 0 cm /After Do Q");
    const content = new Uint8Array(head.length + binary.length + tail.length);
    content.set(head);
    content.set(binary, head.length);
    content.set(tail, head.length + binary.length);
    const { found, complete } = dos(content);
    expect(complete).toBe(true);
    expect(found).toEqual([{ name: "After", ctm: [5, 0, 0, 5, 0, 0] }]);
  });

  it("reports an unterminated inline image as untrustworthy", () => {
    expect(dos("BI /W 1 /H 1 ID \u0001\u0002 no end").complete).toBe(false);
  });

  it("stops when the byte budget is exhausted", () => {
    const { complete, found } = dos("q 1 0 0 1 0 0 cm /A Do Q", 5);
    expect(complete).toBe(false);
    expect(found).toHaveLength(0);
  });

  it("charges the budget per stream", () => {
    const budget = { remaining: 100 };
    const noop = () => {};
    expect(scanContentStream(enc("q Q ".repeat(10)), noop, budget)).toBe(true);
    expect(budget.remaining).toBe(60);
    expect(scanContentStream(enc("q Q ".repeat(20)), noop, budget)).toBe(false);
  });

  it("refuses absurd graphics-state nesting", () => {
    expect(dos("q ".repeat(5000)).complete).toBe(false);
    expect(dos("q ".repeat(1000)).complete).toBe(true);
  });

  it("survives malformed and binary input without hanging", () => {
    const noise = new Uint8Array(20_000);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 131 + 7) & 0xff;
    expect(() => dos(noise)).not.toThrow();
    expect(() => dos("((((((")).not.toThrow();
    expect(() => dos("<<<<<<>>>")).not.toThrow();
    expect(() => dos("/")).not.toThrow();
  });
});
