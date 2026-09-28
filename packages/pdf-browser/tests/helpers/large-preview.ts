import { PDFDocument } from "pdf-lib";
export async function largePreview(count: number): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let index = 0; index < count; index++) {
    const page = document.addPage([500, 650]);
    page.drawRectangle({ x: 50, y: 60, width: 100, height: 80 });
  }
  return document.save();
}
