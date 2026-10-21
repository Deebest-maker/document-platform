import { describe, expect, it } from "vitest";
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRef,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
} from "pdf-lib";
import { collectImageUses } from "../src/compress-layout";
import {
  addImage,
  pdfWithImages,
  type ImageSpec,
} from "./helpers/compress-fixtures";

const image = (over: Partial<ImageSpec> = {}): ImageSpec => ({
  width: 100,
  height: 50,
  kind: "jpeg",
  drawWidth: 300,
  drawHeight: 150,
  ...over,
});

const options = { maxScanBytes: 10_000_000, checkCancelled: () => {} };
const only = (result: ReturnType<typeof collectImageUses>) =>
  [...result.uses.values()][0];

async function loaded(bytes: Uint8Array) {
  return PDFDocument.load(bytes, { updateMetadata: false });
}

describe("image placement", () => {
  it("measures the drawn size in points", async () => {
    const { bytes } = await pdfWithImages([image()]);
    const result = collectImageUses(await loaded(bytes), options);
    expect(result.complete).toBe(true);
    expect(result.shared.size).toBe(0);
    expect(result.uses.size).toBe(1);
    expect(only(result)).toMatchObject({ width: 300, height: 150 });
  });

  it("measures rotated placements by the length of the matrix axes", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const ref = addImage(doc, page, image({ drawWidth: 10, drawHeight: 10 }));
    const tag = page.node.normalizedEntries().XObject.keys()[0];
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(0, 200, -300, 0, 400, 100),
      drawObject(tag as PDFName),
      popGraphicsState(),
    );
    const result = collectImageUses(await loaded(await doc.save()), options);
    // Rotated 90 degrees: width follows the first axis (200), height the second (300).
    expect(only(result)).toMatchObject({ width: 200, height: 300 });
    expect(ref.objectNumber).toBe(only(result).ref.objectNumber);
  });

  it("keeps the largest size when an image is drawn twice", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    addImage(doc, page, image({ drawWidth: 100, drawHeight: 50 }));
    const tag = page.node.normalizedEntries().XObject.keys()[0] as PDFName;
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(600, 0, 0, 300, 0, 0),
      drawObject(tag),
      popGraphicsState(),
    );
    const result = collectImageUses(await loaded(await doc.save()), options);
    expect(only(result)).toMatchObject({ width: 600, height: 300 });
  });

  it("follows form XObjects, composing their matrices", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const scratch = doc.addPage();
    const imageRef = addImage(doc, scratch, image());
    doc.removePage(1);
    const form = doc.context.stream("q 100 0 0 50 0 0 cm /Im1 Do Q", {
      Type: "XObject",
      Subtype: "Form",
      BBox: [0, 0, 200, 200],
      Matrix: [2, 0, 0, 2, 0, 0],
      Resources: { XObject: { Im1: imageRef } },
    } as never);
    const formRef = doc.context.register(form);
    const tag = page.node.newXObject("Fm", formRef);
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(0.5, 0, 0, 0.5, 10, 10),
      drawObject(tag),
      popGraphicsState(),
    );
    const result = collectImageUses(await loaded(await doc.save()), options);
    expect(result.complete).toBe(true);
    expect(only(result)).toMatchObject({ width: 100, height: 50 });
    expect(result.shared.size).toBe(0);
  });

  it("uses resources inherited from the page tree", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    addImage(doc, page, image());
    const resources = page.node.get(PDFName.of("Resources"));
    page.node.delete(PDFName.of("Resources"));
    doc.catalog
      .lookup(PDFName.of("Pages"), (await import("pdf-lib")).PDFDict)
      .set(PDFName.of("Resources"), resources!);
    const result = collectImageUses(await loaded(await doc.save()), options);
    expect(result.complete).toBe(true);
    expect(result.uses.size).toBe(1);
  });
});

