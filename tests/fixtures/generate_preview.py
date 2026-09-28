"""Optional synthetic authoring using existing ReportLab/pypdf utilities.

Pass the OFL NotoSans-Regular.ttf identified in pdf/preview-manifest.json.
Only a small font subset is embedded. This does not replace PDF.js fonts.
"""
from io import BytesIO
from pathlib import Path
import hashlib
import json
import sys

from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, RectangleObject
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

font = Path(sys.argv[1])
assert hashlib.sha256(font.read_bytes()).hexdigest() == "b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5"
pdfmetrics.registerFont(TTFont("EmbeddedNoto", str(font)))
root = Path(__file__).parent / "pdf"
writer = PdfWriter()
pages = []
for index in range(1, 5):
    stream = BytesIO()
    c = canvas.Canvas(stream, pagesize=(500, 650), invariant=1, pageCompression=0)
    c.setFont("Helvetica-Bold", 28)
    c.drawString(65, 560, f"P{index}")
    c.setFont("Helvetica", 11)
    c.drawString(65, 535, "Synthetic preview fixture - no personal information")
    # Distinct corner samples and asymmetric layout make rotation observable.
    c.setFillColorRGB(1, 0, 0)
    c.rect(60, 70, 30, 30, fill=1, stroke=0)
    c.setFillColorRGB(0, 0, 1)
    c.rect(410, 550, 30, 30, fill=1, stroke=0)
    c.setFillColorRGB(0, 0, 0)
    if index == 1:
        c.setFont("EmbeddedNoto", 20)
        for y, line in zip([470, 420, 370], ["Embedded font: Hello 012345", "Ελληνικά: Δοκιμή κειμένου", "Кириллица: Пример текста"]):
            c.drawString(65, y, line)
    elif index == 2:
        for y, name in zip([470, 420, 370], ["Helvetica", "Times-Roman", "Courier"]):
            c.setFont(name, 18)
            c.drawString(65, y, name + ": Standard PDF 012345")
        c.setFont("Symbol", 22)
        c.drawString(65, 320, "ΑΒΓΔ αβγδ")
    elif index == 3:
        c.setFont("Helvetica", 20)
        c.drawString(65, 460, "Non-embedded Arial: Preview 012345")
        c.drawString(65, 420, "Normal system font fallback")
    else:
        c.setFont("Helvetica", 18)
        c.drawString(65, 460, "Crop origin 40,50 - rotated 90")
        c.linkURL("https://example.invalid/preview-fixture", (65, 410, 300, 440), relative=0)
        c.drawString(65, 415, "Link stays inert in thumbnail")
    c.showPage()
    c.save()
    page = PdfReader(BytesIO(stream.getvalue())).pages[0]
    if index == 3:
        for value in page["/Resources"]["/Font"].values():
            obj = value.get_object()
            if obj.get("/BaseFont") == "/Helvetica":
                obj[NameObject("/BaseFont")] = NameObject("/ArialMT")
    if index == 4:
        page.cropbox = RectangleObject([40, 50, 460, 610])
        page.rotate(90)
    writer.add_page(page)
    pages.append({"marker": f"P{index}", "sourcePageNumber": index, "width": 500, "height": 650, "crop": [40, 50, 460, 610] if index == 4 else [0, 0, 500, 650], "rotation": 90 if index == 4 else 0})
output = root / "preview-features.pdf"
with output.open("wb") as destination:
    writer.write(destination)
manifest = {
    "provenance": "Project-authored synthetic preview and structural-operation fixture.",
    "font": {"name": "Noto Sans Regular", "license": "OFL-1.1", "source": "https://github.com/notofonts/noto-fonts/blob/ffebf8c1ee449e544955a7e813c54f9b73848eac/hinted/ttf/NotoSans/NotoSans-Regular.ttf", "sha256": hashlib.sha256(font.read_bytes()).hexdigest(), "notice": "../licenses/OFL-NotoSans.txt", "usage": "Embedded subset in page P1 only; not a PDF.js replacement font."},
    "pages": pages,
    "expectedOrders": {"reorder": ["P4", "P2", "P1", "P3"], "extractAfterReorder": ["P4", "P1"], "deleteAfterReorder": ["P2", "P3"]},
    "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
}
(root / "preview-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
print(f"Created four-page synthetic preview fixture ({output.stat().st_size} bytes).")
