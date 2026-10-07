import { describe, expect, it } from "vitest";
import { imagePageConstants, imagePlacement } from "../src/image-layout";

describe("image page geometry", () => {
  it("maps Auto pixels at 96 px/in and follows source orientation", () => {
    expect(
      imagePlacement(
        { displayWidth: 1200, displayHeight: 800 },
        "auto",
        "contain",
        "auto",
      ),
    ).toEqual({
      pageWidth: 900,
      pageHeight: 600,
      x: 0,
      y: 0,
      width: 900,
      height: 600,
    });
  });

  it("uses exact A4 points and contains without cropping", () => {
    const placement = imagePlacement(
      { displayWidth: 1000, displayHeight: 500 },
      "a4",
      "contain",
      "portrait",
    );
    expect(placement.pageWidth).toBeCloseTo(imagePageConstants.A4.width, 6);
    expect(placement.pageHeight).toBeCloseTo(imagePageConstants.A4.height, 6);
    expect(placement.width / placement.height).toBeCloseTo(2, 10);
    expect(placement.width).toBeCloseTo(placement.pageWidth, 6);
    expect(placement.y).toBeGreaterThan(0);
  });

  it("covers Letter landscape without distortion and crops symmetrically", () => {
    const placement = imagePlacement(
      { displayWidth: 500, displayHeight: 1000 },
      "letter",
      "cover",
      "landscape",
    );
    expect([placement.pageWidth, placement.pageHeight]).toEqual([792, 612]);
    expect(placement.width / placement.height).toBeCloseTo(0.5, 10);
    expect(placement.width).toBeCloseTo(792, 10);
    expect(placement.height).toBeCloseTo(1584, 10);
    expect(placement.y).toBeLessThan(0);
  });
});