describe("untrustworthy layouts", () => {
  it("flags an image that is also referenced outside the scanned pages", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const imageRef = addImage(doc, page, image());
    // An annotation appearance stream draws the same image: its size is not
    // measured, so the image must not be resized on the page's evidence alone.
    const appearance = doc.context.stream("q 400 0 0 200 0 0 cm /Im1 Do Q", {
      Type: "XObject",
      Subtype: "Form",
      BBox: [0, 0, 400, 200],
      Resources: { XObject: { Im1: imageRef } },
    } as never);
    const annotation = doc.context.obj({
      Type: "Annot",
      Subtype: "Stamp",
      Rect: [0, 0, 400, 200],
      AP: { N: doc.context.register(appearance) },
    });
    page.node.set(
      PDFName.of("Annots"),
      doc.context.obj([doc.context.register(annotation)]),
    );
    const result = collectImageUses(await loaded(await doc.save()), options);
    expect(result.complete).toBe(true);
    expect([...result.shared]).toEqual([imageRef.objectNumber]);
  });

  it("flags images that are also used as a mask", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const first = addImage(doc, page, image());
    addImage(
      doc,
      page,
      image({ configure: (dict) => dict.set(PDFName.of("SMask"), first) }),
    );
    const result = collectImageUses(await loaded(await doc.save()), options);
    expect(result.shared.has(first.objectNumber)).toBe(true);
  });

  it("is incomplete when a page uses UserUnit", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    addImage(doc, page, image());
    page.node.set(PDFName.of("UserUnit"), PDFNumber.of(2));
    expect(
      collectImageUses(await loaded(await doc.save()), options).complete,
    ).toBe(false);
    page.node.set(PDFName.of("UserUnit"), PDFNumber.of(1));
    expect(
      collectImageUses(await loaded(await doc.save()), options).complete,
    ).toBe(true);
  });

  it("is incomplete when page content cannot be decoded safely", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    addImage(doc, page, image());
    const hex = doc.context.stream("71 20 51 20 3e", {
      Filter: "ASCIIHexDecode",
    } as never);
    page.node.set(
      PDFName.of("Contents"),
      doc.context.obj([doc.context.register(hex)]),
    );
    expect(
      collectImageUses(await loaded(await doc.save()), options).complete,
    ).toBe(false);
  });

  it("is incomplete when the scan budget runs out", async () => {
    const { bytes } = await pdfWithImages([image()]);
    const result = collectImageUses(await loaded(bytes), {
      ...options,
      maxScanBytes: 4,
    });
    expect(result.complete).toBe(false);
  });

  it("is incomplete for a form that draws itself", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const form = doc.context.stream("/Fm Do", {
      Type: "XObject",
      Subtype: "Form",
      BBox: [0, 0, 10, 10],
    } as never);
    const formRef = doc.context.register(form);
    form.dict.set(
      PDFName.of("Resources"),
      doc.context.obj({ XObject: { Fm: formRef } }),
    );
    const tag = page.node.newXObject("Fm", formRef);
    page.pushOperators(drawObject(tag));
    expect(
      collectImageUses(await loaded(await doc.save()), options).complete,
    ).toBe(false);
  });

  it("is incomplete when forms nest too deeply", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    let inner: PDFRef | undefined;
    for (let level = 0; level < 12; level++) {
      const form = doc.context.stream(inner ? "/Next Do" : "", {
        Type: "XObject",
        Subtype: "Form",
        BBox: [0, 0, 10, 10],
        Resources: inner ? { XObject: { Next: inner } } : {},
      } as never);
      inner = doc.context.register(form);
    }
    page.pushOperators(drawObject(page.node.newXObject("Fm", inner!)));
    expect(
      collectImageUses(await loaded(await doc.save()), options).complete,
    ).toBe(false);
  });

  it("stops when cancellation is requested", async () => {
    const { bytes } = await pdfWithImages([image(), image()], {
      onePagePerImage: true,
    });
    const doc = await loaded(bytes);
    expect(() =>
      collectImageUses(doc, {
        ...options,
        checkCancelled: () => {
          throw new Error("cancelled");
        },
      }),
    ).toThrow("cancelled");
  });

  it("ignores references that are not images", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const array = doc.context.obj([]) as PDFArray;
    page.node.set(PDFName.of("Annots"), array);
    expect(
      collectImageUses(await loaded(await doc.save()), options).uses.size,
    ).toBe(0);
  });
});
