import {
  inspectImageBlob,
  stripJpegExif,
  validateInspection,
} from "@document-platform/pdf-browser/image-inspection";
import {
  ImagePdfError,
  type ImageErrorCode,
  type ImageFit,
  type ImageInspection,
  type ImageLimits,
  type ImageMime,
  type ImagePageOrientation,
  type ImagePageSize,
  type ImagePdfPhase,
  type ImagesToPdfResult,
} from "@document-platform/pdf-browser/image-types";

export type ImageWorkflowError = ImageErrorCode | "ENGINE_LOAD_FAILED";
export const imageErrorCopy: Record<ImageWorkflowError, string> = {
  INPUT_COUNT: "Choose between 1 and 20 images.",
  EMPTY_INPUT: "This image is empty. Remove it and choose another image.",
  UNSUPPORTED_TYPE: "Choose a JPEG or PNG whose filename and file type agree.",
  SIGNATURE_MISMATCH:
    "This file does not contain the JPEG or PNG data its name declares.",
  INVALID_IMAGE: "This image is damaged or cannot be decoded safely.",
  INPUT_LIMIT: "The selection exceeds the current compressed-size limits.",
  DIMENSION_LIMIT: "This image is wider or taller than the current safe limit.",
  PIXEL_LIMIT: "This image would require too much decoded pixel memory.",
  AGGREGATE_PIXEL_LIMIT:
    "The selected images exceed the current combined decoded-pixel limit.",
  OUTPUT_LIMIT: "The generated PDF exceeds the current output-size limit.",
  OUTPUT_INVALID:
    "The result could not be validated, so no download was created.",
  PREVIEW_FAILED: "A local preview could not be created for this image.",
  GENERATION_FAILED:
    "The PDF could not be generated. Try fewer or smaller images.",
  CANCELLED: "Generation cancelled. Your selected images are still here.",
  WORKER_UNAVAILABLE:
    "This browser could not start local processing. Try an up-to-date browser.",
  ENGINE_LOAD_FAILED:
    "The local PDF engine could not load. Check your connection and try again.",
};

export interface ImageRow {
  readonly id: string;
  readonly file: File;
  readonly status: "loading" | "ready" | "error";
  readonly inspection?: ImageInspection;
  readonly generationBlob?: Blob;
  readonly previewUrl?: string;
  readonly error?: ImageWorkflowError;
}

interface Result extends ImagesToPdfResult {
  readonly url: string;
}

export interface ImageSnapshot {
  readonly state:
    "idle" | "loading" | "ready" | "generating" | "result" | "error";
  readonly rows: readonly ImageRow[];
  readonly pageSize: ImagePageSize;
  readonly fit: ImageFit;
  readonly orientation: ImagePageOrientation;
  readonly phase?: ImagePdfPhase;
  readonly error?: ImageWorkflowError;
  readonly result?: Result;
  readonly announcement: string;
}

type Engine = (
  inputs: readonly {
    id: string;
    blob: Blob;
    inspection: ImageInspection;
  }[],
  limits: ImageLimits,
  options: {
    pageSize: ImagePageSize;
    fit: ImageFit;
    orientation: ImagePageOrientation;
    signal?: AbortSignal;
    onPhase?: (phase: ImagePdfPhase) => void;
  },
) => Promise<ImagesToPdfResult>;

interface Dependencies {
  load: () => Promise<{ imagesToPdf: Engine }>;
  inspect: typeof inspectImageBlob;
  preview: (file: File, inspection: ImageInspection) => Promise<Blob>;
  normalize: (file: File, inspection: ImageInspection) => Promise<Blob>;
  createUrl: (blob: Blob) => string;
  revokeUrl: (url: string) => void;
  id: () => string;
}

