import type { Inflate } from "fflate";
import type {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
} from "pdf-lib";

// pdf-lib 1.17.1 repair: restore trailing Flate checksum bytes it trimmed.
//
// Background (ADR-026). When a stream's /Length is an indirect reference and
// the data runs straight into "endstream" with no end-of-line marker, pdf-lib
// searches for the end of the stream and treats a final LF, CR or CR LF *data*
// byte as the marker. A Flate stream ends with the big-endian Adler-32
// checksum, so it can lose its last one or two bytes. Readers tolerate this,
// but validators warn and we should not write a damaged stream.
//
// The repair is deliberately narrow so it cannot change valid content:
//   * only streams whose declared /Length is exactly 1 or 2 bytes longer than
//     the loaded data are candidates (a cheap length comparison);
//   * the first filter must be FlateDecode with a plain zlib header;
//   * the deflate data is inflated (bounded) to compute the real Adler-32, and
//     the stream is rewritten only if the bytes that survived match the start
//     of that checksum and the missing bytes are exactly what the trimming
//     rule can remove (LF, CR, or CR LF).
// Anything else is left untouched.

/** Total decompressed bytes the repair may produce per document. */
export const MAX_REPAIR_INFLATE_BYTES = 256 * 1024 * 1024;

/** The pdf-lib classes the repair needs, passed in so this module stays
 * independent of how (statically or lazily) the caller loaded pdf-lib. */
export type StreamRepairLib = Readonly<{
  PDFArray: typeof PDFArray;
  PDFName: typeof PDFName;
  PDFNumber: typeof PDFNumber;
  PDFRawStream: typeof PDFRawStream;
  PDFRef: typeof PDFRef;
}>;

class LimitSignal extends Error {}

function adlerBytes(a: number, b: number): [number, number, number, number] {
  return [(b >>> 8) & 0xff, b & 0xff, (a >>> 8) & 0xff, a & 0xff];
}

/** Returns the repaired stream bytes, or null when it must be left alone. */
export function repairFlateTrailer(
  data: Uint8Array,
  lost: 1 | 2,
  budget: { remaining: number },
  InflateStream: typeof Inflate,
): Uint8Array | null {
  const keep = 4 - lost; // checksum bytes that survived
  if (data.length < 2 + keep) return null;
  // zlib header: deflate, 32 KiB window or smaller, valid check bits, no preset dictionary.
  if ((data[0] & 0x0f) !== 8 || data[0] >> 4 > 7) return null;
  if (((data[0] << 8) | data[1]) % 31 !== 0 || (data[1] & 0x20) !== 0)
    return null;

  let a = 1;
  let b = 0;
  let produced = 0;
  try {
    const inflate = new InflateStream((chunk) => {
      produced += chunk.length;
      if (produced > budget.remaining) throw new LimitSignal();
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
    });
    inflate.push(data.subarray(2, data.length - keep), true);
  } catch {
    return null; // corrupt, truncated deflate data, or over budget
  }
  budget.remaining -= produced;

  const expected = adlerBytes(a, b);
  for (let index = 0; index < keep; index++)
    if (data[data.length - keep + index] !== expected[index]) return null;
  const tail = expected.slice(keep);
  const trimmable =
    lost === 1
      ? tail[0] === 0x0a || tail[0] === 0x0d
      : tail[0] === 0x0d && tail[1] === 0x0a;
  if (!trimmable) return null;

  const repaired = new Uint8Array(data.length + lost);
  repaired.set(data);
  repaired.set(tail, data.length);
  return repaired;
}

/** Repairs trimmed Flate checksums in a freshly loaded document, in place.
 * Returns the number of streams restored. Never throws on odd input.
 *
 * The decoder (fflate) is imported only when a candidate stream exists, so
 * ordinary files do not load it. This keeps fflate out of the single-output
 * Split chunks, which must stay free of archive code. */
export async function repairTruncatedFlateTrailers(
  document: PDFDocument,
  lib: StreamRepairLib,
): Promise<number> {
  const { PDFArray, PDFName, PDFNumber, PDFRawStream, PDFRef } = lib;
  const context = document.context;
  const candidates: { stream: PDFRawStream; lost: 1 | 2 }[] = [];
  for (const [, object] of context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    let declared = object.dict.get(PDFName.of("Length"));
    if (declared instanceof PDFRef) declared = context.lookup(declared);
    if (!(declared instanceof PDFNumber)) continue;
    const lost = declared.asNumber() - object.contents.length;
    if (lost !== 1 && lost !== 2) continue;

    let filter = object.dict.get(PDFName.of("Filter"));
    if (filter instanceof PDFRef) filter = context.lookup(filter);
    if (filter instanceof PDFArray) {
      filter = filter.get(0);
      if (filter instanceof PDFRef) filter = context.lookup(filter);
    }
    if (
      !(filter instanceof PDFName) ||
      (filter.asString() !== "/FlateDecode" && filter.asString() !== "/Fl")
    )
      continue;
    candidates.push({ stream: object, lost });
  }
  if (candidates.length === 0) return 0;

  let InflateStream: typeof Inflate;
  try {
    InflateStream = (await import("fflate")).Inflate;
  } catch {
    return 0; // the chunk could not load: leave the document as pdf-lib read it
  }
  const budget = { remaining: MAX_REPAIR_INFLATE_BYTES };
  let repaired = 0;
  for (const { stream, lost } of candidates) {
    const fixed = repairFlateTrailer(
      stream.contents,
      lost,
      budget,
      InflateStream,
    );
    if (!fixed) continue;
    (stream as { contents: Uint8Array }).contents = fixed;
    repaired++;
  }
  return repaired;
}
