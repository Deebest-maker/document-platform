import { describe, expect, it } from "vitest";
import {
  flatFraction,
  samplesToRgba,
  undoPredictor,
} from "../src/compress-raster";
import { noiseSamples } from "./helpers/compress-fixtures";

function paeth(a: number, b: number, c: number) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

// Forward PNG filter used to build test input.
function pngFilter(
  samples: Uint8Array,
  columns: number,
  colors: number,
  rows: number,
  filters: number[],
) {
  const rowBytes = columns * colors;
  const out = new Uint8Array((rowBytes + 1) * rows);
  for (let row = 0; row < rows; row++) {
    const filter = filters[row % filters.length];
    out[row * (rowBytes + 1)] = filter;
    for (let i = 0; i < rowBytes; i++) {
      const x = samples[row * rowBytes + i];
      const a = i >= colors ? samples[row * rowBytes + i - colors] : 0;
      const b = row > 0 ? samples[(row - 1) * rowBytes + i] : 0;
      const c =
        row > 0 && i >= colors ? samples[(row - 1) * rowBytes + i - colors] : 0;
      const predicted = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter];
      out[row * (rowBytes + 1) + 1 + i] = (x - predicted) & 0xff;
    }
  }
  return out;
}

describe("predictor reversal", () => {
  it.each([1, 3])(
    "undoes every PNG filter type with %i colour channels",
    (colors) => {
      const columns = 17;
      const rows = 11;
      const samples = noiseSamples(columns * colors * rows, 4);
      const filtered = pngFilter(
        samples,
        columns,
        colors,
        rows,
        [0, 1, 2, 3, 4],
      );
      const plain = undoPredictor(
        filtered,
        { predictor: 15, columns, colors },
        rows,
      );
      expect(plain).toEqual(samples);
    },
  );

  it("undoes the TIFF predictor", () => {
    const columns = 9;
    const colors = 3;
    const rows = 5;
    const samples = noiseSamples(columns * colors * rows, 8);
    const diff = new Uint8Array(samples);
    for (let row = 0; row < rows; row++)
      for (let i = columns * colors - 1; i >= colors; i--)
        diff[row * columns * colors + i] =
          (samples[row * columns * colors + i] -
            samples[row * columns * colors + i - colors]) &
          0xff;
    expect(
      undoPredictor(diff, { predictor: 2, columns, colors }, rows),
    ).toEqual(samples);
  });

  it("passes through predictor 1 and rejects mismatched geometry", () => {
    const data = new Uint8Array(12);
    expect(
      undoPredictor(data, { predictor: 1, columns: 4, colors: 3 }, 1),
    ).toBe(data);
    expect(
      undoPredictor(data, { predictor: 15, columns: 4, colors: 3 }, 2),
    ).toBeUndefined();
    expect(
      undoPredictor(data, { predictor: 2, columns: 4, colors: 3 }, 2),
    ).toBeUndefined();
    expect(
      undoPredictor(data, { predictor: 7, columns: 4, colors: 3 }, 1),
    ).toBeUndefined();
  });

  it("rejects an unknown PNG filter byte", () => {
    const bad = new Uint8Array([9, 1, 2, 3]);
    expect(
      undoPredictor(bad, { predictor: 15, columns: 3, colors: 1 }, 1),
    ).toBeUndefined();
  });
});

describe("flat graphic detection", () => {
  it("scores a solid image as flat and noise as not flat", () => {
    expect(
      flatFraction(new Uint8Array(100 * 100 * 3).fill(255), 100, 100, 3),
    ).toBeGreaterThan(0.9);
    expect(
      flatFraction(noiseSamples(100 * 100 * 3, 2), 100, 100, 3),
    ).toBeLessThan(0.05);
  });

  it("looks at every channel", () => {
    const samples = new Uint8Array(50 * 50 * 3).fill(10);
    for (let i = 2; i < samples.length; i += 3) samples[i] = i & 0x7f;
    expect(flatFraction(samples, 50, 50, 3)).toBeLessThan(0.1);
  });

  it("handles tiny images", () => {
    expect(flatFraction(new Uint8Array(3), 1, 1, 3)).toBe(0);
  });
});

describe("sample conversion", () => {
  it("expands grey and RGB samples to opaque RGBA", () => {
    expect(Array.from(samplesToRgba(new Uint8Array([10, 200]), 2, 1))).toEqual([
      10, 10, 10, 255, 200, 200, 200, 255,
    ]);
    expect(
      Array.from(samplesToRgba(new Uint8Array([1, 2, 3, 4, 5, 6]), 2, 3)),
    ).toEqual([1, 2, 3, 255, 4, 5, 6, 255]);
  });
});
