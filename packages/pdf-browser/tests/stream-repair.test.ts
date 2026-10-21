import { describe, expect, it } from "vitest";
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
} from "pdf-lib";
import { zlibSync } from "fflate";
import {
  repairFlateTrailer,
  repairTruncatedFlateTrailers,
  type StreamRepairLib,
} from "../src/stream-repair";
import { mergePdfs } from "../src/merge";
import { removePdfMetadata } from "../src/metadata-removal";
import { createPagePlan } from "../src/page-model";
import { transformPages } from "../src/page-operations";
import { pageLimits } from "../src/page-types";

// pdf-lib 1.17.1 trims a trailing LF/CR/CRLF *data* byte from a stream whose
// /Length is indirect and which runs straight into "endstream". For a Flate
// stream those bytes are the end of the Adler-32 checksum (ADR-026).

const lib: StreamRepairLib = {
  PDFArray,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
};
const encoder = new TextEncoder();
const CONTENT_REF = PDFRef.of(4, 0);

type Ending = "LF" | "CR" | "CRLF";
// Adler-32 `a` value (sum of bytes + 1) whose big-endian bytes end the stream.
const adlerA: Record<Ending, number> = {
  LF: 0x0b0a, // ... 0B 0A
  CR: 0x0b0d, // ... 0B 0D
  CRLF: 0x0d0a, // ... 0D 0A
};

/** Content whose bytes sum to `total`, so its zlib stream ends as required. */
function contentSummingTo(total: number): Uint8Array {
  const prefix = encoder.encode("q Q % ");
  const base = prefix.reduce((sum, byte) => sum + byte, 0);
  const remaining = total - base;
  const count = Math.ceil(remaining / 126);
  const fill = new Uint8Array(count);
  const each = Math.floor(remaining / count);
  let extra = remaining - each * count;
  for (let index = 0; index < count; index++) {
    fill[index] = each + (extra-- > 0 ? 1 : 0);
  }
  const content = new Uint8Array(prefix.length + count);
  content.set(prefix);
  content.set(fill, prefix.length);
  return content;
}

function streamEnding(ending: Ending) {
  const content = contentSummingTo(adlerA[ending] - 1);
  const packed = zlibSync(content, { level: 6 });
  const tail =
    ending === "CRLF" ? [0x0d, 0x0a] : [ending === "LF" ? 0x0a : 0x0d];
  expect(Array.from(packed.slice(-tail.length))).toEqual(tail);
  return { content, packed };
}

type Options = {
  filter?: string; // dictionary text for /Filter, or none for a raw stream
  indirectLength?: boolean;
  eolBeforeEndstream?: boolean;
};
function craftPdf(data: Uint8Array, options: Options = {}): Uint8Array {
  const { filter = "/Filter /FlateDecode", eolBeforeEndstream = false } =
    options;
  const length =
    options.indirectLength === false ? String(data.length) : "5 0 R";
  const head = encoder.encode(
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
      "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
      "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>\nendobj\n" +
      `4 0 obj\n<< /Length ${length} ${filter} >>\nstream\n`,
  );
  const tail = encoder.encode(
    `${eolBeforeEndstream ? "\n" : ""}endstream\nendobj\n5 0 obj\n${data.length}\nendobj\ntrailer\n<< /Root 1 0 R /Size 6 >>\n%%EOF\n`,
  );
  const file = new Uint8Array(head.length + data.length + tail.length);
  file.set(head);
  file.set(data, head.length);
  file.set(tail, head.length + data.length);
  return file;
}
const stream = (document: PDFDocument) =>
  document.context.lookup(CONTENT_REF) as PDFRawStream;
const blobOf = (bytes: Uint8Array) =>
  new Blob([bytes.slice().buffer], { type: "application/pdf" });
const firstPageContents = async (bytes: Uint8Array) => {
  const document = await PDFDocument.load(bytes);
  return (document.getPage(0).node.Contents() as PDFRawStream).contents;
};

