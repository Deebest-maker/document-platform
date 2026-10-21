// Image transcoding through the browser's own codecs. The engine depends only on
// the `ImageCodec` interface so tests can substitute a deterministic fake.

export type CodecSource =
  | { readonly kind: "jpeg"; readonly bytes: Uint8Array }
  | {
      readonly kind: "rgba";
      readonly width: number;
      readonly height: number;
      readonly data: Uint8ClampedArray<ArrayBuffer>;
    };

export interface ImageCodec {
  // Decodes `source`, resamples it to width x height and returns baseline JPEG
  // bytes at `quality` (1-100). Rejects if any step fails.
  transcode(
    source: CodecSource,
    width: number,
    height: number,
    quality: number,
  ): Promise<Uint8Array>;
}

type Scope = {
  OffscreenCanvas?: typeof OffscreenCanvas;
  createImageBitmap?: typeof createImageBitmap;
  ImageData?: typeof ImageData;
};

function blobOf(bytes: Uint8Array): Blob {
  // Copy into a plain ArrayBuffer so the Blob never aliases a shared buffer.
  return new Blob([new Uint8Array(bytes)], { type: "image/jpeg" });
}

async function decode(
  scope: Required<Scope>,
  source: CodecSource,
): Promise<ImageBitmap> {
  if (source.kind === "rgba")
    return scope.createImageBitmap(
      new scope.ImageData(source.data, source.width, source.height),
    );
  const blob = blobOf(source.bytes);
  try {
    // Keep stored sample values: colour management is the viewer's job.
    return await scope.createImageBitmap(blob, {
      colorSpaceConversion: "none",
    });
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    // A browser that rejects the options object still decodes the image.
    return scope.createImageBitmap(blob);
  }
}

function drawn(
  scope: Required<Scope>,
  from: CanvasImageSource,
  width: number,
  height: number,
): OffscreenCanvas {
  const canvas = new scope.OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas unavailable");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(from, 0, 0, width, height);
  return canvas;
}

export function createBrowserImageCodec(
  scope: Scope = globalThis as unknown as Scope,
): ImageCodec | undefined {
  if (
    typeof scope.OffscreenCanvas !== "function" ||
    typeof scope.createImageBitmap !== "function" ||
    typeof scope.ImageData !== "function"
  )
    return undefined;
  const ready = scope as Required<Scope>;
  return {
    async transcode(source, width, height, quality) {
      const bitmap = await decode(ready, source);
      let current: CanvasImageSource = bitmap;
      let currentWidth = bitmap.width;
      let currentHeight = bitmap.height;
      try {
        // Halve repeatedly while at least twice the target. Single-step
        // reductions by large factors alias badly and differ between engines;
        // stepwise halving gives the same result everywhere.
        while (currentWidth / 2 >= width && currentHeight / 2 >= height) {
          const nextWidth = Math.ceil(currentWidth / 2);
          const nextHeight = Math.ceil(currentHeight / 2);
          const next = drawn(ready, current, nextWidth, nextHeight);
          if (current instanceof ImageBitmap) current.close();
          else if (current instanceof ready.OffscreenCanvas)
            current.width = current.height = 0;
          current = next;
          currentWidth = nextWidth;
          currentHeight = nextHeight;
        }
        const final =
          current instanceof ready.OffscreenCanvas &&
          currentWidth === width &&
          currentHeight === height
            ? current
            : drawn(ready, current, width, height);
        const blob = await final.convertToBlob({
          type: "image/jpeg",
          quality: Math.max(0.01, Math.min(1, quality / 100)),
        });
        final.width = final.height = 0;
        if (blob.type !== "image/jpeg") throw new Error("encoder unavailable");
        return new Uint8Array(await blob.arrayBuffer());
      } finally {
        bitmap.close(); // idempotent
        if (current instanceof ready.OffscreenCanvas)
          current.width = current.height = 0;
      }
    },
  };
}