function orientCanvas(
  context: CanvasRenderingContext2D,
  orientation: ImageInspection["orientation"],
  width: number,
  height: number,
) {
  const transforms = {
    1: [1, 0, 0, 1, 0, 0],
    2: [-1, 0, 0, 1, width, 0],
    3: [-1, 0, 0, -1, width, height],
    4: [1, 0, 0, -1, 0, height],
    5: [0, 1, 1, 0, 0, 0],
    6: [0, 1, -1, 0, height, 0],
    7: [0, -1, -1, 0, height, width],
    8: [0, -1, 1, 0, 0, width],
  } as const;
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

async function normalizeForGeneration(file: File, inspection: ImageInspection) {
  if (inspection.mime !== "image/jpeg" || inspection.orientation === 1)
    return file;
  const encoded = new Uint8Array(await file.arrayBuffer());
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(
      new Blob([stripJpegExif(encoded)], { type: "image/jpeg" }),
      { imageOrientation: "none" },
    );
    const rawDimensions =
      bitmap.width === inspection.width && bitmap.height === inspection.height;
    const displayDimensions =
      bitmap.width === inspection.displayWidth &&
      bitmap.height === inspection.displayHeight;
    if (!rawDimensions && !displayDimensions)
      throw new ImagePdfError("INVALID_IMAGE");
    const canvas = document.createElement("canvas");
    canvas.width = inspection.displayWidth;
    canvas.height = inspection.displayHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new ImagePdfError("PREVIEW_FAILED");
    if (rawDimensions)
      orientCanvas(
        context,
        inspection.orientation,
        bitmap.width,
        bitmap.height,
      );
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new ImagePdfError("INVALID_IMAGE")),
        "image/jpeg",
        0.92,
      ),
    );
  } finally {
    bitmap?.close();
  }
}

async function createPreview(file: File, inspection: ImageInspection) {
  const scale = Math.min(
    1,
    320 / Math.max(inspection.displayWidth, inspection.displayHeight),
  );
  const previewWidth = Math.max(1, Math.round(inspection.displayWidth * scale));
  const previewHeight = Math.max(
    1,
    Math.round(inspection.displayHeight * scale),
  );
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
      resizeWidth: previewWidth,
      resizeHeight: previewHeight,
      resizeQuality: "high",
    });
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new ImagePdfError("PREVIEW_FAILED");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new ImagePdfError("PREVIEW_FAILED")),
        "image/jpeg",
        0.82,
      ),
    );
  } finally {
    bitmap?.close();
  }
}

const defaults: Dependencies = {
  load: () => import("@document-platform/pdf-browser/images"),
  inspect: inspectImageBlob,
  preview: createPreview,
  normalize: normalizeForGeneration,
  createUrl: (blob) => URL.createObjectURL(blob),
  revokeUrl: (url) => URL.revokeObjectURL(url),
  id: () => crypto.randomUUID(),
};

const empty = (): ImageSnapshot => ({
  state: "idle",
  rows: [],
  pageSize: "auto",
  fit: "contain",
  orientation: "auto",
  announcement: "",
});

function declaredMime(file: File): ImageMime | undefined {
  const extension = (file.name.match(/\.[^.]+$/)?.[0] ?? "").toLowerCase();
  if ([".jpg", ".jpeg"].includes(extension) && file.type === "image/jpeg")
    return "image/jpeg";
  if (extension === ".png" && file.type === "image/png") return "image/png";
  return undefined;
}

export class ImagesToPdfSession {
  private snapshot: ImageSnapshot = empty();
  private listeners = new Set<() => void>();
  private generation = 0;
  private abort?: AbortController;
  private readonly dependencies: Dependencies;

