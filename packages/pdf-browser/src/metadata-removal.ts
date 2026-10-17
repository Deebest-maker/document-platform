import { PageError } from "./page-errors";
import { readPageInput } from "./page-validation";
import { pageLimits, type PageInput } from "./page-types";
import {
  STANDARD_INFO_KEYS,
  type MetadataRemovalLimits,
  type MetadataRemovalOptions,
  type MetadataRemovalResult,
  type MetadataSnapshotFlags,
  type StandardInfoKey,
} from "./metadata-removal-types";
import { scanTrailerIdStructural } from "./metadata-removal-verify";

// Deliberately narrow boundary around the pdf-lib structures we touch so the
// rest of the engine does not depend on pdf-lib internals and so React never
// sees a PDFDocument / PDFDict / PDFRef object.
interface PdfLibContext {
  trailerInfo: Record<string, unknown>;
  lookup(ref: unknown): unknown;
}
interface PdfLibDict {
  keys(): readonly unknown[];
  delete(key: unknown): void;
  has(key: unknown): boolean;
}
interface PdfLibDocument {
  readonly context: PdfLibContext;
  readonly catalog: PdfLibDict;
  getPageCount(): number;
  getPages(): readonly PdfLibPage[];
  save(options?: { useObjectStreams?: boolean }): Promise<Uint8Array>;
}
interface PdfLibPage {
  getMediaBox(): { x: number; y: number; width: number; height: number };
  getRotation(): { angle: number };
}
interface PdfLibNamespace {
  PDFDocument: {
    load(
      bytes: Uint8Array,
      options?: { ignoreEncryption?: boolean; updateMetadata?: boolean },
    ): Promise<PdfLibDocument>;
  };
  PDFName: {
    of(name: string): unknown;
  };
  EncryptedPDFError: new () => Error;
}

export const DEFAULT_METADATA_REMOVAL_LIMITS: MetadataRemovalLimits =
  Object.freeze({
    maxInputBytes: pageLimits.maxInputBytes,
    maxPages: pageLimits.maxPages,
    maxOutputBytes: pageLimits.maxOutputBytes,
  });

function safeLimits(limits: MetadataRemovalLimits): void {
  if (
    !limits ||
    !Number.isSafeInteger(limits.maxInputBytes) ||
    limits.maxInputBytes < 1 ||
    !Number.isSafeInteger(limits.maxPages) ||
    limits.maxPages < 1 ||
    !Number.isSafeInteger(limits.maxOutputBytes) ||
    limits.maxOutputBytes < 1
  )
    throw new PageError("OUTPUT_LIMIT");
}

