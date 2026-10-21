// Minimal, defensive JPEG header reader. It never decodes pixels; it reads only
// the marker segments before the first scan. Input is untrusted.

export interface JpegInfo {
  readonly width: number;
  readonly height: number;
  readonly components: number;
  readonly precision: number;
  readonly progressive: boolean;
  // Estimated libjpeg-style quality (1-100) from the first quantisation table,
  // or undefined when the file has none.
  readonly quality: number | undefined;
  // EXIF orientation 1-8; 1 when absent or unreadable.
  readonly orientation: number;
}

// Sum of the 64 entries of the ITU T.81 Annex K luminance table (quality 50).
const STANDARD_LUMINANCE_SUM = 3688;

export function estimateQualityFromQuantSum(sum: number): number {
  const scale = (sum * 100) / STANDARD_LUMINANCE_SUM;
  const quality = scale <= 100 ? (200 - scale) / 2 : 5000 / scale;
  return Math.max(1, Math.min(100, Math.round(quality)));
}

function isStartOfFrame(marker: number): boolean {
  // SOF0-SOF15 except DHT (C4), JPG (C8) and DAC (CC).
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
  );
}

function readExifOrientation(
  bytes: Uint8Array,
  start: number,
  end: number,
): number {
  // `start` points at "Exif\0\0"; the TIFF header follows.
  const tiff = start + 6;
  if (tiff + 8 > end) return 1;
  const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
  const big = bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d;
  if (!little && !big) return 1;
  const u16 = (offset: number) =>
    little
      ? bytes[offset] | (bytes[offset + 1] << 8)
      : (bytes[offset] << 8) | bytes[offset + 1];
  const u32 = (offset: number) =>
    little
      ? (bytes[offset] |
          (bytes[offset + 1] << 8) |
          (bytes[offset + 2] << 16) |
          (bytes[offset + 3] << 24)) >>>
        0
      : ((bytes[offset] << 24) |
          (bytes[offset + 1] << 16) |
          (bytes[offset + 2] << 8) |
          bytes[offset + 3]) >>>
        0;
  if (u16(tiff + 2) !== 42) return 1;
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return 1;
  const count = u16(ifd);
  for (let index = 0; index < count && index < 256; index++) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > end) return 1;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

export function inspectJpeg(bytes: Uint8Array): JpegInfo | undefined {
  const length = bytes.length;
  if (length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let offset = 2;
  let frame:
    | {
        width: number;
        height: number;
        components: number;
        precision: number;
        progressive: boolean;
      }
    | undefined;
  let quantSum: number | undefined;
  let orientation = 1;
  // Marker walk, bounded by the length of the input.
  while (offset + 1 < length) {
    if (bytes[offset] !== 0xff) break; // garbage between segments
    // Fill bytes: any number of 0xFF may precede a marker code.
    while (offset < length && bytes[offset] === 0xff) offset++;
    if (offset >= length) break;
    const marker = bytes[offset++];
    if (
      marker === 0x00 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd8)
    )
      continue; // stuffed byte / TEM / RSTn / SOI carry no length
    if (marker === 0xd9) break; // EOI
    if (offset + 2 > length) return undefined;
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2) return undefined;
    const bodyStart = offset + 2;
    const bodyEnd = offset + segmentLength;
    if (bodyEnd > length) return undefined;
    if (isStartOfFrame(marker)) {
      if (frame || bodyEnd - bodyStart < 6) return undefined;
      frame = {
        precision: bytes[bodyStart],
        height: (bytes[bodyStart + 1] << 8) | bytes[bodyStart + 2],
        width: (bytes[bodyStart + 3] << 8) | bytes[bodyStart + 4],
        components: bytes[bodyStart + 5],
        progressive: marker === 0xc2 || marker === 0xc6 || marker === 0xca,
      };
    } else if (marker === 0xdb && quantSum === undefined) {
      // Quantisation tables: Pq/Tq byte, then 64 entries of 8 or 16 bits.
      let position = bodyStart;
      while (position < bodyEnd) {
        const info = bytes[position++];
        const wide = info >> 4 !== 0;
        const size = wide ? 128 : 64;
        if (position + size > bodyEnd) return undefined;
        if ((info & 0x0f) === 0) {
          let sum = 0;
          for (let index = 0; index < 64; index++)
            sum += wide
              ? (bytes[position + index * 2] << 8) |
                bytes[position + index * 2 + 1]
              : bytes[position + index];
          quantSum = sum;
        }
        position += size;
      }
    } else if (
      marker === 0xe1 &&
      bodyEnd - bodyStart >= 14 &&
      bytes[bodyStart] === 0x45 && // E
      bytes[bodyStart + 1] === 0x78 && // x
      bytes[bodyStart + 2] === 0x69 && // i
      bytes[bodyStart + 3] === 0x66 && // f
      bytes[bodyStart + 4] === 0 &&
      bytes[bodyStart + 5] === 0
    ) {
      orientation = readExifOrientation(bytes, bodyStart, bodyEnd);
    } else if (marker === 0xda) {
      break; // start of scan: all header segments we need precede this
    }
    offset = bodyEnd;
  }
  if (!frame || frame.width < 1 || frame.height < 1) return undefined;
  return Object.freeze({
    ...frame,
    quality:
      quantSum === undefined
        ? undefined
        : estimateQualityFromQuantSum(quantSum),
    orientation,
  });
}
