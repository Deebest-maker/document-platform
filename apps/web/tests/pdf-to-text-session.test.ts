import { describe, expect, it, vi } from "vitest";
import { PageError } from "@document-platform/pdf-browser/pages";
import type { PreviewDocument } from "@document-platform/pdf-browser/preview";
import type {
  PdfToTextLimits,
  PdfToTextResult,
} from "@document-platform/pdf-browser/pdf-to-text";
import { PdfTextSession } from "../components/pdf-to-text/session";

const textLimits: PdfToTextLimits = {
  maxCharacters: 1_000_000,
  maxBytes: 4 * 1024 * 1024,
  maxPreviewCharacters: 32,
};

function file(name = "sensitive-source.pdf") {
  return new File(["%PDF-"], name, { type: "application/pdf" });
}

function preview(sessionId = "session", pageCount = 3): PreviewDocument {
  return {
    sessionId,
    pageCount,
    geometry: vi.fn(),
    render: vi.fn(),
    destroy: vi.fn(async () => undefined),
  };
}

function makeSession(
  overrides: {
    openPreview?: () => Promise<PreviewDocument>;
    extractText?: () => Promise<PdfToTextResult>;
    writeClipboard?: (text: string) => Promise<void>;
    createUrl?: (blob: Blob) => string;
    revokeUrl?: (url: string) => void;
  } = {},
) {
  const createdUrls: string[] = [];
  const revokedUrls: string[] = [];
  return {
    createdUrls,
    revokedUrls,
    session: new PdfTextSession(textLimits, undefined, {
      id: () => "session",
      openPreview: overrides.openPreview ?? (async () => preview()),
      extractText:
        overrides.extractText ??
        (async () => ({
          kind: "text",
          text: "Hello World",
          characters: "Hello World".length,
          bytes: new TextEncoder().encode("Hello World").byteLength,
          totalPages: 1,
          pagesWithText: 1,
          pagesWithoutText: [],
          pages: [
            {
              sourcePageNumber: 1,
              characters: "Hello World".length,
              bytes: new TextEncoder().encode("Hello World").byteLength,
              meaningful: true,
            },
          ],
        })),
      writeClipboard:
        overrides.writeClipboard ??
        vi.fn(async () => {
          /* ok */
        }),
      createUrl:
        overrides.createUrl ??
        (() => {
          const url = `blob:text-${createdUrls.length}`;
          createdUrls.push(url);
          return url;
        }),
      revokeUrl:
        overrides.revokeUrl ??
        ((url) => {
          revokedUrls.push(url);
        }),
    }),
  };
}

