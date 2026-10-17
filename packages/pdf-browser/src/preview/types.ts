import type { PageGeometry } from "../page-model";

export interface ThumbnailSize {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
}
export interface JpegRenderOptions {
  readonly dpi: 96 | 150 | 300;
  readonly quality: number;
  readonly maxPixels: number;
  readonly maxCanvasBytes: number;
  readonly signal?: AbortSignal;
}
export interface JpegRenderResult {
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
}
export interface TextExtractionOptions {
  readonly signal?: AbortSignal;
}
export interface PageTextContent {
  // The deterministic plain-text body of a single page, assembled from
  // PDF.js's natural content-item order and its explicit `hasEOL` signal.
  // No raw PDF.js TextItem/MarkedContent object crosses this boundary.
  readonly text: string;
}
export interface PreviewDocument {
  readonly sessionId: string;
  readonly pageCount: number;
  geometry(sourcePageNumber: number): Promise<PageGeometry>;
  render(
    sourcePageNumber: number,
    canvas: HTMLCanvasElement,
    rotationDelta: number,
    size: ThumbnailSize,
    signal?: AbortSignal,
  ): Promise<void>;
  renderJpeg?(
    sourcePageNumber: number,
    options: JpegRenderOptions,
  ): Promise<JpegRenderResult>;
  extractText?(
    sourcePageNumber: number,
    options?: TextExtractionOptions,
  ): Promise<PageTextContent>;
  destroy(): Promise<void>;
}
export interface PreviewOptions {
  readonly signal?: AbortSignal;
}
