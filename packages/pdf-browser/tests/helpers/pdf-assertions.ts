import { readFileSync } from "node:fs";
import {
  PDFArray,
  PDFDocument,
  PDFPage,
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
type InspectedPage = {
  marker: string | undefined;
  width: number;
  height: number;
  rotation: number;
};

async function inspectPagesInternal(
  bytes: Uint8Array | ArrayBuffer,
  includeCrop: boolean,
) {
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
    const marker = /\((A[12]|B[12]|C1|D1|FORM1|SIG1|P[1-4])\)\s*Tj/.exec(
      text,
    )?.[1];
    const inspected: InspectedPage & {
      crop?: ReturnType<typeof page.getCropBox>;
    } = {
      marker,
      width: page.getWidth(),
      height: page.getHeight(),
      rotation: page.getRotation().angle,
    };
    if (includeCrop) inspected.crop = page.getCropBox();
    return inspected;
  });
}

export async function inspectPages(bytes: Uint8Array | ArrayBuffer) {
  return (await inspectPagesInternal(bytes, false)) as InspectedPage[];
}

export async function inspectPagesWithCrop(bytes: Uint8Array | ArrayBuffer) {
  return (await inspectPagesInternal(bytes, true)) as Array<
    InspectedPage & { crop: ReturnType<PDFPage["getCropBox"]> }
  >;
}
