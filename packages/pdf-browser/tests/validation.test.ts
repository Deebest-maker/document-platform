import { describe, expect, it } from "vitest";
import {
  validateMergeInputs,
  validatePdfCandidate,
  readPdfBytes,
} from "../src/validation";

const limits = {
  maxFiles: 3,
  maxFileBytes: 100,
  maxTotalBytes: 150,
  maxPages: 10,
  maxOutputBytes: 150,
};
const input = (size: number) => ({
  id: "opaque",
  blob: new Blob([new Uint8Array(size)]),
});

describe("FR-GEN-002/003: layered local validation", () => {
  it("requires a PDF extension, allows generic MIME hints and rejects empty/oversized files", () => {
    expect(
      validatePdfCandidate({ name: "EXAMPLE.PDF", type: "", size: 10 }, limits),
    ).toBeUndefined();
    expect(
      validatePdfCandidate(
        { name: "example.pdf", type: "application/octet-stream", size: 10 },
        limits,
      ),
    ).toBeUndefined();
    expect(
      validatePdfCandidate(
        { name: "example.jpg", type: "application/pdf", size: 10 },
        limits,
      ),
    ).toBe("UNSUPPORTED_TYPE");
    expect(
      validatePdfCandidate(
        { name: "example.pdf", type: "image/jpeg", size: 10 },
        limits,
      ),
    ).toBe("UNSUPPORTED_TYPE");
    expect(
      validatePdfCandidate(
        { name: "example.pdf", type: "application/pdf", size: 0 },
        limits,
      ),
    ).toBe("EMPTY_INPUT");
    expect(
      validatePdfCandidate(
        { name: "example.pdf", type: "application/pdf", size: 101 },
        limits,
      ),
    ).toBe("INPUT_LIMIT");
  });
  it("enforces the two-file minimum and file/combined-byte bounds before reading", () => {
    expect(() => validateMergeInputs([input(1)], limits)).toThrow(
      "INPUT_COUNT",
    );
    expect(() =>
      validateMergeInputs([input(1), input(1), input(1), input(1)], limits),
    ).toThrow("INPUT_LIMIT");
    expect(() => validateMergeInputs([input(0), input(1)], limits)).toThrow(
      "EMPTY_INPUT",
    );
    expect(() => validateMergeInputs([input(101), input(1)], limits)).toThrow(
      "INPUT_LIMIT",
    );
    expect(() => validateMergeInputs([input(76), input(75)], limits)).toThrow(
      "INPUT_LIMIT",
    );
    expect(() =>
      validateMergeInputs([input(75), input(75)], limits),
    ).not.toThrow();
    expect(() =>
      validateMergeInputs([input(1), input(1)], {
        ...limits,
        maxPages: Infinity,
      }),
    ).toThrow("INPUT_LIMIT");
  });
  it("rejects spoofed content and maps read exceptions without leaking them", async () => {
    await expect(
      readPdfBytes({
        id: "one",
        blob: new Blob(["not a PDF"], { type: "application/pdf" }),
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_TYPE" });
    const unreadable = new Blob(["%PDF-"]);
    unreadable.arrayBuffer = async () => {
      throw new Error("PRIVATE CONTENT MUST NOT ESCAPE");
    };
    await expect(
      readPdfBytes({ id: "two", blob: unreadable }),
    ).rejects.toMatchObject({
      code: "UNREADABLE_FILE",
      message: "UNREADABLE_FILE",
    });
  });
});