  constructor(
    readonly limits: ImageLimits,
    dependencies: Partial<Dependencies> = {},
  ) {
    this.dependencies = { ...defaults, ...dependencies };
  }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(next: ImageSnapshot) {
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }
  private releaseRow(row: ImageRow) {
    if (row.previewUrl) this.dependencies.revokeUrl(row.previewUrl);
  }
  private releaseResult() {
    if (this.snapshot.result)
      this.dependencies.revokeUrl(this.snapshot.result.url);
  }
  private stateFor(rows: readonly ImageRow[], error?: ImageWorkflowError) {
    if (error || rows.some((row) => row.status === "error")) return "error";
    if (rows.some((row) => row.status === "loading")) return "loading";
    return rows.length ? "ready" : "idle";
  }
  private select(
    rows: readonly ImageRow[],
    announcement: string,
    error?: ImageWorkflowError,
  ) {
    this.publish({
      ...this.snapshot,
      state: this.stateFor(rows, error),
      rows,
      error,
      phase: undefined,
      result: undefined,
      announcement,
    });
  }
  private abandon() {
    this.generation++;
    this.abort?.abort();
    this.abort = undefined;
    this.releaseResult();
  }

  async add(files: readonly File[]) {
    if (
      ["generating", "result"].includes(this.snapshot.state) ||
      files.length === 0
    )
      return;
    if (this.snapshot.rows.length + files.length > this.limits.maxFiles) {
      this.select(
        this.snapshot.rows,
        "No images added. Image count limit exceeded.",
        "INPUT_COUNT",
      );
      return;
    }
    const token = this.generation;
    const existingBytes = this.snapshot.rows.reduce(
      (sum, row) => sum + row.file.size,
      0,
    );
    let runningBytes = existingBytes;
    const additions = files.map<ImageRow>((file) => {
      runningBytes += file.size;
      const error = !file.size
        ? "EMPTY_INPUT"
        : !declaredMime(file)
          ? "UNSUPPORTED_TYPE"
          : file.size > this.limits.maxFileBytes ||
              runningBytes > this.limits.maxTotalBytes
            ? "INPUT_LIMIT"
            : undefined;
      return {
        id: this.dependencies.id(),
        file,
        status: error ? "error" : "loading",
        error,
      };
    });
    this.select(
      [...this.snapshot.rows, ...additions],
      `${files.length} ${files.length === 1 ? "image" : "images"} added.`,
    );
    for (const addition of additions) {
      if (addition.error || token !== this.generation) continue;
      try {
        const mime = declaredMime(addition.file)!;
        const inspection = await this.dependencies.inspect(addition.file, mime);
        validateInspection(inspection, this.limits, addition.id);
        if (token !== this.generation) return;
        const otherPixels = this.snapshot.rows.reduce(
          (sum, row) =>
            sum + (row.id === addition.id ? 0 : (row.inspection?.pixels ?? 0)),
          0,
        );
        if (
          otherPixels + inspection.pixels > this.limits.maxAggregatePixels ||
          (otherPixels + inspection.pixels) * 4 >
            this.limits.maxAggregateDecodedBytes
        )
          throw new ImagePdfError("AGGREGATE_PIXEL_LIMIT", addition.id);
        const generationBlob = await this.dependencies.normalize(
          addition.file,
          inspection,
        );
        if (token !== this.generation) return;
        const preview = await this.dependencies.preview(
          addition.file,
          inspection,
        );
        if (token !== this.generation) return;
        const previewUrl = this.dependencies.createUrl(preview);
        const rows = this.snapshot.rows.map((row) =>
          row.id === addition.id
            ? {
                ...row,
                status: "ready" as const,
                inspection,
                generationBlob,
                previewUrl,
              }
            : row,
        );
        if (!rows.some((row) => row.id === addition.id)) {
          this.dependencies.revokeUrl(previewUrl);
          continue;
        }
        this.select(rows, "Image preview ready.");
      } catch (caught) {
        if (token !== this.generation) return;
        const code =
          caught instanceof ImagePdfError ? caught.code : "PREVIEW_FAILED";
        this.select(
          this.snapshot.rows.map((row) =>
            row.id === addition.id
              ? { ...row, status: "error" as const, error: code }
              : row,
          ),
          "An image needs attention.",
        );
      }
    }
  }

  remove(id: string) {
    if (["generating", "result"].includes(this.snapshot.state)) return;
    const row = this.snapshot.rows.find((candidate) => candidate.id === id);
    if (row) this.releaseRow(row);
    this.select(
      this.snapshot.rows.filter((candidate) => candidate.id !== id),
      "Image removed.",
    );
  }

