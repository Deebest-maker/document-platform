import { expect, it, vi } from "vitest";
import { PreviewSession } from "../components/pdf-preview/preview-session";
import {
  PdfTextSession,
  pdfTextErrorCopy,
} from "../components/pdf-to-text/session";
import { pageToolErrors } from "../components/page-tools/copy";
import { compressErrorCopy } from "../components/compress-pdf/session";
import { removeMetadataErrorCopy } from "../components/remove-pdf-metadata/session";
import { errorCopy as mergeErrorCopy } from "../components/merge/session";
import { imageErrorCopy } from "../components/images-to-pdf/session";

// M7H (ADR-038). The tool's code is fetched when the first file is chosen. If
// the connection has dropped by then, the import rejects. These sessions run
// their real default imports against a module that cannot load, the way a
// failed chunk request does, and must say so instead of blaming the PDF.
vi.mock("@document-platform/pdf-browser/preview", () => {
  throw new Error("Loading chunk 7 failed.");
});

const file = () =>
  new File(["%PDF-synthetic"], "private-name.pdf", { type: "application/pdf" });

it("the page tools report a code that could not load as a connection problem", async () => {
  const session = new PreviewSession({ id: () => "one" });
  await session.setSource(file());
  const snapshot = session.getSnapshot();
  expect(snapshot.state).toBe("error");
  expect(snapshot.error).toBe("ENGINE_LOAD_FAILED");
  expect(snapshot.announcement).toMatch(/connection/i);
  expect(snapshot.announcement).not.toMatch(/another PDF|preview could not/i);
});

it("PDF to Text reports a code that could not load as a connection problem", async () => {
  const session = new PdfTextSession({
    maxCharacters: 1_000_000,
    maxBytes: 4 * 1024 * 1024,
    maxPreviewCharacters: 32,
  });
  await session.setSource(file());
  const snapshot = session.getSnapshot();
  expect(snapshot.state).toBe("error");
  expect(snapshot.error).toBe("ENGINE_LOAD_FAILED");
  expect(snapshot.announcement).toBe(pdfTextErrorCopy.ENGINE_LOAD_FAILED);
});

it("every tool words a load failure as the connection and says to try again", () => {
  for (const words of [
    pageToolErrors.ENGINE_LOAD_FAILED,
    pdfTextErrorCopy.ENGINE_LOAD_FAILED,
    compressErrorCopy.ENGINE_LOAD_FAILED,
    removeMetadataErrorCopy.ENGINE_LOAD_FAILED,
    mergeErrorCopy.ENGINE_LOAD_FAILED,
    imageErrorCopy.ENGINE_LOAD_FAILED,
  ]) {
    expect(words).toMatch(/connection/i);
    expect(words).toMatch(/try again/i);
    expect(words).not.toMatch(/another (PDF|file)|damaged|too large|memory/i);
  }
});
