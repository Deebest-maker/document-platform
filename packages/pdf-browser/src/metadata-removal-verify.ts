// Narrow structural verifier for the Remove PDF Metadata output.
//
// This module contains ONLY production-safe byte-level verification. Its
// single exported function reads a bounded slice of the saved PDF between
// the final `trailer` keyword and the following `startxref` and reports
// whether `/ID` appears inside that slice. Any `/ID` byte sequence that
// appears elsewhere in the body is deliberately ignored, so this scanner
// cannot false-positive outside the trailer. It is used by
// `removePdfMetadata` to down-correct `trailerIdControllable` for the
// trailer-/ID SPIKE — the engine can only make the SPIKE result MORE
// cautious, never promote it.
//
// A broader whole-body regex scanner exists for tests and benchmarks only
// (see `packages/pdf-browser/tests/helpers/metadata-whole-body-scan.ts`).
// It is deliberately NOT reachable from any production code path and is
// NOT re-exported from the `./metadata-removal` subpath. A whole-file
// regex can false-positive on legitimately-placed byte sequences and must
// not gate publication.

export interface TrailerIdStructuralScan {
  /** The scanner located the final `trailer` keyword and bounded its block. */
  readonly trailerBlockFound: boolean;
  /** Inside the trailer dictionary ONLY, an /ID entry was observed. */
  readonly idInTrailer: boolean;
}

function toLatin1(bytes: Uint8Array): string {
  // Latin-1 (ISO-8859-1) is a stable identity map for every byte 0..255. A
  // UTF-8 TextDecoder would silently rewrite high bytes, which this scanner
  // must not do: it reads structural PDF syntax, not text.
  let out = "";
  const chunk = 0x10000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const end = Math.min(bytes.length, i + chunk);
    const slice = bytes.subarray(i, end);
    out += String.fromCharCode(...slice);
  }
  return out;
}

export function scanTrailerIdStructural(
  bytes: Uint8Array,
): TrailerIdStructuralScan {
  const latin1 = toLatin1(bytes);
  // The last `trailer` keyword wins — PDFs with incremental updates have
  // multiple trailers and the final one is authoritative. pdf-lib's save
  // output has at most one trailer, but the scanner is written defensively.
  const trailerIdx = latin1.lastIndexOf("trailer");
  if (trailerIdx === -1)
    return { trailerBlockFound: false, idInTrailer: false };
  const startXrefIdx = latin1.indexOf("startxref", trailerIdx);
  const end = startXrefIdx === -1 ? latin1.length : startXrefIdx;
  const trailerBlock = latin1.slice(trailerIdx, end);
  const strictPattern = /\/ID\s*\[\s*<[0-9A-Fa-f]*>\s*<[0-9A-Fa-f]*>\s*\]/;
  const loosePattern = /\/ID\s*\[\s*<[0-9A-Fa-f]+>/;
  const idInTrailer =
    strictPattern.test(trailerBlock) || loosePattern.test(trailerBlock);
  return { trailerBlockFound: true, idInTrailer };
}
