"""Optional fixture authoring only; not a project/runtime/CI dependency.

Uses preinstalled reportlab 4.4.9, pypdf 6.10.0, cryptography 50.0.1.
All text, page geometry, form data and signing identity are synthetic.
"""

from datetime import datetime, timezone
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import re

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs7
from cryptography.x509.oid import NameOID
from pypdf import PdfReader, PdfWriter
from pypdf.generic import (
    ArrayObject, ByteStringObject, DictionaryObject, NameObject, NumberObject,
    TextStringObject,
)
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parent / "pdf"
ROOT.mkdir(exist_ok=True)

# Expected identities are authored here and in manifest.json independently of Merge.
SOURCES = {
    "a.pdf": [("A1", 400, 600, 0), ("A2", 600, 400, 0)],
    "b.pdf": [("B1", 420, 610, 90), ("B2", 430, 620, 180)],
    "c.pdf": [("C1", 440, 630, 0)],
    "d.pdf": [("D1", 450, 640, 270)],
}


def make_pdf(pages, form=False):
    buffer = BytesIO()
    document = canvas.Canvas(buffer, invariant=1, pageCompression=0)
    for marker, width, height, rotation in pages:
        document.setPageSize((width, height))
        document.setFont("Helvetica-Bold", 32)
        document.drawString(40, height - 70, marker)
        document.setFont("Helvetica", 12)
        document.drawString(40, height - 105, "Synthetic Merge acceptance fixture")
        document.drawString(40, height - 125, "No personal or confidential information")
        document.setStrokeColorRGB(0.2, 0.4, 0.3)
        document.rect(30, 30, width - 60, height - 180)
        if form:
            document.drawString(45, height - 205, "Example field (interactive in source):")
            document.acroForm.textfield(name="example", value="SYNTHETIC FORM VALUE", x=45, y=height - 245, width=300, height=25, fontSize=12)
        document.showPage()
    document.save()
    writer = PdfWriter()
    writer.clone_document_from_reader(PdfReader(BytesIO(buffer.getvalue())))
    for page, (_, _, _, rotation) in zip(writer.pages, pages):
        if rotation:
            page.rotate(rotation)
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


for filename, pages in SOURCES.items():
    (ROOT / filename).write_bytes(make_pdf(pages))
(ROOT / "form.pdf").write_bytes(make_pdf([("FORM1", 500, 650, 0)], form=True))

# A genuine password-encrypted source; the password is public synthetic test data.
encrypted = PdfWriter()
encrypted.clone_document_from_reader(PdfReader(ROOT / "c.pdf"))
encrypted.encrypt("synthetic-fixture-only", algorithm="AES-256")
with (ROOT / "encrypted.pdf").open("wb") as output:
    encrypted.write(output)

# Detached CMS signature with a self-signed synthetic certificate. Private key is
# generated in memory, never written. This is integrity evidence, not trusted identity.
writer = PdfWriter()
writer.clone_document_from_reader(PdfReader(BytesIO(make_pdf([("SIG1", 460, 650, 0)]))))
signature = DictionaryObject({
    NameObject("/Type"): NameObject("/Sig"),
    NameObject("/Filter"): NameObject("/Adobe.PPKLite"),
    NameObject("/SubFilter"): NameObject("/adbe.pkcs7.detached"),
    NameObject("/ByteRange"): ArrayObject([NumberObject(0), NumberObject(1111111111), NumberObject(2222222222), NumberObject(3333333333)]),
    NameObject("/Contents"): ByteStringObject(bytes(8192)),
})
signature_ref = writer._add_object(signature)
field = writer._add_object(DictionaryObject({
    NameObject("/Type"): NameObject("/Annot"), NameObject("/Subtype"): NameObject("/Widget"),
    NameObject("/FT"): NameObject("/Sig"), NameObject("/T"): TextStringObject("SyntheticSignature"),
    NameObject("/Rect"): ArrayObject([NumberObject(0)] * 4), NameObject("/V"): signature_ref,
    NameObject("/P"): writer.pages[0].indirect_reference,
}))
writer.pages[0][NameObject("/Annots")] = ArrayObject([field])
writer.root_object[NameObject("/AcroForm")] = writer._add_object(DictionaryObject({NameObject("/Fields"): ArrayObject([field])}))
buffer = BytesIO()
writer.write(buffer)
unsigned = buffer.getvalue()
match = re.search(rb"/Contents\s*(<0{16384}>)", unsigned)
assert match
start, end = match.span(1)
signed = unsigned.replace(b"1111111111", f"{start:010d}".encode()).replace(b"2222222222", f"{end:010d}".encode()).replace(b"3333333333", f"{len(unsigned)-end:010d}".encode())
key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
identity = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Synthetic Merge Fixture")])
certificate = x509.CertificateBuilder().subject_name(identity).issuer_name(identity).public_key(key.public_key()).serial_number(1).not_valid_before(datetime(2026, 1, 1, tzinfo=timezone.utc)).not_valid_after(datetime(2036, 1, 1, tzinfo=timezone.utc)).sign(key, hashes.SHA256())
cms = pkcs7.PKCS7SignatureBuilder().set_data(signed[:start] + signed[end:]).add_signer(certificate, key, hashes.SHA256()).sign(serialization.Encoding.DER, [pkcs7.PKCS7Options.DetachedSignature, pkcs7.PKCS7Options.Binary])
assert len(cms) <= 8192
(ROOT / "signed.pdf").write_bytes(signed[:start+1] + cms.hex().encode().ljust(16384, b"0") + signed[end-1:])

(ROOT / "corrupt.pdf").write_bytes(b"%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 99 0 R >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF")
(ROOT / "truncated.pdf").write_bytes((ROOT / "a.pdf").read_bytes()[:90])

manifest = {
    "provenance": "Original project-authored synthetic fixtures; no external documents or personal data.",
    "license": "Project-owned test data; no third-party document license.",
    "authoringTools": {"reportlab": "4.4.9", "pypdf": "6.10.0", "cryptography": "50.0.1"},
    "pages": {name: [{"marker": m, "width": w, "height": h, "rotation": r} for m,w,h,r in pages] for name,pages in SOURCES.items()},
    "expectedOrders": {"a+b": ["A1", "A2", "B1", "B2"], "b+a": ["B1", "B2", "A1", "A2"], "c+b+a": ["C1", "B1", "B2", "A1", "A2"]},
    "sha256": {path.name: sha256(path.read_bytes()).hexdigest() for path in sorted(ROOT.glob("*.pdf"))},
}
(ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
print("Created 9 synthetic PDF fixtures and provenance manifest.")
