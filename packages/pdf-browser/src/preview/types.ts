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
  destroy(): Promise<void>;
}
export interface PreviewOptions {
  readonly signal?: AbortSignal;
}
