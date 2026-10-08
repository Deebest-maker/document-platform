import type {
  ImageErrorCode,
  ImageInput,
  ImageLimits,
  ImagePageOrientation,
  ImagePageSize,
  ImageFit,
  ImagePdfPhase,
  ImagesToPdfResult,
} from "./image-types";

export interface ImagesPdfRequest {
  readonly inputs: readonly ImageInput[];
  readonly limits: ImageLimits;
  readonly options: {
    readonly pageSize: ImagePageSize;
    readonly fit: ImageFit;
    readonly orientation: ImagePageOrientation;
  };
}

export type ImagesPdfResponse =
  | { readonly kind: "phase"; readonly phase: ImagePdfPhase }
  | { readonly kind: "result"; readonly result: ImagesToPdfResult }
  | {
      readonly kind: "error";
      readonly code: ImageErrorCode;
      readonly inputId?: string;
    };
