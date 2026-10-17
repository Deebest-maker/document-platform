import { describe, expect, it } from "vitest";
import { degrees, PDFDocument, PDFName, PDFString } from "pdf-lib";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PageError } from "../src/page-errors";
import {
  removePdfMetadata,
  scanTrailerIdStructural,
  STANDARD_INFO_KEYS,
} from "../src/metadata-removal";
import type { MetadataRemovalLimits } from "../src/metadata-removal";
import { scanWholeBody } from "./helpers/metadata-whole-body-scan";

const LIMITS: MetadataRemovalLimits = Object.freeze({
  maxInputBytes: 10 * 1024 * 1024,
  maxPages: 200,
  maxOutputBytes: 32 * 1024 * 1024,
});

async function metadataRichPdf(
  options: {
    pages?: number;
    withXmp?: boolean;
    customInfo?: Record<string, string>;
    trailerId?: boolean;
  } = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const pageCount = options.pages ?? 2;
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`page ${i + 1}`, { x: 50, y: 700 });
    if (i === 1) page.setRotation(degrees(90));
  }
  doc.setTitle("SECRET-TITLE-CANARY");
  doc.setAuthor("SECRET-AUTHOR-CANARY");
  doc.setSubject("subject-canary");
  doc.setKeywords(["kw-canary-1", "kw-canary-2"]);
  doc.setCreator("creator-canary");
  doc.setProducer("producer-canary");
  doc.setCreationDate(new Date("2024-01-01T00:00:00Z"));
  doc.setModificationDate(new Date("2024-06-01T00:00:00Z"));
  const infoRef = doc.context.trailerInfo.Info;
  if (!infoRef) throw new Error("fixture Info dictionary missing");
  const dict = doc.context.lookup(infoRef) as unknown as {
    set(k: unknown, v: unknown): void;
  };
  // pdf-lib has no /Trapped setter; write it through the Info dictionary.
  dict.set(PDFName.of("Trapped"), PDFName.of("False"));
  for (const [key, value] of Object.entries(options.customInfo ?? {}))
    dict.set(PDFName.of(key), PDFString.of(value));
  if (options.withXmp !== false) {
    const xmp = `<?xml version="1.0"?><x:xmpmeta xmlns:x="adobe:ns:meta/">XMP-CANARY</x:xmpmeta>`;
    const stream = doc.context.flateStream(xmp, {
      Type: PDFName.of("Metadata"),
      Subtype: PDFName.of("XML"),
    } as never);
    const streamRef = doc.context.register(stream);
    doc.catalog.set(PDFName.of("Metadata"), streamRef);
  }
  if (options.trailerId === false)
    delete (doc.context.trailerInfo as Record<string, unknown>).ID;
  return doc.save({ useObjectStreams: false });
}

