import {
  ImagePdfError,
  type ExifOrientation,
  type ImageInspection,
  type ImageLimits,
  type ImageMime,
} from "./image-types";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const JPEG_SCAN_BYTES = 1024 * 1024;
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function u16(bytes: Uint8Array, offset: number, little = false) {
  if (offset + 2 > bytes.length) throw new ImagePdfError("INVALID_IMAGE");
  return little
    ? bytes[offset] | (bytes[offset + 1] << 8)
    : (bytes[offset] << 8) | bytes[offset + 1];
}

function u32(bytes: Uint8Array, offset: number, little = false) {
  if (offset + 4 > bytes.length) throw new ImagePdfError("INVALID_IMAGE");
  return little
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
}

function exifOrientation(bytes: Uint8Array, start: number, end: number) {
  if (
    end - start < 14 ||
    String.fromCharCode(...bytes.slice(start, start + 6)) !== "Exif\0\0"
  )
    return 1 as ExifOrientation;
  const tiff = start + 6;
  const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
  const big = bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d;
  if ((!little && !big) || u16(bytes, tiff + 2, little) !== 42)
    return 1 as ExifOrientation;
  const directory = tiff + u32(bytes, tiff + 4, little);
  if (directory + 2 > end) return 1 as ExifOrientation;
  const count = u16(bytes, directory, little);
  for (let index = 0; index < count; index++) {
    const entry = directory + 2 + index * 12;
    if (entry + 12 > end) break;
    if (u16(bytes, entry, little) !== 0x0112) continue;
    const value = u16(bytes, entry + 8, little);
    return value >= 1 && value <= 8 ? (value as ExifOrientation) : 1;
  }
  return 1 as ExifOrientation;
}

function parsePng(bytes: Uint8Array) {
  if (
    bytes.length < 24 ||
    !PNG_SIGNATURE.every((value, index) => bytes[index] === value) ||
    String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR"
  )
    throw new ImagePdfError("INVALID_IMAGE");
  return {
    width: u32(bytes, 16),
    height: u32(bytes, 20),
    orientation: 1 as const,
  };
}

function parseJpeg(bytes: Uint8Array) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8)
    throw new ImagePdfError("INVALID_IMAGE");
  let position = 2;
  let orientation: ExifOrientation = 1;
  while (position + 4 <= bytes.length) {
    while (position < bytes.length && bytes[position] === 0xff) position++;
    if (position >= bytes.length) break;
    const marker = bytes[position++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = u16(bytes, position);
    if (length < 2 || position + length > bytes.length)
      throw new ImagePdfError("INVALID_IMAGE");
    const payload = position + 2;
    const end = position + length;
    if (marker === 0xe1) orientation = exifOrientation(bytes, payload, end);
    if (SOF_MARKERS.has(marker)) {
      if (length < 7) throw new ImagePdfError("INVALID_IMAGE");
      return {
        width: u16(bytes, payload + 3),
        height: u16(bytes, payload + 1),
        orientation,
      };
    }
    position = end;
  }
  throw new ImagePdfError("INVALID_IMAGE");
}

export function inspectImageBytes(
  bytes: Uint8Array,
  expectedMime?: ImageMime,
): ImageInspection {
  let mime: ImageMime;
  let parsed: { width: number; height: number; orientation: ExifOrientation };
  if (PNG_SIGNATURE.every((value, index) => bytes[index] === value)) {
    mime = "image/png";
    parsed = parsePng(bytes);
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    mime = "image/jpeg";
    parsed = parseJpeg(bytes);
  } else {
    throw new ImagePdfError("SIGNATURE_MISMATCH");
  }
  if (expectedMime && mime !== expectedMime)
    throw new ImagePdfError("SIGNATURE_MISMATCH");
  if (!parsed.width || !parsed.height) throw new ImagePdfError("INVALID_IMAGE");
  const swaps = parsed.orientation >= 5;
  const pixels = parsed.width * parsed.height;
  return {
    mime,
    width: parsed.width,
    height: parsed.height,
    orientation: parsed.orientation,
    displayWidth: swaps ? parsed.height : parsed.width,
    displayHeight: swaps ? parsed.width : parsed.height,
    pixels,
    estimatedRgbaBytes: pixels * 4,
  };
}

export async function inspectImageBlob(
  blob: Blob,
  expectedMime?: ImageMime,
): Promise<ImageInspection> {
  if (!blob.size) throw new ImagePdfError("EMPTY_INPUT");
  const bytes = new Uint8Array(
    await blob.slice(0, Math.min(blob.size, JPEG_SCAN_BYTES)).arrayBuffer(),
  );
  return inspectImageBytes(bytes, expectedMime);
}

export function stripJpegExif(bytes: Uint8Array) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8)
    throw new ImagePdfError("INVALID_IMAGE");
  const parts: Uint8Array[] = [bytes.slice(0, 2)];
  let position = 2;
  while (position < bytes.length) {
    const markerStart = position;
    if (bytes[position] !== 0xff) throw new ImagePdfError("INVALID_IMAGE");
    while (position < bytes.length && bytes[position] === 0xff) position++;
    if (position >= bytes.length) throw new ImagePdfError("INVALID_IMAGE");
    const marker = bytes[position++];
    if (marker === 0xd9 || marker === 0xda) {
      parts.push(bytes.slice(markerStart));
      position = bytes.length;
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(bytes.slice(markerStart, position));
      continue;
    }
    const length = u16(bytes, position);
    if (length < 2 || position + length > bytes.length)
      throw new ImagePdfError("INVALID_IMAGE");
    const payload = position + 2;
    const end = position + length;
    const isExif =
      marker === 0xe1 &&
      end - payload >= 6 &&
      String.fromCharCode(...bytes.slice(payload, payload + 6)) === "Exif\0\0";
    if (!isExif) parts.push(bytes.slice(markerStart, end));
    position = end;
  }
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const stripped = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    stripped.set(part, offset);
    offset += part.length;
  }
  return stripped;
}

export function validateInspection(
  inspection: ImageInspection,
  limits: ImageLimits,
  inputId?: string,
) {
  if (
    inspection.width > limits.maxWidth ||
    inspection.height > limits.maxHeight
  )
    throw new ImagePdfError("DIMENSION_LIMIT", inputId);
  if (
    inspection.pixels > limits.maxPixelsPerImage ||
    inspection.estimatedRgbaBytes > limits.maxDecodedBytesPerImage
  )
    throw new ImagePdfError("PIXEL_LIMIT", inputId);
}

export function validateImageInputs(
  inputs: readonly { id: string; blob: Blob; inspection: ImageInspection }[],
  limits: ImageLimits,
) {
  if (
    !inputs.length ||
    inputs.length > limits.maxFiles ||
    inputs.length > limits.maxPages
  )
    throw new ImagePdfError("INPUT_COUNT");
  let totalBytes = 0;
  let totalPixels = 0;
  for (const input of inputs) {
    if (!input.blob.size) throw new ImagePdfError("EMPTY_INPUT", input.id);
    if (input.blob.size > limits.maxFileBytes)
      throw new ImagePdfError("INPUT_LIMIT", input.id);
    validateInspection(input.inspection, limits, input.id);
    totalBytes += input.blob.size;
    totalPixels += input.inspection.pixels;
  }
  if (totalBytes > limits.maxTotalBytes) throw new ImagePdfError("INPUT_LIMIT");
  if (
    totalPixels > limits.maxAggregatePixels ||
    totalPixels * 4 > limits.maxAggregateDecodedBytes
  )
    throw new ImagePdfError("AGGREGATE_PIXEL_LIMIT");
}