describe("PdfTextSession", () => {
  it("publishes a ready result with a bounded preview and the full text available for copy/download", async () => {
    const extracted = {
      kind: "text" as const,
      text: "x".repeat(200),
      characters: 200,
      bytes: 200,
      totalPages: 1,
      pagesWithText: 1,
      pagesWithoutText: [] as number[],
      pages: [
        {
          sourcePageNumber: 1,
          characters: 200,
          bytes: 200,
          meaningful: true,
        },
      ],
    };
    const harness = makeSession({ extractText: async () => extracted });
    await harness.session.setSource(file());
    const snapshot = harness.session.getSnapshot();
    expect(snapshot.state).toBe("ready");
    expect(snapshot.previewText).toHaveLength(textLimits.maxPreviewCharacters);
    expect(snapshot.previewTruncated).toBe(true);
    // The full text (200 chars) remains available for copy and download.
    expect(harness.session.getFullText()).toBe(extracted.text);
    expect(snapshot.result?.characters).toBe(200);
    expect(harness.createdUrls).toHaveLength(1);
  });

  it("announces a no-text document without creating a Blob URL", async () => {
    const extracted: PdfToTextResult = {
      kind: "no-text",
      text: "",
      characters: 0,
      bytes: 0,
      totalPages: 2,
      pagesWithText: 0,
      pagesWithoutText: [1, 2],
      pages: [
        { sourcePageNumber: 1, characters: 0, bytes: 0, meaningful: false },
        { sourcePageNumber: 2, characters: 0, bytes: 0, meaningful: false },
      ],
    };
    const harness = makeSession({ extractText: async () => extracted });
    await harness.session.setSource(file());
    expect(harness.session.getSnapshot().state).toBe("no-text");
    expect(harness.createdUrls).toHaveLength(0);
    expect(harness.session.getSnapshot().announcement).toContain(
      "may require OCR",
    );
  });

  it("records a partial-text document and keeps the valid text", async () => {
    const extracted: PdfToTextResult = {
      kind: "text",
      text: "Page one text\n\n\n\nPage three text",
      characters: 29,
      bytes: 29,
      totalPages: 3,
      pagesWithText: 2,
      pagesWithoutText: [2],
      pages: [
        { sourcePageNumber: 1, characters: 13, bytes: 13, meaningful: true },
        { sourcePageNumber: 2, characters: 0, bytes: 0, meaningful: false },
        { sourcePageNumber: 3, characters: 16, bytes: 16, meaningful: true },
      ],
    };
    const harness = makeSession({ extractText: async () => extracted });
    await harness.session.setSource(file());
    const snapshot = harness.session.getSnapshot();
    expect(snapshot.state).toBe("ready");
    expect(snapshot.pagesWithoutText).toEqual([2]);
    expect(snapshot.pagesWithText).toBe(2);
  });

  it("drops a stale result when a later call replaces the source", async () => {
    const firstTriggered = { current: 0 };
    const harness = makeSession({
      extractText: async () => {
        firstTriggered.current++;
        if (firstTriggered.current === 1) {
          // Allow the second setSource to begin while the first is pending.
          await new Promise((resolve) => setTimeout(resolve, 10));
          return {
            kind: "text",
            text: "stale",
            characters: 5,
            bytes: 5,
            totalPages: 1,
            pagesWithText: 1,
            pagesWithoutText: [] as number[],
            pages: [
              {
                sourcePageNumber: 1,
                characters: 5,
                bytes: 5,
                meaningful: true,
              },
            ],
          };
        }
        return {
          kind: "text",
          text: "fresh",
          characters: 5,
          bytes: 5,
          totalPages: 1,
          pagesWithText: 1,
          pagesWithoutText: [] as number[],
          pages: [
            {
              sourcePageNumber: 1,
              characters: 5,
              bytes: 5,
              meaningful: true,
            },
          ],
        };
      },
    });
    const firstCall = harness.session.setSource(file("one.pdf"));
    // Let the first call reach its pending extraction before it is replaced.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(firstTriggered.current).toBe(1);
    await harness.session.setSource(file("two.pdf"));
    await firstCall;
    expect(harness.session.getFullText()).toBe("fresh");
    expect(harness.session.getSnapshot().fileName).toBe("two.pdf");
  });

  it("surfaces engine errors through the error state without exposing internals", async () => {
    const harness = makeSession({
      extractText: async () => {
        throw new PageError("ENCRYPTED_PDF");
      },
    });
    await harness.session.setSource(file());
    const snapshot = harness.session.getSnapshot();
    expect(snapshot.state).toBe("error");
    expect(snapshot.error).toBe("ENCRYPTED_PDF");
    expect(snapshot.announcement).toContain("password-protected");
  });

  it("surfaces unexpected errors as OPERATION_FAILED without exposing details", async () => {
    const harness = makeSession({
      extractText: async () => {
        throw new Error("library-internal");
      },
    });
    await harness.session.setSource(file());
    const snapshot = harness.session.getSnapshot();
    expect(snapshot.state).toBe("error");
    expect(snapshot.error).toBe("OPERATION_FAILED");
  });

  it("copies the full extracted text and acknowledges the clipboard write", async () => {
    const writes: string[] = [];
    const harness = makeSession({
      writeClipboard: async (text) => {
        writes.push(text);
      },
    });
    await harness.session.setSource(file());
    await harness.session.copy();
    expect(writes).toEqual(["Hello World"]);
    expect(harness.session.getSnapshot().copyState).toBe("copied");
    harness.session.acknowledgeCopy();
    expect(harness.session.getSnapshot().copyState).toBe("idle");
  });

  it("records a clipboard failure without crashing the session", async () => {
    const harness = makeSession({
      writeClipboard: async () => {
        throw new Error("denied");
      },
    });
    await harness.session.setSource(file());
    await harness.session.copy();
    expect(harness.session.getSnapshot().copyState).toBe("failed");
    expect(harness.session.getSnapshot().error).toBe("CLIPBOARD_FAILED");
  });

  it("reset revokes the result URL and clears the session", async () => {
    const harness = makeSession();
    await harness.session.setSource(file());
    const resultUrl = harness.session.getSnapshot().result?.url;
    expect(resultUrl).toBeDefined();
    harness.session.reset();
    expect(harness.revokedUrls).toContain(resultUrl!);
    expect(harness.session.getSnapshot().state).toBe("idle");
    expect(harness.session.getFullText()).toBe("");
  });

  it("preview truncation never alters the full result used by Copy and Download", async () => {
    const full = "x".repeat(500);
    const harness = makeSession({
      extractText: async () => ({
        kind: "text" as const,
        text: full,
        characters: full.length,
        bytes: full.length,
        totalPages: 1,
        pagesWithText: 1,
        pagesWithoutText: [] as number[],
        pages: [
          {
            sourcePageNumber: 1,
            characters: full.length,
            bytes: full.length,
            meaningful: true,
          },
        ],
      }),
    });
    await harness.session.setSource(file());
    const snapshot = harness.session.getSnapshot();
    // Preview is bounded by maxPreviewCharacters (32 in the test limits).
    expect(snapshot.previewText?.length).toBeLessThanOrEqual(
      textLimits.maxPreviewCharacters,
    );
    expect(snapshot.previewTruncated).toBe(true);
    // The full result is unchanged by preview truncation. Copy pulls the
    // full text; Download's Blob was built from the full text too.
    expect(harness.session.getFullText()).toBe(full);
    expect(snapshot.result?.characters).toBe(500);
  });

  it("publishes NO Blob URL and NO clipboard write when extraction hits the full-result cap", async () => {
    const writes: string[] = [];
    const harness = makeSession({
      extractText: async () => {
        throw new PageError("OUTPUT_LIMIT");
      },
      writeClipboard: async (text) => {
        writes.push(text);
      },
    });
    await harness.session.setSource(file());
    const snapshot = harness.session.getSnapshot();
    // The engine throws OUTPUT_LIMIT; the session treats it as an error
    // state and MUST NOT publish any partial result.
    expect(snapshot.state).toBe("error");
    expect(snapshot.error).toBe("OUTPUT_LIMIT");
    expect(snapshot.result).toBeUndefined();
    expect(snapshot.previewText).toBeUndefined();
    expect(harness.session.getFullText()).toBe("");
    expect(harness.createdUrls).toEqual([]);
    // Copy must be a no-op on an error state — the session's own guard.
    await harness.session.copy();
    expect(writes).toEqual([]);
  });

  it("does not place the source filename inside the result URL or clipboard payload", async () => {
    const writes: string[] = [];
    const harness = makeSession({
      writeClipboard: async (text) => {
        writes.push(text);
      },
    });
    await harness.session.setSource(file("MY-SECRET-NAME.pdf"));
    await harness.session.copy();
    expect(harness.createdUrls.join("\n")).not.toContain("MY-SECRET-NAME");
    expect(writes.join("\n")).not.toContain("MY-SECRET-NAME");
  });
});
