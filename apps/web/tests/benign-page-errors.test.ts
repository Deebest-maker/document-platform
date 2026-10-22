import { describe, expect, it } from "vitest";
import { isCancelledPrefetch } from "../e2e/benign-page-errors";

describe("isCancelledPrefetch", () => {
  it("accepts a cancelled page-payload prefetch, with or without the lead-in", () => {
    expect(
      isCancelledPrefetch(
        "Fetch API cannot load http://127.0.0.1:3100/merge-pdf?_rsc=5CB68i4pnAekjehf due to access control checks.",
      ),
    ).toBe(true);
    expect(
      isCancelledPrefetch(
        "/127.0.0.1:3100/compress-pdf?_rsc=5CB68i4pnAekjehf due to access control checks.",
      ),
    ).toBe(true);
  });

  it.each([
    [
      "a failed request for a document",
      "Fetch API cannot load http://127.0.0.1:3100/uploads/a.pdf due to access control checks.",
    ],
    [
      "a failed request to another site",
      "Fetch API cannot load https://example.com/x?_rsc=abc due to access control checks. Extra",
    ],
    [
      "a script error",
      "TypeError: undefined is not an object (evaluating 'x.y')",
    ],
    [
      "a different failure of a payload request",
      "Fetch API cannot load http://127.0.0.1:3100/merge-pdf?_rsc=abc because the server returned 500.",
    ],
    ["an empty message", ""],
  ])("still reports %s", (_name, message) => {
    expect(isCancelledPrefetch(message)).toBe(false);
  });
});
