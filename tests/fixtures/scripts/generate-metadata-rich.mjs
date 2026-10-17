// Generates tests/fixtures/pdf/metadata-rich.pdf — a tiny synthetic PDF with
// every supported Info field, two custom Info keys, an XMP metadata stream,
// and multi-page geometry including one rotated page. Deliberately includes
// canary strings that the Remove PDF Metadata E2E and benchmark check are
// absent from any outbound request body (privacy canary).
//
// Run from the repo root:
//   node tests/fixtures/scripts/generate-metadata-rich.mjs
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(
  new URL("../../../packages/pdf-browser/package.json", import.meta.url),
);
const { PDFDocument, PDFName, PDFString } = require("pdf-lib");

const outPath = fileURLToPath(
  new URL("../pdf/metadata-rich.pdf", import.meta.url),
);

const doc = await PDFDocument.create();
for (let i = 0; i < 3; i++) {
  const page = doc.addPage([612, 792]);
  page.drawText(`page ${i + 1}`, { x: 60, y: 720, size: 14 });
}
doc.getPage(1).setRotation({ type: "degrees", angle: 90 });

// Standard Info fields (every one from ISO 32000-1 §14.3.3).
doc.setTitle("SECRET-TITLE-CANARY-9Hjk");
doc.setAuthor("SECRET-AUTHOR-CANARY-2Fqz");
doc.setSubject("subject-canary-7Rw");
doc.setKeywords(["kw-canary-1", "kw-canary-2"]);
doc.setCreator("creator-canary-M8");
doc.setProducer("producer-canary-X4");
doc.setCreationDate(new Date("2024-01-01T00:00:00Z"));
doc.setModificationDate(new Date("2024-06-01T00:00:00Z"));

// pdf-lib has no /Trapped setter, and PDFDocument.getInfoDict() is internal,
// so every low-level Info write goes through the dictionary directly.
// Two custom Info entries plus /Trapped.
const infoRef = doc.context.trailerInfo.Info;
if (infoRef) {
  const infoDict = doc.context.lookup(infoRef);
  infoDict.set(
    PDFName.of("AcmeInternalCanary"),
    PDFString.of("ACME-INTERNAL-CANARY-X3b"),
  );
  infoDict.set(PDFName.of("InternalTag"), PDFString.of("not-for-sharing"));
  infoDict.set(PDFName.of("Trapped"), PDFName.of("False"));
} else {
  throw new Error("Info dictionary missing; cannot write /Trapped");
}

// XMP metadata stream (minimal).
const xmp = `<?xml version="1.0"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/">XMP-CANARY-V7m</x:xmpmeta>`;
const stream = doc.context.flateStream(xmp, {
  Type: PDFName.of("Metadata"),
  Subtype: PDFName.of("XML"),
});
const streamRef = doc.context.register(stream);
doc.catalog.set(PDFName.of("Metadata"), streamRef);

const bytes = await doc.save({ useObjectStreams: false });
await writeFile(outPath, bytes);
console.log(
  "wrote",
  path.relative(process.cwd(), outPath),
  bytes.length,
  "bytes",
);
