import { describe, expect, it } from "vitest";
import { effectiveDpi, planImage } from "../src/compress-plan";
import { MAX_CANVAS_PIXELS, compressProfiles } from "../src/compress-types";

const balanced = compressProfiles.balanced;
// 2400 px drawn 8 inch (576 pt) wide: 300 dpi.
const photo = { width: 2400, height: 1600, usedWidth: 576, usedHeight: 384 };

describe("image planner", () => {
  it("computes effective resolution on the weaker axis", () => {
    expect(effectiveDpi({ ...photo, kind: "jpeg" })).toBeCloseTo(300, 5);
    expect(
      effectiveDpi({
        width: 3000,
        height: 600,
        usedWidth: 720,
        usedHeight: 432,
        kind: "raster",
      }),
    ).toBeCloseTo(100, 5);
  });

  it("downsamples images well above the target resolution", () => {
    expect(
      planImage({ ...photo, kind: "jpeg", jpegQuality: 70 }, balanced),
    ).toEqual({
      action: "recode",
      width: 1200,
      height: 800,
      resized: true,
    });
  });

  it("uses each profile's target resolution", () => {
    const widths = (["light", "balanced", "strong"] as const).map((id) => {
      const plan = planImage(
        { ...photo, kind: "raster" },
        compressProfiles[id],
      );
      return plan.action === "recode" ? plan.width : 0;
    });
    expect(widths).toEqual([1760, 1200, 880]);
  });

  it("leaves images within the tolerance of the target alone", () => {
    // 150 dpi * 1.25 = 187.5: 180 dpi is close enough to the target.
    const near = { width: 1440, height: 960, usedWidth: 576, usedHeight: 384 };
    expect(effectiveDpi({ ...near, kind: "raster" })).toBeCloseTo(180, 5);
    expect(planImage({ ...near, kind: "raster" }, balanced)).toEqual({
      action: "skip",
      reason: "at_target",
    });
  });

  it("never enlarges", () => {
    const small = { width: 300, height: 200, usedWidth: 576, usedHeight: 384 };
    expect(
      planImage({ ...small, kind: "jpeg", jpegQuality: 99 }, balanced),
    ).toMatchObject({
      action: "recode",
      resized: false,
      width: 300,
    });
    expect(planImage({ ...small, kind: "raster" }, balanced)).toEqual({
      action: "skip",
      reason: "at_target",
    });
  });

  it("re-encodes an at-target JPEG only if its quality is clearly higher", () => {
    const at = { width: 1200, height: 800, usedWidth: 576, usedHeight: 384 };
    const quality = (q: number) =>
      planImage({ ...at, kind: "jpeg", jpegQuality: q }, balanced);
    expect(quality(95)).toMatchObject({ action: "recode", resized: false });
    expect(quality(84)).toMatchObject({ action: "recode" }); // 75 + 8 < 84
    expect(quality(83)).toEqual({ action: "skip", reason: "at_target" });
    expect(quality(60)).toEqual({ action: "skip", reason: "at_target" });
    expect(planImage({ ...at, kind: "jpeg" }, balanced)).toEqual({
      action: "skip",
      reason: "at_target",
    });
  });

  it("skips images with no usable placement", () => {
    for (const [usedWidth, usedHeight] of [
      [0, 10],
      [10, 0],
      [Number.NaN, 5],
      [Infinity, 5],
    ])
      expect(
        planImage({ ...photo, usedWidth, usedHeight, kind: "jpeg" }, balanced),
      ).toEqual({
        action: "skip",
        reason: "no_size",
      });
  });

  it("keeps a minimum of one pixel", () => {
    const plan = planImage(
      {
        width: 4000,
        height: 4000,
        usedWidth: 0.01,
        usedHeight: 0.01,
        kind: "raster",
      },
      balanced,
    );
    expect(plan).toMatchObject({ action: "recode", width: 1, height: 1 });
  });

  it("refuses targets that would need an oversized canvas", () => {
    const huge = {
      width: 20_000,
      height: 12_000,
      usedWidth: 5000,
      usedHeight: 3000,
    };
    expect(planImage({ ...huge, kind: "raster" }, balanced)).toEqual({
      action: "skip",
      reason: "too_large",
    });
    const bigJpeg = {
      width: 5000,
      height: MAX_CANVAS_PIXELS / 5000 + 1,
      usedWidth: 5000,
      usedHeight: 3300,
    };
    expect(
      planImage({ ...bigJpeg, kind: "jpeg", jpegQuality: 95 }, balanced),
    ).toEqual({
      action: "skip",
      reason: "too_large",
    });
  });
});
