import type {
  ImageFit,
  ImageInspection,
  ImagePageOrientation,
  ImagePageSize,
} from "./image-types";

const POINTS_PER_PIXEL = 72 / 96;
const A4 = { width: (210 / 25.4) * 72, height: (297 / 25.4) * 72 };
const LETTER = { width: 612, height: 792 };

export interface ImagePlacement {
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function imagePlacement(
  image: Pick<ImageInspection, "displayWidth" | "displayHeight">,
  pageSize: ImagePageSize,
  fit: ImageFit,
  orientation: ImagePageOrientation,
): ImagePlacement {
  const sourceLandscape = image.displayWidth > image.displayHeight;
  const landscape =
    orientation === "landscape" || (orientation === "auto" && sourceLandscape);
  let base =
    pageSize === "a4"
      ? A4
      : pageSize === "letter"
        ? LETTER
        : {
            width: Math.max(1, image.displayWidth * POINTS_PER_PIXEL),
            height: Math.max(1, image.displayHeight * POINTS_PER_PIXEL),
          };
  if (base.width > base.height !== landscape)
    base = { width: base.height, height: base.width };
  const scale =
    fit === "cover"
      ? Math.max(
          base.width / image.displayWidth,
          base.height / image.displayHeight,
        )
      : Math.min(
          base.width / image.displayWidth,
          base.height / image.displayHeight,
        );
  const width = image.displayWidth * scale;
  const height = image.displayHeight * scale;
  return {
    pageWidth: base.width,
    pageHeight: base.height,
    x: (base.width - width) / 2,
    y: (base.height - height) / 2,
    width,
    height,
  };
}

export const imagePageConstants = { POINTS_PER_PIXEL, A4, LETTER } as const;
