"""Optional independent verifier for Remove PDF Metadata output.

Reads a PDF file written by `/remove-pdf-metadata` and checks, using the
Python `pypdf` library (an entirely different parser from the project's
pdf-lib), that:

  - the Document Information dictionary is empty of standard ISO 32000-1
    §14.3.3 keys;
  - no custom Info-dictionary keys remain;
  - the Catalog has no /Metadata entry (XMP stream);
  - the trailer /ID is reported truthfully as present or absent;
  - the file still parses and still has the expected number of pages;
  - MediaBox and rotation are unchanged against a supplied reference.

The project's own lockfiles are NOT touched by this script. It is run
ad-hoc by the Product Owner or in CI, under a one-shot `uv pip install
pypdf` environment, when a fully pdf-lib-independent cross-check is
wanted. The project's engine already runs a byte-level verifier
(`packages/pdf-browser/src/metadata-removal-verify.ts`) that is enough
to gate the UI; this script is for extra defence in depth, not a hard
dependency.

Run:

  uv pip install pypdf
  python tests/fixtures/scripts/verify-metadata-removal-independent.py \
      path/to/metadata-removed.pdf \
      --reference tests/fixtures/pdf/metadata-rich.pdf

Exit codes:
  0  — every check passed
  1  — a check failed; details printed to stderr
  2  — pypdf not installed (install it or skip the script)
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

STANDARD_INFO_KEYS = (
    "/Title",
    "/Author",
    "/Subject",
    "/Keywords",
    "/Creator",
    "/Producer",
    "/CreationDate",
    "/ModDate",
    "/Trapped",
)


def load_pypdf():
    try:
        import pypdf  # type: ignore
    except ImportError:
        sys.stderr.write(
            "pypdf is not installed. This script is optional — install with\n"
            "    uv pip install pypdf\n"
            "or skip it; the TypeScript byte-scan verifier remains the gate.\n"
        )
        sys.exit(2)
    return pypdf


def read_fields(reader: Any) -> dict[str, Any]:
    try:
        info = reader.metadata
    except Exception:  # noqa: BLE001
        return {}
    if info is None:
        return {}
    try:
        return dict(info)
    except Exception:  # noqa: BLE001
        return {}


def pages_shape(reader: Any) -> list[tuple[tuple[float, float, float, float], int]]:
    out: list[tuple[tuple[float, float, float, float], int]] = []
    for page in reader.pages:
        mb = page.mediabox
        box = (float(mb.left), float(mb.bottom), float(mb.right), float(mb.top))
        rotation = int((page.rotation or 0) % 360)
        out.append((box, rotation))
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="The cleaned PDF to verify.")
    parser.add_argument(
        "--reference",
        type=Path,
        default=None,
        help="Optional reference PDF; MediaBox and rotation are compared against it.",
    )
    args = parser.parse_args()

    pypdf = load_pypdf()

    failures: list[str] = []

    with args.output.open("rb") as fh:
        reader = pypdf.PdfReader(fh)
        info = read_fields(reader)

        # 1. Standard Info entries must all be absent.
        for key in STANDARD_INFO_KEYS:
            if key in info:
                failures.append(f"standard Info key {key} survived: {info[key]!r}")

        # 2. Any custom Info entries must also be absent.
        for key in info:
            if key not in STANDARD_INFO_KEYS:
                failures.append(f"custom Info key {key} survived: {info[key]!r}")

        # 3. Catalog /Metadata (XMP) must be absent.
        catalog = reader.trailer.get("/Root")
        if catalog is not None:
            try:
                catalog_obj = catalog.get_object() if hasattr(catalog, "get_object") else catalog
                if "/Metadata" in catalog_obj:
                    failures.append("Catalog /Metadata (XMP stream) survived")
            except Exception as exc:  # noqa: BLE001
                failures.append(f"could not inspect Catalog: {exc!s}")

        # 4. Trailer /ID — report, do not fail. Still a SPIKE.
        trailer_id = reader.trailer.get("/ID")
        print(f"[info] trailer /ID present: {trailer_id is not None}")

        # 5. Page shape is preserved against the reference.
        output_pages = pages_shape(reader)
        print(f"[info] output page count: {len(output_pages)}")
        if args.reference is not None:
            with args.reference.open("rb") as ref_fh:
                ref_reader = pypdf.PdfReader(ref_fh)
                ref_pages = pages_shape(ref_reader)
            if len(ref_pages) != len(output_pages):
                failures.append(
                    f"page count changed: reference {len(ref_pages)} vs output {len(output_pages)}"
                )
            else:
                for i, (ref, out) in enumerate(zip(ref_pages, output_pages)):
                    if ref[0] != out[0]:
                        failures.append(f"page {i + 1} MediaBox changed: {ref[0]} -> {out[0]}")
                    if ref[1] != out[1]:
                        failures.append(f"page {i + 1} rotation changed: {ref[1]} -> {out[1]}")

    if failures:
        sys.stderr.write("INDEPENDENT VERIFICATION FAILED:\n")
        for failure in failures:
            sys.stderr.write(f"  - {failure}\n")
        return 1

    print("[ok] every independent check passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
