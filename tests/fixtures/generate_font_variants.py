"""Synthetic standard-font style/spacing controls; optional ReportLab authoring."""
from pathlib import Path
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas
import hashlib
import json

root = Path(__file__).parent / "pdf"
target = root / "font-variants.pdf"
c = canvas.Canvas(str(target), pagesize=(500, 650), invariant=1, pageCompression=0)
fonts = ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"]
pages = []
sample = "AVATAR office 0123456789 WMWM iii."
for index, name in enumerate(fonts, start=1):
    c.setFont("Helvetica", 14)
    c.drawString(40, 610, f"V{index}: {name}")
    c.setFont("Helvetica", 10)
    c.drawString(40, 585, "Synthetic font compatibility fixture")
    width = stringWidth(sample, name, 20)
    c.setStrokeColorRGB(1, 0, 0)
    c.line(40, 450, 40, 545)
    c.line(40 + width, 450, 40 + width, 545)
    c.setFillColorRGB(0, 0, 0)
    c.setFont(name, 20)
    c.drawString(40, 520, sample)
    c.drawString(40, 485, "Fixed second line - no overlap expected")
    c.saveState()
    t = c.beginText(40, 260)
    t.setFont(name, 54)
    t.setTextRenderMode(7)
    t.textOut("CLIPPED")
    c.drawText(t)
    c.setFillColorRGB(0, 0, 1)
    c.rect(35, 245, 410, 90, fill=1, stroke=0)
    c.restoreState()
    c.showPage()
    pages.append({"sourcePageNumber": index, "font": name, "embedded": False,
                  "width": 500, "height": 650, "rotation": 0,
                  "sampleWidth": width, "sampleFontSize": 20,
                  "expected": "Two separate black lines; first line between red metric guides; blue CLIPPED below."})
c.save()
(root / "font-variants-manifest.json").write_text(json.dumps({
    "provenance": "Project-authored standard PDF font fixture. No font program is embedded.",
    "pages": pages, "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
}, indent=2) + "\n", encoding="utf-8")
