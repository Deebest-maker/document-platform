import {
  EncryptedPDFError,
  PDFDocument,
  PDFRawStream,
  type PDFRef,
} from "pdf-lib";
import { createBrowserImageCodec, type ImageCodec } from "./compress-codec";
import { inflateZlibBounded } from "./compress-inflate";
import {
  optimizeImages,
  type InflateBudget,
  type TouchedStream,
} from "./compress-images";
import { collectImageUses } from "./compress-layout";
import { filterNames, name } from "./compress-pdfobj";
import { recompressStreams } from "./compress-streams";
import {
  DEFAULT_COMPRESS_LIMITS,
  MIN_FILE_SAVING,
  compressProfiles,
  type CompressImageSummary,
  type CompressLimits,
  type CompressOptions,
  type CompressProfileId,
  type CompressResult,
  type CompressWarning,
} from "./compress-types";
import { PageError } from "./page-errors";
import type { PageInput } from "./page-types";
import { readPageInput } from "./page-validation";

export interface CompressDependencies {
  // `null` forces "no image codec" (used to test and to model old browsers).
  readonly codec?: ImageCodec | null;
  readonly now?: () => number;
  // Receives the verified candidate even when it is not published (tests and
  // benchmarks only; the product never calls it).
  readonly onCandidate?: (bytes: Uint8Array) => void;
}

interface PageGeometry {
  readonly box: readonly number[];
  readonly rotation: number;
}

function assertLimits(limits: CompressLimits): void {
  for (const value of Object.values(limits))
    if (!Number.isFinite(value) || value < 1)
      throw new PageError("OUTPUT_LIMIT");
}

function geometryOf(doc: PDFDocument): PageGeometry[] {
  return doc.getPages().map((page) => {
    const box = page.getMediaBox();
    return {
      box: [box.x, box.y, box.width, box.height],
      rotation: page.getRotation().angle,
    };
  });
}

function sameGeometry(a: readonly PageGeometry[], b: readonly PageGeometry[]) {
  return (
    a.length === b.length &&
    a.every(
      (page, index) =>
        page.rotation === b[index].rotation &&
        page.box.every((value, axis) => value === b[index].box[axis]),
    )
  );
}

function countImageStreams(doc: PDFDocument): number {
  let count = 0;
  for (const [, object] of doc.context.enumerateIndirectObjects())
    if (
      object instanceof PDFRawStream &&
      object.dict.get(name("Subtype")) === name("Image")
    )
      count++;
  return count;
}

const PDFA_SCAN_BYTES = 1024 * 1024;

// PDF/A files carry a pdfaid marker in their XMP packet. Re-saving cannot
// promise to keep the conformance claim, so the person is told.
function looksLikePdfA(doc: PDFDocument): boolean {
  try {
    const context = doc.context;
    const metadata = context.lookup(doc.catalog.get(name("Metadata")));
    if (!(metadata instanceof PDFRawStream)) return false;
    const filters = filterNames(context, metadata.dict);
    if (!filters || filters.length > 1) return false;
    let bytes: Uint8Array = metadata.contents;
    if (filters.length === 1) {
      if (filters[0] !== "FlateDecode") return false;
      const result = inflateZlibBounded(bytes, PDFA_SCAN_BYTES);
      if (!result.ok) return false;
      bytes = result.bytes;
    }
    if (bytes.length > PDFA_SCAN_BYTES) return false;
    return new TextDecoder("latin1").decode(bytes).includes("pdfaid:");
  } catch {
    return false;
  }
}

function isEncryptedError(error: unknown): boolean {
  return (
    error instanceof EncryptedPDFError ||
    // Class names can be mangled in production bundles; match the fixed text.
    (error instanceof Error &&
      error.message === new EncryptedPDFError().message)
  );
}

async function loadDocument(data: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(data, {
      ignoreEncryption: false,
      updateMetadata: false,
      // Parse without yielding to the event loop between batches of objects.
      parseSpeed: Number.POSITIVE_INFINITY,
    });
  } catch (error) {
    throw new PageError(
      isEncryptedError(error) ? "ENCRYPTED_PDF" : "INVALID_PDF",
    );
  }
}

function verifyOutput(
  output: Uint8Array,
  verifier: PDFDocument,
  expectedGeometry: readonly PageGeometry[],
  touched: readonly TouchedStream[],
): void {
  if (
    output.length < 32 ||
    output[0] !== 0x25 ||
    output[1] !== 0x50 ||
    output[2] !== 0x44 ||
    output[3] !== 0x46 ||
    output[4] !== 0x2d
  )
    throw new PageError("OUTPUT_INVALID");
  if (!sameGeometry(expectedGeometry, geometryOf(verifier)))
    throw new PageError("OUTPUT_INVALID");
  const lookup = (ref: PDFRef) => verifier.context.lookup(ref);
  for (const item of touched) {
    const object = lookup(item.ref);
    if (
      !(object instanceof PDFRawStream) ||
      object.contents.length !== item.length
    )
      throw new PageError("OUTPUT_INVALID");
    if (
      item.jpeg &&
      (object.contents[0] !== 0xff || object.contents[1] !== 0xd8)
    )
      throw new PageError("OUTPUT_INVALID");
  }
}

const summaryWithoutImages: CompressImageSummary = Object.freeze({
  found: 0,
  optimized: 0,
  bytesBefore: 0,
  bytesAfter: 0,
  skipped: Object.freeze({}),
});

