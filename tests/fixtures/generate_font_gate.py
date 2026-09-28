"""Author a small synthetic font-clipping comparison; optional ReportLab only.

Pass the pinned OFL Noto Sans font used by generate_preview.py. The embedded
subset is a control, not a replacement for PDF.js's bundled standard fonts.
"""
from pathlib import Path
import hashlib
import json
import sys

from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

font = Path(sys.argv[1])
assert hashlib.sha256(font.read_bytes()).hexdigest() == "b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5"
pdfmetrics.registerFont(TTFont("EmbeddedNoto", str(font)))
root = Path(__file__).parent / "pdf"
target = root / "font-clipping.pdf"
c = canvas.Canvas(str(target), pagesize=(500, 650), invariant=1, pageCompression=0)
fonts = ["Helvetica-Bold", "Times-Roman", "EmbeddedNoto"]
for index, name in enumerate(fonts, start=1):
    c.setFont("Helvetica", 14)
    c.drawString(40, 610, f"F{index}: {name}")
    c.setFont("Helvetica", 10)
    c.drawString(40, 585, "Synthetic PDF font gate - no personal information")
    c.drawString(40, 535, "Filled text control:")
    c.setFont(name, 54)
    c.drawString(40, 470, "CLIPPED")
    c.setFont("Helvetica", 10)
    c.drawString(40, 355, "Expected below: CLIPPED in blue, with a white background.")
    c.saveState()
    text = c.beginText(40, 260)
    text.setFont(name, 54)
    text.setTextRenderMode(7)  # PDF text as clipping path; no text fill/stroke.
    text.textOut("CLIPPED")
    c.drawText(text)
    c.setFillColorRGB(0, 0, 1)
    c.rect(35, 245, 410, 90, fill=1, stroke=0)
    c.restoreState()
    c.showPage()
c.save()
manifest = {
    "provenance": "Project-authored synthetic PDF text-rendering-mode 7 comparison.",
    "fontNotice": "../licenses/OFL-NotoSans.txt",
    "embeddedFontSource": "preview-manifest.json#/font",
    "pages": [
        {"sourcePageNumber": i, "font": name, "embedded": name == "EmbeddedNoto",
         "width": 500, "height": 650, "rotation": 0,
         "expected": "Filled black CLIPPED above; clipped blue CLIPPED below."}
        for i, name in enumerate(fonts, start=1)
    ],
    "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
}
(root / "font-clipping-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
print(f"Created three-page synthetic clipping fixture ({target.stat().st_size} bytes).")
