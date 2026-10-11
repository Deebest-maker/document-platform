import { PageError } from "./page-errors";
import { validatePagePlan, type PagePlan } from "./page-model";
import type { PreviewDocument } from "./preview/types";
import type {
  JpegInspection,
  PdfToJpegLimits,
  PdfToJpegOptions,
  PdfToJpegResult,
} from "./pdf-to-jpg-types";

export const pdfToJpegQuality = 0.9;

const filename = (pageNumber: number) =>
  `page-${String(pageNumber).padStart(3, "0")}.jpg`;

function safeLimits(limits: PdfToJpegLimits) {
  if (
    !limits ||
    Object.values(limits).some(
      (value) => !Number.isSafeInteger(value) || value < 1,
    )
  )
    throw new PageError("OUTPUT_LIMIT");
}

function selectedPages(plan: PagePlan, selectedIds: readonly string[] | "all") {
  validatePagePlan(plan);
  if (selectedIds === "all") return plan.pages;
  const selected = new Set(selectedIds);
  if (
    selected.size < 1 ||
    selected.size !== selectedIds.length ||
    selectedIds.some((id) => !plan.pages.some((page) => page.id === id))
  )
    throw new PageError("INVALID_PLAN");
  return plan.pages.filter((page) => selected.has(page.id));
}

export async function inspectJpeg(blob: Blob): Promise<JpegInspection> {
  if (!(blob instanceof Blob) || blob.type !== "image/jpeg" || blob.size < 4)
    throw new PageError("OUTPUT_INVALID");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes.at(-2) !== 0xff ||
    bytes.at(-1) !== 0xd9
  )
    throw new PageError("OUTPUT_INVALID");
  const sof = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
    0xcf,
  ]);
  let offset = 2;
  while (offset + 3 < bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.length) break;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length)
      throw new PageError("OUTPUT_INVALID");
    if (sof.has(marker)) {
      if (length < 7) throw new PageError("OUTPUT_INVALID");
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      if (width < 1 || height < 1) throw new PageError("OUTPUT_INVALID");
      return { width, height, bytes: bytes.byteLength };
    }
    offset += length;
  }
  throw new PageError("OUTPUT_INVALID");
}

async function decodeJpeg(
  blob: Blob,
  expected: { width: number; height: number },
) {
  const inspected = await inspectJpeg(blob);
  if (
    inspected.width !== expected.width ||
    inspected.height !== expected.height
  )
    throw new PageError("OUTPUT_INVALID");
  if (typeof createImageBitmap === "function") {
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await createImageBitmap(blob);
      if (bitmap.width !== expected.width || bitmap.height !== expected.height)
        throw new PageError("OUTPUT_INVALID");
    } catch (error) {
      if (error instanceof PageError) throw error;
      throw new PageError("OUTPUT_INVALID");
    } finally {
      bitmap?.close();
    }
  }
  return inspected;
}

export async function renderPdfPagesToJpeg(
  preview: PreviewDocument,
  plan: PagePlan,
  limits: PdfToJpegLimits,
  options: PdfToJpegOptions,
): Promise<PdfToJpegResult> {
  const cancelled = () => {
    if (options.signal?.aborted) throw new PageError("CANCELLED");
  };
  try {
    safeLimits(limits);
    if (preview.sessionId !== plan.sessionId)
      throw new PageError("INVALID_PLAN");
    const renderJpeg = preview.renderJpeg?.bind(preview);
    if (!renderJpeg) throw new PageError("RENDER_FAILED");
    if (![96, 150, 300].includes(options.dpi))
      throw new PageError("INVALID_PLAN");
    const pages = selectedPages(plan, options.selectedIds);
    if (pages.length > limits.maxSelectedPages)
      throw new PageError("OUTPUT_LIMIT");
    let totalPixels = 0;
    for (const page of pages) {
      cancelled();
      const geometry = await preview.geometry(page.sourcePageNumber);
      const width = Math.max(
        1,
        Math.round((geometry.width * options.dpi) / 72),
      );
      const height = Math.max(
        1,
        Math.round((geometry.height * options.dpi) / 72),
      );
      const pixels = width * height;
      if (
        !Number.isSafeInteger(pixels) ||
        pixels > limits.maxPixelsPerPage ||
        pixels * 4 > limits.maxCanvasBytes
      )
        throw new PageError("OUTPUT_LIMIT");
      totalPixels += pixels;
      if (totalPixels > limits.maxAggregatePixels)
        throw new PageError("OUTPUT_LIMIT");
    }
    const outputs: {
      blob: Blob;
      bytes: Uint8Array;
      sourcePageNumber: number;
      filename: string;
      width: number;
      height: number;
    }[] = [];
    let combinedJpegBytes = 0;
    for (const [index, page] of pages.entries()) {
      cancelled();
      options.onProgress?.({
        phase: "rendering",
        current: index + 1,
        total: pages.length,
      });
      const rendered = await renderJpeg(page.sourcePageNumber, {
        dpi: options.dpi,
        quality: pdfToJpegQuality,
        maxPixels: limits.maxPixelsPerPage,
        maxCanvasBytes: limits.maxCanvasBytes,
        signal: options.signal,
      });
      cancelled();
      options.onProgress?.({
        phase: "validating",
        current: index + 1,
        total: pages.length,
      });
      const inspection = await decodeJpeg(rendered.blob, rendered);
      combinedJpegBytes += inspection.bytes;
      if (combinedJpegBytes > limits.maxCombinedOutputBytes)
        throw new PageError("OUTPUT_LIMIT");
      outputs.push({
        ...rendered,
        bytes: new Uint8Array(await rendered.blob.arrayBuffer()),
        sourcePageNumber: page.sourcePageNumber,
        filename: filename(page.sourcePageNumber),
      });
    }
    cancelled();
    const summaries = outputs.map(
      ({ sourcePageNumber, filename: name, width, height, bytes }) => ({
        sourcePageNumber,
        filename: name,
        width,
        height,
        bytes: bytes.byteLength,
      }),
    );
    if (outputs.length === 1)
      return {
        blob: outputs[0].blob,
        kind: "jpg",
        fileCount: 1,
        combinedJpegBytes,
        pages: summaries,
      };
    options.onProgress?.({
      phase: "archiving",
      current: pages.length,
      total: pages.length,
    });
    const { unzipSync, zipSync } = await import("fflate");
    cancelled();
    const archive = zipSync(
      Object.fromEntries(
        outputs.map((output) => [output.filename, output.bytes]),
      ),
      { level: 0 },
    );
    if (archive.byteLength > limits.maxArchiveBytes)
      throw new PageError("OUTPUT_LIMIT");
    const reopened = unzipSync(archive);
    if (
      Object.keys(reopened).length !== outputs.length ||
      outputs.some(
        (output) =>
          !reopened[output.filename] ||
          reopened[output.filename].byteLength !== output.bytes.byteLength,
      )
    )
      throw new PageError("OUTPUT_INVALID");
    cancelled();
    return {
      blob: new Blob([new Uint8Array(archive).buffer], {
        type: "application/zip",
      }),
      kind: "zip",
      fileCount: outputs.length,
      combinedJpegBytes,
      pages: summaries,
    };
  } catch (error) {
    if (error instanceof PageError) throw error;
    throw new PageError("OPERATION_FAILED");
  }
}

export type {
  PdfJpegDpi,
  PdfToJpegLimits,
  PdfToJpegOptions,
  PdfToJpegPhase,
  PdfToJpegResult,
} from "./pdf-to-jpg-types";