describe("pdf-lib trailing checksum bytes (ADR-026)", () => {
  it.each<Ending>(["LF", "CR", "CRLF"])(
    "restores a stream ending in %s that pdf-lib trimmed",
    async (ending) => {
      const { packed } = streamEnding(ending);
      const document = await PDFDocument.load(craftPdf(packed));
      // Characterisation of the library behaviour this repair works around.
      expect(stream(document).contents.length).toBeLessThan(packed.length);

      expect(repairTruncatedFlateTrailers(document, lib)).toBe(1);
      expect(stream(document).contents).toEqual(packed);

      const reopened = await PDFDocument.load(await document.save());
      expect(stream(reopened).contents).toEqual(packed);
    },
  );

  it("leaves conforming and direct-length files unchanged", async () => {
    const { packed } = streamEnding("LF");
    for (const options of [
      { eolBeforeEndstream: true },
      { indirectLength: false },
    ]) {
      const document = await PDFDocument.load(craftPdf(packed, options));
      expect(stream(document).contents).toEqual(packed);
      expect(repairTruncatedFlateTrailers(document, lib)).toBe(0);
      expect(stream(document).contents).toEqual(packed);
    }
  });

  it("does not touch a stream whose checksum does not match", async () => {
    const { packed } = streamEnding("LF");
    const bad = packed.slice();
    bad[bad.length - 3] ^= 0x55; // damage a surviving checksum byte
    const document = await PDFDocument.load(craftPdf(bad));
    const before = stream(document).contents.slice();
    expect(before.length).toBeLessThan(bad.length);
    expect(repairTruncatedFlateTrailers(document, lib)).toBe(0);
    expect(stream(document).contents).toEqual(before);
  });

  it("does not touch streams that are not Flate", async () => {
    const raw = encoder.encode("q 1 0 0 1 0 0 cm Q\n");
    const document = await PDFDocument.load(craftPdf(raw, { filter: "" }));
    const before = stream(document).contents.slice();
    expect(before.length).toBe(raw.length - 1); // the trimming is real here too
    expect(repairTruncatedFlateTrailers(document, lib)).toBe(0);
    expect(stream(document).contents).toEqual(before);
  });

  it("refuses when the data is not a plain zlib stream or the budget is spent", () => {
    const { packed } = streamEnding("LF");
    const trimmed = packed.slice(0, -1);
    expect(repairFlateTrailer(trimmed, 1, { remaining: 1 << 20 })).toEqual(
      packed,
    );
    expect(repairFlateTrailer(trimmed, 1, { remaining: 0 })).toBeNull();
    const noHeader = trimmed.slice();
    noHeader[0] = 0x00;
    expect(repairFlateTrailer(noHeader, 1, { remaining: 1 << 20 })).toBeNull();
    expect(
      repairFlateTrailer(trimmed.slice(0, 5), 1, { remaining: 1 << 20 }),
    ).toBeNull();
    // Lost bytes that trimming could not have removed.
    const other = zlibSync(encoder.encode("hello hello hello"));
    expect(
      repairFlateTrailer(other.slice(0, -1), 1, { remaining: 1 << 20 }),
    ).toBeNull();
  });
});

describe("tools write the restored stream", () => {
  const { packed } = streamEnding("LF");
  const damaged = craftPdf(packed);

  it("Merge", async () => {
    const result = await mergePdfs(
      [
        { id: "a", blob: blobOf(damaged) },
        { id: "b", blob: blobOf(damaged) },
      ],
      {
        maxFiles: 20,
        maxFileBytes: 16 * 1024 * 1024,
        maxTotalBytes: 32 * 1024 * 1024,
        maxPages: 300,
        maxOutputBytes: 32 * 1024 * 1024,
      },
    );
    const output = await PDFDocument.load(await result.blob.arrayBuffer());
    expect(output.getPageCount()).toBe(2);
    for (const index of [0, 1])
      expect(
        (output.getPage(index).node.Contents() as PDFRawStream).contents,
      ).toEqual(packed);
  });

  it("page tools and Split (shared loader)", async () => {
    const input = { id: "s", blob: blobOf(damaged) };
    const result = await transformPages(
      input,
      createPagePlan(1, input.id),
      pageLimits,
    );
    expect(
      await firstPageContents(new Uint8Array(await result.blob.arrayBuffer())),
    ).toEqual(packed);
  });

  it("Remove metadata", async () => {
    const result = await removePdfMetadata(
      { id: "m", blob: blobOf(damaged) },
      {
        maxInputBytes: 10 * 1024 * 1024,
        maxPages: 200,
        maxOutputBytes: 32 * 1024 * 1024,
      },
    );
    expect(
      await firstPageContents(new Uint8Array(await result.blob.arrayBuffer())),
    ).toEqual(packed);
  });
});
