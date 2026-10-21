// Helpers for uncompressed raster images found in PDFs (Flate-encoded samples).
// Only 8-bit Gray and RGB samples are handled; everything else is left alone.

export interface PredictorParams {
  readonly predictor: number;
  readonly columns: number;
  readonly colors: number;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

// Reverses the PNG (10-15) or TIFF (2) predictor on 8-bit samples. Returns
// undefined if the data does not match the declared geometry.
export function undoPredictor(
  data: Uint8Array,
  params: PredictorParams,
  rows: number,
): Uint8Array | undefined {
  const { predictor, columns, colors } = params;
  const rowBytes = columns * colors;
  if (predictor === 1) return data;
  if (predictor === 2) {
    if (data.length !== rowBytes * rows) return undefined;
    const out = new Uint8Array(data);
    for (let row = 0; row < rows; row++) {
      const base = row * rowBytes;
      for (let index = colors; index < rowBytes; index++)
        out[base + index] =
          (out[base + index] + out[base + index - colors]) & 0xff;
    }
    return out;
  }
  if (predictor < 10 || predictor > 15) return undefined;
  if (data.length !== (rowBytes + 1) * rows) return undefined;
  const out = new Uint8Array(rowBytes * rows);
  for (let row = 0; row < rows; row++) {
    const filter = data[row * (rowBytes + 1)];
    const source = row * (rowBytes + 1) + 1;
    const target = row * rowBytes;
    const above = target - rowBytes;
    for (let index = 0; index < rowBytes; index++) {
      const raw = data[source + index];
      const left = index >= colors ? out[target + index - colors] : 0;
      const up = row > 0 ? out[above + index] : 0;
      const upLeft =
        row > 0 && index >= colors ? out[above + index - colors] : 0;
      let value: number;
      switch (filter) {
        case 0:
          value = raw;
          break;
        case 1:
          value = raw + left;
          break;
        case 2:
          value = raw + up;
          break;
        case 3:
          value = raw + ((left + up) >> 1);
          break;
        case 4:
          value = raw + paeth(left, up, upLeft);
          break;
        default:
          return undefined;
      }
      out[target + index] = value & 0xff;
    }
  }
  return out;
}

// Fraction of horizontally adjacent sample pairs that are exactly equal, taken
// over a centred window. Flat graphics, such as screenshots and diagrams, score
// high; photographs and scans score low. Such images are better left lossless.
export function flatFraction(
  samples: Uint8Array,
  width: number,
  height: number,
  channels: number,
): number {
  const windowWidth = Math.min(width, 512);
  const windowHeight = Math.min(height, 512);
  if (windowWidth < 2 || windowHeight < 1) return 0;
  const left = (width - windowWidth) >> 1;
  const top = (height - windowHeight) >> 1;
  let equal = 0;
  for (let y = 0; y < windowHeight; y++) {
    let position = ((top + y) * width + left) * channels;
    for (let x = 1; x < windowWidth; x++) {
      let same = true;
      for (let k = 0; k < channels; k++)
        if (samples[position + k] !== samples[position + channels + k]) {
          same = false;
          break;
        }
      if (same) equal++;
      position += channels;
    }
  }
  return equal / (windowWidth * windowHeight);
}

export function samplesToRgba(
  samples: Uint8Array,
  pixels: number,
  channels: 1 | 3,
): Uint8ClampedArray<ArrayBuffer> {
  const rgba = new Uint8ClampedArray(pixels * 4);
  if (channels === 3) {
    for (
      let source = 0, target = 0;
      target < rgba.length;
      source += 3, target += 4
    ) {
      rgba[target] = samples[source];
      rgba[target + 1] = samples[source + 1];
      rgba[target + 2] = samples[source + 2];
      rgba[target + 3] = 255;
    }
  } else {
    for (let source = 0, target = 0; source < pixels; source++, target += 4) {
      const value = samples[source];
      rgba[target] = value;
      rgba[target + 1] = value;
      rgba[target + 2] = value;
      rgba[target + 3] = 255;
    }
  }
  return rgba;
}
