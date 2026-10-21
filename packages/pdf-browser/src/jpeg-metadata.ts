/**
 * Remove embedded metadata from a JPEG without touching the picture (M6B.1,
 * ADR-030).
 *
 * A JPEG file is a sequence of marker segments followed by entropy-coded scan
 * data. Camera details, GPS position, thumbnails, XMP, IPTC and comments all
 * live in marker segments ahead of the scan (APP1..APP15 and COM), and some
 * cameras append whole extra images after the end-of-image marker. The picture
 * itself is the scan data and the frame/table segments, which are copied
 * byte-for-byte, so the decoded pixels are identical.
 *
 * Kept: every non-application segment (frame, tables, restart interval, scan),
 * a plain JFIF header (no thumbnail) and the Adobe APP14 segment, which
 * decoders use to interpret CMYK/YCCK colour.
 * Dropped: all other APPn and COM segments, and anything after the first
 * end-of-image marker.
 *
 * An embedded ICC profile (APP2) is dropped too. PDF viewers take the colour
 * space from the PDF image dictionary and ignore a profile inside the JPEG
 * stream, so removing it changes nothing on screen, and profile descriptions
 * can name the device that made the picture.
 */

import { ImagePdfError } from "./image-types";

const SOI = [0xff, 0xd8] as const;

function isJfifWithoutThumbnail(
  bytes: Uint8Array,
  payload: number,
  length: number,
) {
  // "JFIF\0", version(2), units(1), density(4), thumbnail w(1), h(1) = 14 bytes
  return (
    length === 16 &&
    bytes[payload] === 0x4a && // J
    bytes[payload + 1] === 0x46 && // F
    bytes[payload + 2] === 0x49 && // I
    bytes[payload + 3] === 0x46 && // F
    bytes[payload + 4] === 0x00 &&
    bytes[payload + 12] === 0 &&
    bytes[payload + 13] === 0
  );
}

function isAdobe(bytes: Uint8Array, payload: number, length: number) {
  return (
    length >= 14 &&
    length <= 16 &&
    bytes[payload] === 0x41 && // A
    bytes[payload + 1] === 0x64 && // d
    bytes[payload + 2] === 0x6f && // o
    bytes[payload + 3] === 0x62 && // b
    bytes[payload + 4] === 0x65 // e
  );
}

function keepSegment(
  bytes: Uint8Array,
  marker: number,
  payload: number,
  length: number,
) {
  if (marker === 0xfe) return false; // COM
  if (marker === 0xe0) return isJfifWithoutThumbnail(bytes, payload, length);
  if (marker === 0xee) return isAdobe(bytes, payload, length);
  if (marker > 0xe0 && marker <= 0xef) return false; // APP1..APP15
  return true;
}

/**
 * Finds the end of the first image: the offset just past its EOI marker, or the
 * end of the data when the file is cut short. `start` is the first byte after
 * the first SOS header. Progressive files contain further segments and scans
 * before EOI; their segments are skipped by length so that entropy data is
 * never mistaken for a marker.
 */
function endOfImage(bytes: Uint8Array, start: number): number {
  let index = start;
  while (index < bytes.length - 1) {
    if (bytes[index] !== 0xff) {
      index++;
      continue;
    }
    let next = index + 1;
    while (next < bytes.length && bytes[next] === 0xff) next++; // fill bytes
    if (next >= bytes.length) return bytes.length;
    const marker = bytes[next];
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
      index = next + 1; // stuffed 0xFF or restart marker
      continue;
    }
    if (marker === 0xd9) return next + 1;
    if (marker === 0x01 || marker === 0xd8) {
      index = next + 1;
      continue;
    }
    if (next + 2 >= bytes.length) return bytes.length;
    const length = (bytes[next + 1] << 8) | bytes[next + 2];
    if (length < 2 || next + 1 + length > bytes.length) return bytes.length;
    index = next + 1 + length;
  }
  return bytes.length;
}

export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== SOI[0] || bytes[1] !== SOI[1])
    throw new ImagePdfError("INVALID_IMAGE");

  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let position = 2;

  for (;;) {
    if (position >= bytes.length || bytes[position] !== 0xff)
      throw new ImagePdfError("INVALID_IMAGE");
    while (position < bytes.length && bytes[position] === 0xff) position++;
    if (position >= bytes.length) throw new ImagePdfError("INVALID_IMAGE");
    const marker = bytes[position++];

    // Not valid before the scan: stuffing, EOI, or a second SOI.
    if (marker === 0x00 || marker === 0xd9 || marker === 0xd8)
      throw new ImagePdfError("INVALID_IMAGE");
    // Standalone markers carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(Uint8Array.of(0xff, marker));
      continue;
    }

    if (position + 2 > bytes.length) throw new ImagePdfError("INVALID_IMAGE");
    const length = (bytes[position] << 8) | bytes[position + 1];
    const end = position + length;
    if (length < 2 || end > bytes.length)
      throw new ImagePdfError("INVALID_IMAGE");
    const payload = position + 2;

    if (marker === 0xda) {
      // Start of scan: copy its header and all scan data up to the first EOI.
      parts.push(Uint8Array.of(0xff, marker), bytes.subarray(position, end));
      parts.push(bytes.subarray(end, endOfImage(bytes, end)));
      break;
    }

    if (keepSegment(bytes, marker, payload, length)) {
      parts.push(Uint8Array.of(0xff, marker), bytes.subarray(position, end));
    }
    position = end;
  }

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
