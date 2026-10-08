import { PDFDocument, ParseSpeeds, rgb } from "pdf-lib";
import { imagePlacement } from "./image-layout";
import { stripJpegExif, validateImageInputs } from "./image-inspection";
import {
  ImagePdfError,
  type ExifOrientation,
  type ImageInput,
  type ImageLimits,
  type ImagesToPdfOptions,
  type ImagesToPdfResult,
} from "./image-types";

interface BitmapLike {
  readonly width: number;
  readonly height: number;
  close(): void;
}

interface ImageRuntime {
  decode(blob: Blob): Promise<BitmapLike>;
  normalize(
    bitmap: BitmapLike,
    orientation: ExifOrientation,
    mime: "image/jpeg" | "image/png",
  ): Promise<Uint8Array>;
}

function canvasTransform(
  context: OffscreenCanvasRenderingContext2D,
  orientation: ExifOrientation,
  width: number,
  height: number,
) {
  const transforms: Record<ExifOrientation, readonly number[]> = {
    1: [1, 0, 0, 1, 0, 0],
    2: [-1, 0, 0, 1, width, 0],
    3: [-1, 0, 0, -1, width, height],
    4: [1, 0, 0, -1, 0, height],
    5: [0, 1, 1, 0, 0, 0],
    6: [0, 1, -1, 0, height, 0],
    7: [0, -1, -1, 0, height, width],
    8: [0, -1, 1, 0, 0, width],
  };
  context.setTransform(
    ...(transforms[orientation] as [
      number,
      number,
      number,
      number,
      number,
      number,
    ]),
  );
}

const browserRuntime: ImageRuntime = {
  decode: (blob) =>
    createImageBitmap(blob, {
      imageOrientation: "none",
      premultiplyAlpha: "default",
    }),
  async normalize(bitmap, orientation, mime) {
    const swaps = orientation >= 5;
    const canvas = new OffscreenCanvas(
      swaps ? bitmap.height : bitmap.width,
      swaps ? bitmap.width : bitmap.height,
    );
    const context = canvas.getContext("2d", { alpha: mime === "image/png" });
    if (!context) throw new ImagePdfError("GENERATION_FAILED");
    if (mime === "image/png") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    canvasTransform(context, orientation, bitmap.width, bitmap.height);
    context.drawImage(bitmap as ImageBitmap, 0, 0);
    const normalized = await canvas.convertToBlob(
      mime === "image/jpeg"
        ? { type: "image/jpeg", quality: 0.92 }
        : { type: "image/png" },
    );
    return new Uint8Array(await normalized.arrayBuffer());
  },
};

const loadOptions = {
  ignoreEncryption: false,
  throwOnInvalidObject: true,
  updateMetadata: false,
  parseSpeed: ParseSpeeds.Slow,
};

export async function createImagesPdf(
  inputs: readonly ImageInput[],
  limits: ImageLimits,
  options: ImagesToPdfOptions,
  runtime: ImageRuntime = browserRuntime,
): Promise<ImagesToPdfResult> {
  validateImageInputs(inputs, limits);
  const cancelled = () => {
    if (options.signal?.aborted) throw new ImagePdfError("CANCELLED");
  };
  cancelled();
  options.onPhase?.("reading");
  try {
    const output = await PDFDocument.create({ updateMetadata: false });
    const expected: Array<{ width: number; height: number }> = [];
    options.onPhase?.("generating");
    for (const input of inputs) {
      cancelled();
      let bitmap: BitmapLike | undefined;
      try {
        const encoded = new Uint8Array(await input.blob.arrayBuffer());
        const decodeBlob =
          input.inspection.mime === "image/jpeg" &&
          input.inspection.orientation !== 1
            ? new Blob([stripJpegExif(encoded)], { type: "image/jpeg" })
            : input.blob;
        bitmap = await runtime.decode(decodeBlob);
        const rawDimensions =
          bitmap.width === input.inspection.width &&
          bitmap.height === input.inspection.height;
        const displayDimensions =
          bitmap.width === input.inspection.displayWidth &&
          bitmap.height === input.inspection.displayHeight;
        if (!rawDimensions && !displayDimensions)
          throw new ImagePdfError("INVALID_IMAGE", input.id);
        const orientation = rawDimensions ? input.inspection.orientation : 1;
        const raw =
          input.inspection.orientation === 1
            ? encoded
            : await runtime.normalize(
                bitmap,
                orientation,
                input.inspection.mime,
              );
        cancelled();
        const embedded =
          input.inspection.mime === "image/jpeg"
            ? await output.embedJpg(raw)
            : await output.embedPng(raw);
        const placement = imagePlacement(
          input.inspection,
          options.pageSize,
          options.fit,
          options.orientation,
        );
        const page = output.addPage([
          placement.pageWidth,
          placement.pageHeight,
        ]);
        page.drawRectangle({
          x: 0,
          y: 0,
          width: placement.pageWidth,
          height: placement.pageHeight,
          color: rgb(1, 1, 1),
        });
        page.drawImage(embedded, {
          x: placement.x,
          y: placement.y,
          width: placement.width,
          height: placement.height,
        });
        expected.push({
          width: placement.pageWidth,
          height: placement.pageHeight,
        });
      } catch (error) {
        if (error instanceof ImagePdfError) throw error;
        throw new ImagePdfError("INVALID_IMAGE", input.id);
      } finally {
        bitmap?.close();
      }
    }
    options.onPhase?.("validating");
    const bytes = await output.save({
      addDefaultPage: false,
      updateFieldAppearances: false,
      objectsPerTick: 20,
    });
    cancelled();
    if (bytes.length > limits.maxOutputBytes)
      throw new ImagePdfError("OUTPUT_LIMIT");
    try {
      const reopened = await PDFDocument.load(bytes, loadOptions);
      if (reopened.getPageCount() !== expected.length)
        throw new ImagePdfError("OUTPUT_INVALID");
      reopened.getPages().forEach((page, index) => {
        const size = page.getSize();
        if (
          Math.abs(size.width - expected[index].width) > 0.01 ||
          Math.abs(size.height - expected[index].height) > 0.01
        )
          throw new ImagePdfError("OUTPUT_INVALID");
      });
    } catch (error) {
      if (error instanceof ImagePdfError) throw error;
      throw new ImagePdfError("OUTPUT_INVALID");
    }
    return {
      blob: new Blob([new Uint8Array(bytes).buffer], {
        type: "application/pdf",
      }),
      pageCount: expected.length,
      outputBytes: bytes.length,
    };
  } catch (error) {
    if (error instanceof ImagePdfError) throw error;
    throw new ImagePdfError("GENERATION_FAILED");
  }
}
