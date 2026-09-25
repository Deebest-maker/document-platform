import { readFileSync } from "node:fs";
import {
  PDFArray,
  PDFDocument,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";

export const fixtureRoot = new URL(
  "../../../../tests/fixtures/pdf/",
  import.meta.url,
);
export const fixtureBytes = (name: string) =>
  new Uint8Array(readFileSync(new URL(name, fixtureRoot)));

// This reader is deliberately limited to the controlled synthetic content streams.
// It is a test oracle, not a general text extractor or a production feature.
export async function inspectPages(bytes: Uint8Array | ArrayBuffer) {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  return document.getPages().map((page) => {
    const content = page.node.Contents();
    const streams =
      content instanceof PDFArray
        ? Array.from({ length: content.size() }, (_, index) =>
            content.lookup(index, PDFRawStream),
          )
        : content instanceof PDFRawStream
          ? [content]
          : [];
    const text = streams
      .map((stream) =>
        new TextDecoder().decode(decodePDFRawStream(stream).decode()),
      )
      .join("\n");
    const marker = /\((A[12]|B[12]|C1|D1|FORM1|SIG1)\)\s*Tj/.exec(text)?.[1];
    return {
      marker,
      width: page.getWidth(),
      height: page.getHeight(),
      rotation: page.getRotation().angle,
    };
  });
}
