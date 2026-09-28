import type { PageGeometry } from "../page-model";

export interface ThumbnailSize {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
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
  destroy(): Promise<void>;
}
export interface PreviewOptions {
  readonly signal?: AbortSignal;
}
