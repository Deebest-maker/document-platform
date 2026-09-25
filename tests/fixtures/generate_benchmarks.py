"""Optional synthetic benchmark corpus; writes ignored .tools data only."""
from io import BytesIO
from pathlib import Path
import json
import random

from PIL import Image
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

root = Path(__file__).resolve().parents[2] / ".tools" / "merge-benchmarks"
root.mkdir(parents=True, exist_ok=True)
cases = []
random_source = random.Random(24)
for label, file_count, pages_per_file, image_heavy in [
    ("text-10", 2, 5, False), ("text-50", 5, 10, False),
    ("text-100", 2, 50, False), ("text-240", 12, 20, False),
    ("many-files-40", 40, 1, False), ("images-10", 2, 5, True),
    ("images-50", 5, 10, True),
]:
    paths = []
    for source_index in range(file_count):
        path = root / f"{label}-{source_index}.pdf"
        pdf = canvas.Canvas(str(path), invariant=1)
        for page_index in range(pages_per_file):
            pdf.setFont("Helvetica", 12)
            pdf.drawString(35, 800, f"Synthetic benchmark {source_index + 1} / {page_index + 1}")
            if image_heavy:
                image = Image.frombytes("RGB", (1000, 1400), random_source.randbytes(1000 * 1400 * 3))
                encoded = BytesIO()
                image.save(encoded, format="JPEG", quality=75)
                encoded.seek(0)
                pdf.drawImage(ImageReader(encoded), 35, 80, width=500, height=700)
            else:
                for line in range(45):
                    pdf.drawString(35, 760 - line * 14, f"Controlled synthetic line {line + 1}; no user information.")
            pdf.showPage()
        pdf.save()
        paths.append(path.name)
    cases.append({"label": label, "pages": file_count * pages_per_file, "files": paths, "inputBytes": sum((root / p).stat().st_size for p in paths)})
(root / "cases.json").write_text(json.dumps(cases, indent=2) + "\n", encoding="utf-8")
print("Generated seven bounded synthetic benchmark cases.")
