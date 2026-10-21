import {
  MAX_CANVAS_PIXELS,
  RECODE_QUALITY_MARGIN,
  RESAMPLE_TOLERANCE,
  type CompressProfile,
  type ImageSkipReason,
} from "./compress-types";

export interface ImagePlanInput {
  readonly width: number;
  readonly height: number;
  // Largest size at which the image is drawn on any page, in points.
  readonly usedWidth: number;
  readonly usedHeight: number;
  readonly kind: "jpeg" | "raster";
  // Estimated source quality for JPEG images (undefined if unknown).
  readonly jpegQuality?: number;
}

export type ImagePlan =
  | { readonly action: "skip"; readonly reason: ImageSkipReason }
  | {
      readonly action: "recode";
      readonly width: number;
      readonly height: number;
      readonly resized: boolean;
    };

// Effective resolution: pixels per inch along the less-sampled axis, so that a
// stretched image is never reduced below the target on either axis.
export function effectiveDpi(input: ImagePlanInput): number {
  return Math.min(
    input.width / (input.usedWidth / 72),
    input.height / (input.usedHeight / 72),
  );
}

export function planImage(
  input: ImagePlanInput,
  profile: CompressProfile,
): ImagePlan {
  if (
    !(input.usedWidth > 0 && input.usedHeight > 0) ||
    !Number.isFinite(input.usedWidth) ||
    !Number.isFinite(input.usedHeight)
  )
    return { action: "skip", reason: "no_size" };
  const dpi = effectiveDpi(input);
  if (dpi > profile.targetDpi * RESAMPLE_TOLERANCE) {
    const scale = profile.targetDpi / dpi;
    const width = Math.max(1, Math.round(input.width * scale));
    const height = Math.max(1, Math.round(input.height * scale));
    if (width >= input.width && height >= input.height)
      return { action: "skip", reason: "at_target" };
    if (width * height > MAX_CANVAS_PIXELS)
      return { action: "skip", reason: "too_large" };
    return { action: "recode", width, height, resized: true };
  }
  if (
    input.kind === "jpeg" &&
    input.jpegQuality !== undefined &&
    input.jpegQuality > profile.jpegQuality + RECODE_QUALITY_MARGIN
  ) {
    if (input.width * input.height > MAX_CANVAS_PIXELS)
      return { action: "skip", reason: "too_large" };
    return {
      action: "recode",
      width: input.width,
      height: input.height,
      resized: false,
    };
  }
  return { action: "skip", reason: "at_target" };
}
