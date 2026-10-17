"""M3B.3 PDF to Text synthetic fixtures. Not a product/CI dependency.

Uses the already-available reportlab/pypdf/Pillow utilities. The content is
intentionally minimal and deterministic. The script writes three new fixtures
beside the existing a/b/c/d/preview-features/font-* PDFs and records their
hashes in text-manifest.json. For Unicode/non-Latin text extraction the
existing preview-features.pdf (with its embedded OFL Noto Sans subset) is
re-used; a fresh unicode fixture is not authored here to avoid duplicating
the font provenance already recorded in preview-manifest.json.

Run manually with the pinned authoring environment used elsewhere in
tests/fixtures/*.py. The script is deterministic: identical inputs produce
identical bytes.
"""

from __future__ import annotations

from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path

from PIL import Image
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parent / "pdf"
ROOT.mkdir(exist_ok=True)


def _author(name: str, draw) -> bytes:
    stream = BytesIO()
    c = canvas.Canvas(stream, pagesize=(500, 650), invariant=1, pageCompression=0)
    draw(c)
    c.save()
    data = stream.getvalue()
    (ROOT / name).write_bytes(data)
    return data


def _text_xss(c) -> None:
    """A single page carrying literal script-looking payloads as plain text."""
    c.setFont("Helvetica-Bold", 22)
    c.drawString(60, 580, "XSS canary fixture")
    c.setFont("Helvetica", 14)
    c.drawString(60, 540, "<script>alert(1)</script>")
    c.drawString(60, 510, '<img src="x" onerror="document.title=1">')
    c.drawString(60, 480, "javascript:alert('x')")
    c.drawString(60, 450, "ampersand & less < greater > quote \"")
    c.showPage()


def _text_partial(c) -> None:
    """Three pages: text, blank, text. Used to confirm partial-text handling."""
    c.setFont("Helvetica", 14)
    c.drawString(60, 580, "PartialPage1Marker")
    c.drawString(60, 540, "Partial fixture page one.")
    c.showPage()
    # Page 2 is intentionally empty: no text, no graphics.
    c.showPage()
    c.setFont("Helvetica", 14)
    c.drawString(60, 580, "PartialPage3Marker")
    c.drawString(60, 540, "Partial fixture page three.")
    c.showPage()


def _text_scanned(c) -> None:
    """One image-only page. No text is drawn; a small raster covers the page.

    reportlab/pypdf still write a text operator header for every page, but no
    glyphs are placed, so PDF.js's getTextContent() returns no meaningful text
    items. This simulates a scanned/image-only PDF.
    """
    image = Image.new("RGB", (320, 400), color=(240, 230, 210))
    for y in range(0, 400, 20):
        for x in range(0, 320, 20):
            image.putpixel((x, y), (160, 150, 140))
    buffer = BytesIO()
    image.save(buffer, format="JPEG", quality=85)
    from reportlab.lib.utils import ImageReader

    reader = ImageReader(BytesIO(buffer.getvalue()))
    c.drawImage(reader, 60, 140, width=380, height=400)
    c.showPage()


FIXTURES = {
    "text-xss.pdf": _text_xss,
    "text-partial.pdf": _text_partial,
    "text-scanned.pdf": _text_scanned,
}


def main() -> None:
    manifest = {
        "provenance": "Project-authored M3B.3 PDF-to-text synthetic fixtures.",
        "license": "Project-owned test data; no third-party document license.",
        "authoringTools": {
            "reportlab": "4.4.9",
            "pypdf": "6.10.0",
            "Pillow": "11.3.0",
        },
        "pages": {
            "text-xss.pdf": [
                {
                    "sourcePageNumber": 1,
                    "expectedText": [
                        "XSS canary fixture",
                        "<script>alert(1)</script>",
                        '<img src="x" onerror="document.title=1">',
                        "javascript:alert('x')",
                        "ampersand & less < greater > quote \"",
                    ],
                },
            ],
            "text-partial.pdf": [
                {
                    "sourcePageNumber": 1,
                    "expectedText": [
                        "PartialPage1Marker",
                        "Partial fixture page one.",
                    ],
                },
                {
                    "sourcePageNumber": 2,
                    "expectedText": [],
                    "meaningful": False,
                },
                {
                    "sourcePageNumber": 3,
                    "expectedText": [
                        "PartialPage3Marker",
                        "Partial fixture page three.",
                    ],
                },
            ],
            "text-scanned.pdf": [
                {
                    "sourcePageNumber": 1,
                    "expectedText": [],
                    "meaningful": False,
                    "note": "Image-only page; no text layer.",
                },
            ],
        },
        "sha256": {},
    }
    for name, drawer in FIXTURES.items():
        data = _author(name, drawer)
        manifest["sha256"][name] = sha256(data).hexdigest()
    (ROOT / "text-manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps({name: manifest["sha256"][name] for name in FIXTURES}, indent=2))


if __name__ == "__main__":
    main()