export async function compressPdf(
  input: PageInput,
  profileId: CompressProfileId,
  limits: CompressLimits = DEFAULT_COMPRESS_LIMITS,
  options: CompressOptions = {},
  dependencies: CompressDependencies = {},
): Promise<CompressResult> {
  const now = dependencies.now ?? (() => performance.now());
  const checkCancelled = () => {
    if (options.signal?.aborted) throw new PageError("CANCELLED");
  };
  try {
    assertLimits(limits);
    const profile = compressProfiles[profileId];
    if (!profile) throw new PageError("INVALID_PLAN");
    checkCancelled();
    const startedAt = now();
    options.onPhase?.("reading");
    const data = await readPageInput(input, {
      maxInputBytes: limits.maxInputBytes,
      maxPages: limits.maxPages,
      maxOutputBytes: limits.maxOutputBytes,
    });
    checkCancelled();

    const codec =
      dependencies.codec === null
        ? undefined
        : (dependencies.codec ?? createBrowserImageCodec());
    const touched: TouchedStream[] = [];
    const inflate: InflateBudget = { remaining: limits.maxTotalInflateBytes };
    const warnings: CompressWarning[] = [];

    // The document is only referenced inside this block, so it can be
    // reclaimed before the output is re-opened for verification.
    const produced = await (async () => {
      const doc = await loadDocument(data);
      const loadedAt = now();
      checkCancelled();
      let pageCount: number;
      let geometry: PageGeometry[];
      try {
        // A file can parse yet lack a usable page tree.
        pageCount = doc.getPageCount();
        if (pageCount > limits.maxPages) throw new PageError("PAGE_LIMIT");
        geometry = geometryOf(doc);
      } catch (error) {
        if (error instanceof PageError) throw error;
        throw new PageError("INVALID_PDF");
      }
      if (pageCount < 1) throw new PageError("INVALID_PDF");
      if (looksLikePdfA(doc)) warnings.push("pdfa");

      options.onPhase?.("images");
      const layout = collectImageUses(doc, {
        maxScanBytes: limits.maxScanBytes,
        checkCancelled,
      });
      checkCancelled();
      let images = summaryWithoutImages;
      if (!layout.complete) {
        // Sizes cannot be trusted, so no image is resized. They are still
        // counted so the result can say how many were left unchanged.
        const count = countImageStreams(doc);
        if (count > 0) {
          images = Object.freeze({
            found: count,
            optimized: 0,
            bytesBefore: 0,
            bytesAfter: 0,
            skipped: Object.freeze({ layout_unknown: count }),
          });
          warnings.push("layout_unknown");
        }
      } else if (layout.uses.size > 0) {
        images = await optimizeImages({
          context: doc.context,
          layout,
          profile,
          limits,
          codec,
          now,
          inflate,
          touched,
          checkCancelled,
          onProgress: (done, total) =>
            options.onProgress?.({ phase: "images", done, total }),
        });
        if (!codec) warnings.push("images_unavailable");
      }
      const imagesAt = now();

      options.onPhase?.("structure");
      const streams = recompressStreams({
        context: doc.context,
        limits,
        inflate,
        touched,
        checkCancelled,
      });
      if (streams.signed) warnings.push("signatures");
      const structureAt = now();
      checkCancelled();

      options.onPhase?.("saving");
      let bytes: Uint8Array;
      try {
        bytes = await doc.save({
          useObjectStreams: true,
          updateFieldAppearances: false,
          addDefaultPage: false,
        });
      } catch {
        throw new PageError("OPERATION_FAILED");
      }
      const savedAt = now();
      return {
        bytes,
        pageCount,
        geometry,
        images,
        streams,
        marks: { loadedAt, imagesAt, structureAt, savedAt },
      };
    })();
    checkCancelled();

    options.onPhase?.("verifying");
    let verifier: PDFDocument;
    try {
      verifier = await PDFDocument.load(produced.bytes, {
        ignoreEncryption: false,
        updateMetadata: false,
        parseSpeed: Number.POSITIVE_INFINITY,
      });
    } catch {
      throw new PageError("OUTPUT_INVALID");
    }
    verifyOutput(produced.bytes, verifier, produced.geometry, touched);
    dependencies.onCandidate?.(produced.bytes);
    const finishedAt = now();

    const reduced =
      produced.bytes.length <= data.length * (1 - MIN_FILE_SAVING);
    if (reduced && produced.bytes.length > limits.maxOutputBytes)
      throw new PageError("OUTPUT_LIMIT");
    const { marks } = produced;
    return Object.freeze({
      outcome: reduced ? "reduced" : "no-reduction",
      blob: reduced
        ? new Blob([new Uint8Array(produced.bytes)], {
            type: "application/pdf",
          })
        : undefined,
      profile: profileId,
      inputBytes: data.length,
      outputBytes: produced.bytes.length,
      pageCount: produced.pageCount,
      images: produced.images,
      streamsRecompressed: produced.streams.recompressed,
      streamsRepaired: produced.streams.repaired,
      warnings: Object.freeze([...new Set(warnings)]),
      timingsMs: Object.freeze({
        load: marks.loadedAt - startedAt,
        images: marks.imagesAt - marks.loadedAt,
        structure: marks.structureAt - marks.imagesAt,
        save: marks.savedAt - marks.structureAt,
        verify: finishedAt - marks.savedAt,
        total: finishedAt - startedAt,
      }),
    } satisfies CompressResult);
  } catch (error) {
    if (error instanceof PageError) throw error;
    throw new PageError("OPERATION_FAILED");
  }
}