  move(id: string, offset: -1 | 1) {
    if (["loading", "generating", "result"].includes(this.snapshot.state))
      return;
    const rows = [...this.snapshot.rows];
    const from = rows.findIndex((row) => row.id === id);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= rows.length) return;
    [rows[from], rows[to]] = [rows[to], rows[from]];
    this.select(rows, `Image moved to position ${to + 1} of ${rows.length}.`);
  }

  setOptions(
    next: Partial<Pick<ImageSnapshot, "pageSize" | "fit" | "orientation">>,
  ) {
    if (["generating", "result"].includes(this.snapshot.state)) return;
    this.publish({
      ...this.snapshot,
      ...next,
      announcement: "Layout updated.",
    });
  }

  canGenerate() {
    return (
      this.snapshot.rows.length > 0 &&
      this.snapshot.rows.every(
        (row) => row.status === "ready" && row.inspection,
      ) &&
      !["generating", "result"].includes(this.snapshot.state)
    );
  }

  async generate() {
    if (!this.canGenerate()) return;
    this.abandon();
    const token = this.generation;
    const controller = new AbortController();
    this.abort = controller;
    const rows = this.snapshot.rows;
    this.publish({
      ...this.snapshot,
      state: "generating",
      phase: "reading",
      announcement: "Loading the local PDF engine.",
    });
    let engine: { imagesToPdf: Engine };
    try {
      engine = await this.dependencies.load();
    } catch {
      if (token === this.generation)
        this.select(rows, "", "ENGINE_LOAD_FAILED");
      return;
    }
    if (token !== this.generation) return;
    try {
      const result = await engine.imagesToPdf(
        rows.map((row) => ({
          id: row.id,
          blob: row.generationBlob ?? row.file,
          inspection:
            row.inspection!.orientation === 1
              ? row.inspection!
              : {
                  ...row.inspection!,
                  width: row.inspection!.displayWidth,
                  height: row.inspection!.displayHeight,
                  orientation: 1 as const,
                },
        })),
        this.limits,
        {
          pageSize: this.snapshot.pageSize,
          fit: this.snapshot.fit,
          orientation: this.snapshot.orientation,
          signal: controller.signal,
          onPhase: (phase) => {
            if (token === this.generation)
              this.publish({ ...this.snapshot, phase });
          },
        },
      );
      if (token !== this.generation) return;
      const url = this.dependencies.createUrl(result.blob);
      this.abort = undefined;
      this.publish({
        ...this.snapshot,
        state: "result",
        phase: undefined,
        result: { ...result, url },
        announcement: "Your PDF is ready.",
      });
    } catch (caught) {
      if (token !== this.generation) return;
      this.abort = undefined;
      const code =
        caught instanceof ImagePdfError ? caught.code : "GENERATION_FAILED";
      const inputId =
        caught instanceof ImagePdfError ? caught.inputId : undefined;
      this.select(
        rows.map((row) =>
          inputId === row.id
            ? { ...row, status: "error" as const, error: code }
            : row,
        ),
        "",
        code,
      );
    }
  }

  cancel() {
    if (this.snapshot.state !== "generating") return;
    this.abandon();
    this.select(
      this.snapshot.rows,
      "Generation cancelled. Your selected images are still here.",
    );
  }

  reset = () => {
    this.abandon();
    this.snapshot.rows.forEach((row) => this.releaseRow(row));
    this.publish({
      ...empty(),
      announcement: "Session cleared. Choose images to start again.",
    });
  };

  dispose = () => {
    this.reset();
    this.snapshot = empty();
  };
}

export function safeImageName(name: string) {
  return (
    (name.split(/[\\/]/).pop() ?? "Image")
      .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "")
      .slice(0, 160) || "Image"
  );
}

export const formatImageBytes = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.ceil(bytes / 1024))} KiB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
