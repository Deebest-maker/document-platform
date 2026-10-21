import { PDFDict, PDFRawStream, type PDFContext, type PDFRef } from "pdf-lib";
import { deflateZlib, inflateZlibBounded } from "./compress-inflate";
import type { InflateBudget, TouchedStream } from "./compress-images";
import { filterNames, name } from "./compress-pdfobj";
import type { CompressLimits } from "./compress-types";

// Lossless pass: rewrites Flate streams at maximum compression, compresses
// streams that have no filter, and repairs Flate trailers that pdf-lib
// truncated while loading. It never changes decoded stream content.

const MIN_UNFILTERED_BYTES = 64;
// Savings below this fraction are not worth rewriting a stream for.
const UNFILTERED_MIN_SAVING = 0.05;
const FLATE_MIN_SAVING = 0.02;

const SKIPPED_TYPES = ["XRef", "ObjStm", "Metadata"] as const;

export interface StreamPassInput {
  readonly context: PDFContext;
  readonly limits: CompressLimits;
  readonly inflate: InflateBudget;
  readonly touched: TouchedStream[];
  readonly checkCancelled: () => void;
}

export interface StreamPassResult {
  readonly recompressed: number;
  readonly repaired: number;
  readonly signed: boolean;
}

function isSkippedType(stream: PDFRawStream): boolean {
  const type = stream.dict.get(name("Type"));
  return SKIPPED_TYPES.some((candidate) => type === name(candidate));
}

export function recompressStreams(input: StreamPassInput): StreamPassResult {
  const { context, limits, inflate } = input;
  let recompressed = 0;
  let repaired = 0;
  let signed = false;
  let counter = 0;
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if ((++counter & 0xff) === 0) input.checkCancelled();
    if (object instanceof PDFDict && object.has(name("ByteRange")))
      signed = true;
    if (!(object instanceof PDFRawStream)) continue;
    if (isSkippedType(object)) continue;
    // External file streams are not ours to rewrite.
    if (object.dict.has(name("F")) || object.dict.has(name("FFilter")))
      continue;
    const filters = filterNames(context, object.dict);
    if (!filters) continue;
    const original = object.contents;
    if (filters.length === 0) {
      if (
        original.length < MIN_UNFILTERED_BYTES ||
        original.length > limits.maxStreamInflateBytes ||
        original.length > inflate.remaining
      )
        continue;
      inflate.remaining -= original.length;
      const packed = deflateZlib(original);
      if (packed.length > original.length * (1 - UNFILTERED_MIN_SAVING))
        continue;
      object.dict.set(name("Filter"), name("FlateDecode"));
      object.dict.delete(name("DecodeParms"));
      replace(object, packed, ref, input.touched);
      recompressed++;
    } else if (filters.length === 1 && filters[0] === "FlateDecode") {
      const allowed = Math.min(limits.maxStreamInflateBytes, inflate.remaining);
      if (allowed <= 0) continue;
      const result = inflateZlibBounded(original, allowed);
      if (!result.ok || result.trailer === "invalid") continue;
      inflate.remaining -= result.bytes.length;
      const packed = deflateZlib(result.bytes);
      const truncated = result.trailer === "truncated";
      const smaller = packed.length <= original.length * (1 - FLATE_MIN_SAVING);
      if (!truncated && !smaller) continue;
      replace(object, packed, ref, input.touched);
      if (truncated) repaired++;
      if (smaller) recompressed++;
    }
  }
  return { recompressed, repaired, signed };
}

function replace(
  stream: PDFRawStream,
  contents: Uint8Array,
  ref: PDFRef,
  touched: TouchedStream[],
): void {
  (stream as { contents: Uint8Array }).contents = contents;
  touched.push({ ref, length: contents.length, jpeg: false });
}