async function hasAnyMetadata(bytes: Uint8Array) {
  // updateMetadata:false � pdf-lib's default load would itself inject
  // Producer/Creator/CreationDate/ModDate and mask the real output state.
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const infoRef = doc.context.trailerInfo.Info;
  const dict = infoRef
    ? (doc.context.lookup(infoRef) as unknown as {
        keys(): readonly unknown[];
      })
    : undefined;
  const infoKeyCount = dict ? [...dict.keys()].length : 0;
  const xmpPresent = doc.catalog.has(PDFName.of("Metadata"));
  return { infoKeyCount, xmpPresent };
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function contentStreamHashes(bytes: Uint8Array): Promise<string[]> {
  // Decode each page's /Contents stream BYTES and SHA-256 them. Multi-part
  // content arrays are concatenated in order. The result is a per-page hash.
  // This never calls pdf-lib's save() — we only READ the input.
  const doc = await PDFDocument.load(bytes);
  const hashes: string[] = [];
  for (const page of doc.getPages()) {
    const node = (page as unknown as { node: Record<string, unknown> }).node;
    const contentsFn = node["Contents"];
    const raw =
      typeof contentsFn === "function"
        ? (contentsFn as () => unknown).call(node)
        : (node["lookupMaybe"] as (...args: unknown[]) => unknown)?.call(
            node,
            PDFName.of("Contents"),
          );
    const streams: Uint8Array[] = [];
    const push = (candidate: unknown): void => {
      if (!candidate) return;
      const asRecord = candidate as Record<string, unknown>;
      const contents = asRecord["contents"];
      if (contents instanceof Uint8Array) streams.push(contents);
      const array = asRecord["array"];
      if (Array.isArray(array)) for (const item of array) push(item);
    };
    push(raw);
    const combined = new Uint8Array(streams.reduce((n, s) => n + s.length, 0));
    let offset = 0;
    for (const s of streams) {
      combined.set(s, offset);
      offset += s.length;
    }
    hashes.push(sha256Hex(combined));
  }
  return hashes;
}

describe("removePdfMetadata", () => {
  it("removes every standard Info field and reports which ones were present", async () => {
    const source = await metadataRichPdf({ pages: 3 });
    const result = await removePdfMetadata(
      { id: "s1", blob: new Blob([new Uint8Array(source).buffer]) },
      LIMITS,
    );
    expect(result.pageCount).toBe(3);
    // Every standard key should be marked present in `before`.
    for (const key of STANDARD_INFO_KEYS)
      expect(result.before.standardInfoPresent[key]).toBe(true);
    // And absent in `after`.
    for (const key of STANDARD_INFO_KEYS)
      expect(result.after.standardInfoPresent[key]).toBe(false);
    expect(result.removed.standardInfo).toEqual(
      expect.arrayContaining([...STANDARD_INFO_KEYS]),
    );
    const inspection = await hasAnyMetadata(
      new Uint8Array(await result.blob.arrayBuffer()),
    );
    expect(inspection.infoKeyCount).toBe(0);
  });

  it("removes custom Info-dictionary entries", async () => {
    const source = await metadataRichPdf({
      customInfo: {
        AcmeInternalCanary: "secret",
        AcmeOtherCanary: "another",
      },
    });
    const result = await removePdfMetadata(
      { id: "s2", blob: new Blob([new Uint8Array(source).buffer]) },
      LIMITS,
    );
    expect(result.before.customInfoKeys).toEqual(
      expect.arrayContaining(["AcmeInternalCanary", "AcmeOtherCanary"]),
    );
    expect(result.after.customInfoKeys).toEqual([]);
    expect(result.removed.customInfo).toEqual(
      expect.arrayContaining(["AcmeInternalCanary", "AcmeOtherCanary"]),
    );
  });

  it("removes the Catalog /Metadata XMP stream", async () => {
    const source = await metadataRichPdf();
    const result = await removePdfMetadata(
      { id: "s3", blob: new Blob([new Uint8Array(source).buffer]) },
      LIMITS,
    );
    expect(result.before.xmpStreamPresent).toBe(true);
    expect(result.after.xmpStreamPresent).toBe(false);
    expect(result.removed.xmpStream).toBe(true);
    const inspection = await hasAnyMetadata(
      new Uint8Array(await result.blob.arrayBuffer()),
    );
    expect(inspection.xmpPresent).toBe(false);
  });

  it("reports the trailer /ID spike outcome without inventing success", async () => {
    const source = await metadataRichPdf();
    const result = await removePdfMetadata(
      { id: "s4", blob: new Blob([new Uint8Array(source).buffer]) },
      LIMITS,
    );
    // The product only claims removal when the save round-trip confirmed it.
    expect(result.removed.trailerId).toBe(
      result.trailerIdControllable && result.before.trailerIdPresent,
    );
    // When uncontrollable, trailerId after is still truthfully reported.
    if (!result.trailerIdControllable)
      expect(result.after.trailerIdPresent).toBe(true);
  });

  it("preserves page count, media boxes and rotation", async () => {
    const source = await metadataRichPdf({ pages: 3 });
    const result = await removePdfMetadata(
      { id: "s5", blob: new Blob([new Uint8Array(source).buffer]) },
      LIMITS,
    );
    expect(result.pagesPreserved).toBe(true);
    expect(result.pageCount).toBe(3);
    for (const entry of result.pageGeometry) {
      expect(entry.geometryUnchanged).toBe(true);
      expect(entry.rotationUnchanged).toBe(true);
    }
    // Page 2 of the fixture is rotated 90°; preserve that.
    expect(result.pageGeometry[1].afterRotation).toBe(90);
  });

  it("rejects a non-PDF payload with INVALID_PDF", async () => {
    const bytes = new TextEncoder().encode("not a pdf");
    await expect(
      removePdfMetadata(
        { id: "sx", blob: new Blob([new Uint8Array(bytes).buffer]) },
        LIMITS,
      ),
    ).rejects.toMatchObject({ code: "INVALID_PDF" });
  });

  it("rejects an oversized input before loading", async () => {
    const source = await metadataRichPdf();
    await expect(
      removePdfMetadata(
        { id: "sy", blob: new Blob([new Uint8Array(source).buffer]) },
        { ...LIMITS, maxInputBytes: 10 },
      ),
    ).rejects.toBeInstanceOf(PageError);
  });

  it("stops immediately when the signal is already aborted", async () => {
    const source = await metadataRichPdf();
    const controller = new AbortController();
    controller.abort();
    await expect(
      removePdfMetadata(
        { id: "sz", blob: new Blob([new Uint8Array(source).buffer]) },
        LIMITS,
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("reports phase events in deterministic order", async () => {
    const source = await metadataRichPdf();
    const phases: string[] = [];
    await removePdfMetadata(
      { id: "sp", blob: new Blob([new Uint8Array(source).buffer]) },
      LIMITS,
      { onPhase: (phase) => phases.push(phase) },
    );
    expect(phases).toEqual(["reading", "removing", "validating", "verifying"]);
  });

  it("produces a valid PDF Blob of application/pdf type", async () => {
    const source = await metadataRichPdf();
    const result = await removePdfMetadata(
      { id: "sm", blob: new Blob([new Uint8Array(source).buffer]) },
      LIMITS,
    );
    expect(result.blob.type).toBe("application/pdf");
    expect(result.bytes).toBeGreaterThan(32);
    const header = new TextDecoder().decode(
      new Uint8Array((await result.blob.arrayBuffer()).slice(0, 4)),
    );
    expect(header).toBe("%PDF");
  });

  it("DEFENCE-IN-DEPTH: test-only whole-body scan reports no surviving metadata-shaped tokens", async () => {
    // The whole-body scan is a bug detector that lives in test/benchmark
    // code only — it is NOT part of the production engine (a global regex
    // can false-positive on legitimately-placed byte sequences). The test
    // runs it on the engine's output to flag suspicious bytes for human
    // review; for a clean synthetic fixture it should come back ok=true.
    const source = await metadataRichPdf({
      customInfo: { AcmeInternalCanary: "ACME-SECRET-VALUE" },
    });
    const result = await removePdfMetadata(
      { id: "iv1", blob: new Blob([new Uint8Array(source).buffer]) },
      LIMITS,
    );
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    const scan = scanWholeBody({
      bytes,
      customInfoKeys: ["AcmeInternalCanary"],
      removalCanaries: ["SECRET-TITLE-CANARY", "ACME-SECRET-VALUE"],
    });
    expect(scan.hasPdfHeader).toBe(true);
    for (const key of STANDARD_INFO_KEYS)
      expect(scan.standardInfoNamesPresent[key]).toBe(false);
    expect(scan.customInfoNamesPresent["AcmeInternalCanary"]).toBe(false);
    expect(scan.xmpStreamHeaderPresent).toBe(false);
    expect(scan.removalCanariesFound).toEqual([]);
    expect(scan.ok).toBe(true);
  });

  it("STRUCTURAL: trailer /ID scanner only looks inside the trailer dictionary", () => {
    // The structurally scoped scanner must ignore /ID bytes that appear
    // outside the trailer block. This hand-crafted sample puts a false
    // /ID inside an object body before the trailer; the trailer itself
    // has no /ID.
    const sample = new TextEncoder().encode(
      "%PDF-1.3\n" +
        "1 0 obj\n<< /Type /SomeNameTree /ID [<deadbeef><cafebabe>] >>\nendobj\n" +
        "trailer\n<<\n/Size 2\n/Root 1 0 R\n>>\nstartxref\n0\n%%EOF\n",
    );
    const scan = scanTrailerIdStructural(sample);
    expect(scan.trailerBlockFound).toBe(true);
    expect(scan.idInTrailer).toBe(false);
  });

  it("STRUCTURAL: trailer /ID scanner detects /ID inside the trailer dictionary", () => {
    const sample = new TextEncoder().encode(
      "%PDF-1.3\n" +
        "trailer\n<<\n/Size 2\n/Root 1 0 R\n/ID [<aa><bb>]\n>>\nstartxref\n0\n%%EOF\n",
    );
    const scan = scanTrailerIdStructural(sample);
    expect(scan.trailerBlockFound).toBe(true);
    expect(scan.idInTrailer).toBe(true);
  });

  it("STRUCTURAL: engine down-corrects trailerIdControllable using the trailer-scoped scan", async () => {
    const source = await metadataRichPdf();
    const result = await removePdfMetadata(
      { id: "tr1", blob: new Blob([new Uint8Array(source).buffer]) },
      LIMITS,
    );
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    const trailerScan = scanTrailerIdStructural(bytes);
    // trailerIdControllable in the result is TRUE only when both pdf-lib
    // reopen said no /ID and the structural trailer scan agrees.
    expect(result.trailerIdControllable).toBe(!trailerScan.idInTrailer);
  });

  it("CONTENT PRESERVATION: per-page content-stream SHA-256 is unchanged by the metadata operation", async () => {
    // Content streams are usually flate-compressed and so a Latin-1 search
    // for `page 1` would miss them. Instead, read each page's /Contents
    // stream BYTES before and after the save round-trip, hash them, and
    // assert the hashes match. The hashes are computed in test code — the
    // engine itself does not depend on pdf-lib internals for this.
    const source = await metadataRichPdf({ pages: 3 });
    const beforeHashes = await contentStreamHashes(source);
    const result = await removePdfMetadata(
      { id: "cp1", blob: new Blob([new Uint8Array(source).buffer]) },
      LIMITS,
    );
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    const afterHashes = await contentStreamHashes(bytes);
    expect(afterHashes).toEqual(beforeHashes);
    expect(afterHashes.length).toBe(3);
  });

  it("WHOLE-BODY (test helper): a surviving XMP header is detected", () => {
    // Direct unit test on the test-only helper. The engine does NOT run
    // this check; it is a bug detector for test review only.
    const corrupt = new TextEncoder().encode(
      "%PDF-1.3\n1 0 obj\n<<\n/Metadata 2 0 R\n>>\nendobj\n2 0 obj\n<x:xmpmeta>",
    );
    const scan = scanWholeBody({ bytes: corrupt });
    expect(scan.hasPdfHeader).toBe(true);
    expect(scan.xmpStreamHeaderPresent).toBe(true);
    expect(scan.ok).toBe(false);
  });

  it("WHOLE-BODY (test helper): a Latin-1 encoded /Title token is detected (no decoder loss)", () => {
    // The scanner must not UTF-8 decode and lose high bytes.
    const bytes = new Uint8Array([
      0x25,
      0x50,
      0x44,
      0x46,
      0x2d,
      0x0a, // %PDF-\n
      0x2f,
      0x54,
      0x69,
      0x74,
      0x6c,
      0x65,
      0x20,
      0x28,
      0xe9,
      0x29, // /Title (é)
    ]);
    const scan = scanWholeBody({ bytes });
    expect(scan.standardInfoNamesPresent.Title).toBe(true);
    expect(scan.ok).toBe(false);
  });

  it("refuses the encrypted fixture with ENCRYPTED_PDF", async () => {
    const bytes = await readFile(
      new URL("../../../tests/fixtures/pdf/encrypted.pdf", import.meta.url),
    );
    await expect(
      removePdfMetadata(
        { id: "enc", blob: new Blob([new Uint8Array(bytes).buffer]) },
        LIMITS,
      ),
    ).rejects.toMatchObject({ code: "ENCRYPTED_PDF" });
  });
});