function keyName(key: unknown): string | undefined {
  // pdf-lib's PDFName has `.decodeText()` or `.toString()`; we only need the
  // bare name (without the leading slash). Avoid pulling pdf-lib types in by
  // reading `.encodedName`/`.toString()` defensively.
  if (!key) return undefined;
  const asRecord = key as { encodedName?: unknown; toString?: () => string };
  if (typeof asRecord.encodedName === "string")
    return asRecord.encodedName.replace(/^\//, "");
  if (typeof asRecord.toString === "function") {
    const text = asRecord.toString();
    return typeof text === "string" ? text.replace(/^\//, "") : undefined;
  }
  return undefined;
}

function readInfoDict(doc: PdfLibDocument): PdfLibDict | undefined {
  const infoRef = doc.context.trailerInfo.Info;
  if (!infoRef) return undefined;
  const dict = doc.context.lookup(infoRef);
  if (!dict) return undefined;
  // Duck-type check: a dictionary exposes keys() and delete().
  const candidate = dict as Partial<PdfLibDict>;
  if (
    typeof candidate.keys !== "function" ||
    typeof candidate.delete !== "function"
  )
    return undefined;
  return candidate as PdfLibDict;
}

function snapshotInfoKeys(infoDict: PdfLibDict | undefined): {
  standard: readonly StandardInfoKey[];
  custom: readonly string[];
} {
  const standard: StandardInfoKey[] = [];
  const custom: string[] = [];
  if (!infoDict) return { standard, custom };
  const standardSet = new Set<string>(STANDARD_INFO_KEYS as readonly string[]);
  for (const key of infoDict.keys()) {
    const name = keyName(key);
    if (!name) continue;
    if (standardSet.has(name)) standard.push(name as StandardInfoKey);
    else custom.push(name);
  }
  return { standard, custom };
}

function catalogMetadataPresent(
  doc: PdfLibDocument,
  pdflib: PdfLibNamespace,
): boolean {
  try {
    return doc.catalog.has(pdflib.PDFName.of("Metadata"));
  } catch {
    return false;
  }
}

function trailerIdPresent(doc: PdfLibDocument): boolean {
  return doc.context.trailerInfo.ID != null;
}

function snapshotFlags(
  doc: PdfLibDocument,
  pdflib: PdfLibNamespace,
): MetadataSnapshotFlags {
  const infoDict = readInfoDict(doc);
  const { standard, custom } = snapshotInfoKeys(infoDict);
  const standardInfoPresent: Record<string, boolean> = {};
  for (const key of STANDARD_INFO_KEYS)
    standardInfoPresent[key] = standard.includes(key);
  return Object.freeze({
    standardInfoPresent: Object.freeze(standardInfoPresent) as Readonly<
      Record<StandardInfoKey, boolean>
    >,
    customInfoKeys: Object.freeze([...custom]),
    xmpStreamPresent: catalogMetadataPresent(doc, pdflib),
    trailerIdPresent: trailerIdPresent(doc),
  });
}

async function loadPdfLib(): Promise<PdfLibNamespace> {
  const pdfLibModule = await import("pdf-lib");
  return pdfLibModule as unknown as PdfLibNamespace;
}

export async function removePdfMetadata(
  input: PageInput,
  limits: MetadataRemovalLimits = DEFAULT_METADATA_REMOVAL_LIMITS,
  options: MetadataRemovalOptions = {},
): Promise<MetadataRemovalResult> {
  const cancelled = () => {
    if (options.signal?.aborted) throw new PageError("CANCELLED");
  };
  try {
    safeLimits(limits);
    cancelled();
    options.onPhase?.("reading");
    const data = await readPageInput(input, {
      maxInputBytes: limits.maxInputBytes,
      maxPages: limits.maxPages,
      maxOutputBytes: limits.maxOutputBytes,
    });
    cancelled();
    const pdflib = await loadPdfLib();
    cancelled();
    let source: PdfLibDocument;
    try {
      source = await pdflib.PDFDocument.load(data, {
        ignoreEncryption: false,
        updateMetadata: false,
      });
    } catch (error) {
      // Class names are mangled in production bundles, so match the type and
      // the library's fixed message (same approach as merge/page-operations).
      if (
        error instanceof pdflib.EncryptedPDFError ||
        (error instanceof Error &&
          error.message === new pdflib.EncryptedPDFError().message)
      )
        throw new PageError("ENCRYPTED_PDF");
      throw new PageError("INVALID_PDF");
    }
    cancelled();
    if (source.getPageCount() < 1) throw new PageError("INVALID_PDF");
    if (source.getPageCount() > limits.maxPages)
      throw new PageError("PAGE_LIMIT");
    const before = snapshotFlags(source, pdflib);
    const beforePages = source.getPages().map((page, index) => {
      const box = page.getMediaBox();
      const rotation = page.getRotation();
      return {
        sourcePageNumber: index + 1,
        mediaBox: [box.x, box.y, box.width, box.height] as const,
        rotation: rotation.angle,
      };
    });
    cancelled();
    options.onPhase?.("removing");
    // Standard + custom Info: delete every key on the Info dictionary. The
    // dictionary object stays attached to the trailer but with no entries.
    // Also attempt to detach the pointer from the trailer so the serializer
    // skips emitting an empty /Info dict.
    const removedStandard: StandardInfoKey[] = [];
    const removedCustom: string[] = [];
    const infoDict = readInfoDict(source);
    if (infoDict) {
      const standardSet = new Set<string>(
        STANDARD_INFO_KEYS as readonly string[],
      );
      const keysSnapshot = [...infoDict.keys()];
      for (const key of keysSnapshot) {
        const name = keyName(key);
        if (!name) continue;
        try {
          infoDict.delete(key);
          if (standardSet.has(name))
            removedStandard.push(name as StandardInfoKey);
          else removedCustom.push(name);
        } catch {
          // Leave the entry in place; verification below will catch it and
          // record a failed removal honestly.
        }
      }
    }
    // Drop the trailer /Info pointer entirely. Serializers that honour
    // trailerInfo keys will then emit a trailer without /Info.
    try {
      delete source.context.trailerInfo.Info;
    } catch {
      // Non-fatal; the empty dict path above is still correct.
    }
    // XMP metadata stream: remove the Catalog /Metadata entry if present.
    let removedXmp = false;
    try {
      const metadataName = pdflib.PDFName.of("Metadata");
      if (source.catalog.has(metadataName)) {
        source.catalog.delete(metadataName);
        removedXmp = true;
      }
    } catch {
      // Non-fatal; verification will report the state honestly.
    }
    // Trailer /ID — SPIKE per ADR-020. Attempt to suppress /ID on save by
    // detaching it from trailerInfo. The underlying serializer may still
    // regenerate an identifier (behaviour varies by pdf-lib minor release
    // and by whether the source was encrypted). The verification step
    // observes the saved output and reports the real outcome; the UI must
    // only claim removal when `trailerIdControllable` is true.
    const originalTrailerId = source.context.trailerInfo.ID;
    try {
      delete source.context.trailerInfo.ID;
    } catch {
      // non-fatal
    }
    cancelled();
    options.onPhase?.("validating");
    let savedBytes: Uint8Array;
    try {
      savedBytes = await source.save({ useObjectStreams: false });
    } catch {
      throw new PageError("OPERATION_FAILED");
    }
    if (
      savedBytes.byteLength < 32 ||
      savedBytes.byteLength > limits.maxOutputBytes
    )
      throw new PageError("OUTPUT_LIMIT");
    cancelled();
    options.onPhase?.("verifying");
    // Independent verification: reopen the saved bytes and confirm absence
    // of every targeted field, plus content preservation (page count, media
    // boxes, rotation).
    let verifier: PdfLibDocument;
    try {
      verifier = await pdflib.PDFDocument.load(savedBytes, {
        ignoreEncryption: false,
        updateMetadata: false,
      });
    } catch {
      throw new PageError("OUTPUT_INVALID");
    }
    const after = snapshotFlags(verifier, pdflib);
    const trailerIdControllable = !after.trailerIdPresent;
    // Restore the original trailer ID to the SOURCE document so we leave the
    // in-memory parsed document unchanged beyond what we deliberately did.
    // (This has no effect on the already-saved bytes.)
    if (originalTrailerId != null)
      source.context.trailerInfo.ID = originalTrailerId;
    const afterPages = verifier.getPages().map((page, index) => {
      const box = page.getMediaBox();
      const rotation = page.getRotation();
      return {
        sourcePageNumber: index + 1,
        mediaBox: [box.x, box.y, box.width, box.height] as const,
        rotation: rotation.angle,
      };
    });
    const geometry = beforePages.map((before, index) => {
      const afterEntry = afterPages[index];
      const afterBox = afterEntry?.mediaBox ?? [0, 0, 0, 0];
      const beforeBox = before.mediaBox;
      const geometryUnchanged =
        afterEntry != null &&
        afterBox[0] === beforeBox[0] &&
        afterBox[1] === beforeBox[1] &&
        afterBox[2] === beforeBox[2] &&
        afterBox[3] === beforeBox[3];
      const rotationUnchanged =
        afterEntry != null && before.rotation === afterEntry.rotation;
      return Object.freeze({
        sourcePageNumber: before.sourcePageNumber,
        beforeMediaBox: Object.freeze([...beforeBox]) as readonly number[],
        afterMediaBox: Object.freeze([...afterBox]) as readonly number[],
        beforeRotation: before.rotation,
        afterRotation: afterEntry?.rotation ?? -1,
        geometryUnchanged,
        rotationUnchanged,
      });
    });
    const pagesPreserved =
      verifier.getPageCount() === source.getPageCount() &&
      geometry.every(
        (entry) => entry.geometryUnchanged && entry.rotationUnchanged,
      );
    if (!pagesPreserved) throw new PageError("OUTPUT_INVALID");
    // Verify absence of every targeted field.
    for (const key of removedStandard) {
      if (after.standardInfoPresent[key]) throw new PageError("OUTPUT_INVALID");
    }
    for (const key of removedCustom) {
      if (after.customInfoKeys.includes(key))
        throw new PageError("OUTPUT_INVALID");
    }
    if (removedXmp && after.xmpStreamPresent)
      throw new PageError("OUTPUT_INVALID");
    // Minimal sanity: the saved bytes must still be a PDF. This is a
    // 5-byte prefix check, not a scan of the body.
    if (
      savedBytes.length < 5 ||
      savedBytes[0] !== 0x25 || // %
      savedBytes[1] !== 0x50 || // P
      savedBytes[2] !== 0x44 || // D
      savedBytes[3] !== 0x46 || // F
      savedBytes[4] !== 0x2d // -
    )
      throw new PageError("OUTPUT_INVALID");
    // Structurally scoped belt-and-braces for the trailer /ID SPIKE only.
    // The scanner inspects a bounded slice of the saved bytes between the
    // final `trailer` keyword and the following `startxref` — ONLY the
    // trailer dictionary, not the whole file — and reports whether /ID is
    // present inside that slice. Any /ID appearing elsewhere in the body
    // is deliberately ignored, so this cannot false-positive. We only
    // ever down-correct `trailerIdControllable`; we never claim removal
    // that pdf-lib's reopen snapshot and this structural scan disagree
    // about in the engine's favour.
    //
    // Production verification stops here. Any broader byte-level scanning
    // belongs in tests and the local benchmark harness, not in the engine
    // (a whole-file regex can false-positive on legitimately-placed byte
    // sequences and must never gate publication).
    const trailerIdScan = scanTrailerIdStructural(savedBytes);
    const trailerIdControllableFinal =
      trailerIdControllable && !trailerIdScan.idInTrailer;
    cancelled();
    const blob = new Blob([new Uint8Array(savedBytes).buffer], {
      type: "application/pdf",
    });
    return Object.freeze({
      blob,
      bytes: savedBytes.byteLength,
      pageCount: verifier.getPageCount(),
      before,
      after,
      removed: Object.freeze({
        standardInfo: Object.freeze([...removedStandard]),
        customInfo: Object.freeze([...removedCustom]),
        xmpStream: removedXmp,
        trailerId: trailerIdControllableFinal && before.trailerIdPresent,
      }),
      trailerIdControllable: trailerIdControllableFinal,
      pagesPreserved,
      pageGeometry: Object.freeze([...geometry]),
    });
  } catch (error) {
    if (error instanceof PageError) throw error;
    throw new PageError("OPERATION_FAILED");
  }
}

export type {
  MetadataPhase,
  MetadataRemovalErrorCode,
  MetadataRemovalLimits,
  MetadataRemovalOptions,
  MetadataRemovalResult,
  MetadataSnapshotFlags,
  StandardInfoKey,
} from "./metadata-removal-types";
export { STANDARD_INFO_KEYS } from "./metadata-removal-types";
// Only the trailer-scoped structural scanner is re-exported from
// production. The whole-body `scanRemovedMetadataBytes` helper is
// deliberately NOT exposed here — it lives in test/benchmark helpers
// because a whole-file regex is not a correctness gate.
export {
  scanTrailerIdStructural,
  type TrailerIdStructuralScan,
} from "./metadata-removal-verify";

// Re-exported for test harnesses that want the shared `PageLimits` default.
export { pageLimits as inheritedPageLimits } from "./page-types";
