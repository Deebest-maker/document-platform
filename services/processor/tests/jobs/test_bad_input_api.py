"""Bad input, end to end over HTTP (M7D).

The processor decides about a file from its bytes alone. These tests send it
what a careless or hostile caller would: files that are not Word documents
under a Word document's name and type, names and headers meant to reach the
file system or a shell or a page, and documents that pass the preflight but
that the converter cannot read. In every case the answer is a short, fixed
error, nothing the caller sent comes back, nothing is left on disk after the
job is deleted, and a good document sent next still converts.
"""

from __future__ import annotations

import io
import shutil
import zipfile
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

from .helpers import _bearer, _create, _loadable_docx, _minimal_docx

DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

# What a caller might send in place of a Word document, with the bytes that
# make each one what it is.
NOT_A_DOCX: dict[str, bytes] = {
    "pdf": b"%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF\n",
    "rtf": b"{\\rtf1\\ansi Hello}",
    "html": b"<html><body><script>alert(1)</script></body></html>",
    "text": b"just some words",
    "png": b"\x89PNG\r\n\x1a\n" + b"\x00" * 32,
    "windows-program": b"MZ\x90\x00" + b"\x00" * 60,
    "legacy-doc": b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 512,
    "empty-zip": b"PK\x05\x06" + b"\x00" * 18,
    "truncated-docx": _minimal_docx()[:200],
    "one-byte": b"\x00",
}

# Names and header values that mean something to a file system, a shell or a
# browser. The processor never reads any of them.
HOSTILE_NAMES = [
    "../../../etc/passwd",
    "..\\..\\windows\\system32\\config",
    "/etc/shadow",
    "report.docx; rm -rf /",
    "$(touch pwned).docx",
    "`id`.docx",
    "a\x00b.docx",
    "<img src=x onerror=alert(1)>.docx",
    "con.docx",
    "x" * 4000 + ".docx",
]


def _upload(
    client: TestClient,
    job_id: str,
    token: str,
    data: bytes,
    headers: dict[str, str] | None = None,
) -> None:
    response = client.put(
        f"/v1/jobs/{job_id}/input",
        headers={**_bearer(token), **(headers or {})},
        content=data,
    )
    assert response.status_code == 200, response.text


def _jobs_on_disk(settings: Settings) -> list[str]:
    return sorted(
        entry.name for entry in settings.jobs_root.iterdir() if entry.is_dir()
    )


def _convert_and_delete(
    client: TestClient, job_id: str, token: str
) -> tuple[int, dict[str, object]]:
    response = client.post(f"/v1/jobs/{job_id}/convert", headers=_bearer(token))
    body = response.json()
    assert (
        client.delete(f"/v1/jobs/{job_id}", headers=_bearer(token)).status_code == 204
    )
    return response.status_code, body


@pytest.mark.parametrize("kind", sorted(NOT_A_DOCX))
def test_a_file_that_is_not_a_docx_is_refused_whatever_it_is_called(
    client: TestClient, processor_settings: Settings, kind: str
) -> None:
    job_id, token = _create(client)
    # Declared as exactly what the converter wants; the bytes say otherwise.
    _upload(
        client,
        job_id,
        token,
        NOT_A_DOCX[kind],
        {
            "Content-Type": DOCX_TYPE,
            "Content-Disposition": 'attachment; filename="report.docx"',
        },
    )
    response = client.post(f"/v1/jobs/{job_id}/convert", headers=_bearer(token))
    assert response.status_code == 400, response.text
    assert response.json()["detail"]["code"] == "invalid_input"

    state = client.get(f"/v1/jobs/{job_id}", headers=_bearer(token)).json()
    assert state["state"] == "failed"
    assert state["error_code"] == "invalid_input"
    # No PDF exists to be fetched.
    assert (
        client.get(f"/v1/jobs/{job_id}/output", headers=_bearer(token)).status_code
        == 409
    )

    assert (
        client.delete(f"/v1/jobs/{job_id}", headers=_bearer(token)).status_code == 204
    )
    assert _jobs_on_disk(processor_settings) == []


@pytest.mark.parametrize(
    "declared",
    ["text/html", "application/pdf", "image/png", "text/plain", "", "garbage"],
)
def test_a_real_docx_converts_whatever_type_it_is_sent_as(
    client: TestClient, declared: str
) -> None:
    """The declared type is a hint the processor does not use."""
    job_id, token = _create(client)
    _upload(
        client,
        job_id,
        token,
        _minimal_docx(),
        {"Content-Type": declared} if declared else {},
    )
    response = client.post(f"/v1/jobs/{job_id}/convert", headers=_bearer(token))
    assert response.status_code == 200, response.text
    assert response.json()["state"] == "succeeded"
    client.delete(f"/v1/jobs/{job_id}", headers=_bearer(token))


@pytest.mark.parametrize("name", HOSTILE_NAMES, ids=lambda n: repr(n[:24]))
def test_a_hostile_file_name_reaches_nothing(
    client: TestClient, processor_settings: Settings, name: str
) -> None:
    job_id, token = _create(client)
    sent = name.replace("\x00", "").replace('"', "")
    headers = {
        "X-File-Name": sent,
        "Content-Disposition": f'attachment; filename="{sent}"',
    }
    _upload(client, job_id, token, _minimal_docx(), headers)

    workspace = processor_settings.jobs_root / job_id
    assert sorted(p.name for p in workspace.iterdir()) == ["input.docx"]

    response = client.post(f"/v1/jobs/{job_id}/convert", headers=_bearer(token))
    assert response.status_code == 200, response.text
    # Nothing the caller sent comes back: not in the body, not in a header.
    assert name[:20] not in response.text
    assert all(name[:20] not in value for value in response.headers.values())

    download = client.get(f"/v1/jobs/{job_id}/output", headers=_bearer(token))
    assert download.status_code == 200
    assert 'filename="word-to-pdf.pdf"' in download.headers["content-disposition"]
    assert sorted(p.name for p in workspace.iterdir()) == [
        "input.docx",
        "word-to-pdf.pdf",
    ]
    assert (
        client.delete(f"/v1/jobs/{job_id}", headers=_bearer(token)).status_code == 204
    )
    assert _jobs_on_disk(processor_settings) == []
    # Nothing was written outside the jobs root either.
    assert not Path("/etc/passwd.docx").exists()
    assert not Path("pwned.docx").exists()


@pytest.mark.parametrize(
    "tool",
    [
        "../word-to-pdf",
        "word-to-pdf; id",
        "WORD-TO-PDF",
        "",
        " ",
        "x" * 5000,
        "merge-pdf",
    ],
)
def test_an_unknown_or_hostile_tool_name_creates_no_job(
    client: TestClient, processor_settings: Settings, tool: str
) -> None:
    response = client.post("/v1/jobs", json={"tool": tool})
    assert response.status_code == 400, response.text
    assert response.json()["detail"]["code"] == "invalid_input"
    assert tool[:20] not in response.text or tool == "merge-pdf" or tool.strip() == ""
    assert _jobs_on_disk(processor_settings) == []


@pytest.mark.parametrize(
    "body",
    [
        b"",
        b"not json",
        b"[]",
        b'{"tool": 7}',
        b'{"tool": null}',
        b'{"tool": "<script>alert(1)</script>' + b"x" * 3000 + b'"}',
        b"\xff\xfe\x00garbage",
    ],
    ids=["empty", "not-json", "array", "number", "null", "script-and-long", "binary"],
)
def test_a_malformed_create_request_gets_the_fixed_error_and_creates_no_job(
    client: TestClient, processor_settings: Settings, body: bytes
) -> None:
    response = client.post(
        "/v1/jobs", content=body, headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 400, response.text
    # Only the fixed vocabulary: no field names, no parser wording, no echo.
    assert response.json() == {
        "detail": {
            "code": "invalid_input",
            "message": "The uploaded file could not be accepted.",
        }
    }
    assert _jobs_on_disk(processor_settings) == []


def test_after_a_refusal_the_next_document_still_converts(client: TestClient) -> None:
    for data in (NOT_A_DOCX["pdf"], NOT_A_DOCX["truncated-docx"]):
        job_id, token = _create(client)
        _upload(client, job_id, token, data)
        status, _ = _convert_and_delete(client, job_id, token)
        assert status == 400
    job_id, token = _create(client)
    _upload(client, job_id, token, _minimal_docx())
    status, body = _convert_and_delete(client, job_id, token)
    assert status == 200
    assert body["state"] == "succeeded"


def test_refusals_say_nothing_about_the_file(client: TestClient) -> None:
    secret = b"SECRET-PAYLOAD-4f2a"
    job_id, token = _create(client)
    _upload(client, job_id, token, b"%PDF-1.7 " + secret)
    response = client.post(f"/v1/jobs/{job_id}/convert", headers=_bearer(token))
    assert secret.decode() not in response.text
    state = client.get(f"/v1/jobs/{job_id}", headers=_bearer(token))
    assert secret.decode() not in state.text
    assert set(response.json()["detail"]) == {"code", "message"}


# ── With the real converter ─────────────────────────────────────────────

needs_soffice = pytest.mark.skipif(
    shutil.which("soffice") is None, reason="LibreOffice not installed"
)


def _with_document_xml(document_xml: str) -> bytes:
    source = zipfile.ZipFile(io.BytesIO(_loadable_docx()))
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for info in source.infolist():
            data = source.read(info.filename)
            zf.writestr(
                info.filename,
                document_xml.encode() if info.filename == "word/document.xml" else data,
            )
    return buf.getvalue()


@pytest.fixture
def real_client(processor_settings: Settings) -> Iterator[TestClient]:
    """The app with LibreOffice in place of the fake converter."""
    settings = processor_settings.model_copy(
        update={"environment": "development", "runner_timeout_seconds": 60}
    )
    with TestClient(create_app(settings=settings)) as client:
        yield client


@needs_soffice
@pytest.mark.parametrize(
    "document_xml",
    [
        # Both start like XML, so they pass the preflight; only the converter
        # can tell they are not readable.
        "<<< this is not xml at all <<<",
        '<?xml version="1.0"?><w:document xmlns:w="urn:w"><w:p>',
    ],
    ids=["not-xml", "truncated-xml"],
)
def test_an_unreadable_document_is_the_documents_fault_not_the_servers(
    real_client: TestClient, processor_settings: Settings, document_xml: str
) -> None:
    job_id, token = _create(real_client)
    _upload(real_client, job_id, token, _with_document_xml(document_xml))
    response = real_client.post(f"/v1/jobs/{job_id}/convert", headers=_bearer(token))
    # 422, not 500: a caller who sees 500 is told to try again with the same file.
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "conversion_failed"
    state = real_client.get(f"/v1/jobs/{job_id}", headers=_bearer(token)).json()
    assert state["state"] == "failed"
    assert state["error_code"] == "conversion_failed"
    assert (
        real_client.delete(f"/v1/jobs/{job_id}", headers=_bearer(token)).status_code
        == 204
    )
    assert _jobs_on_disk(processor_settings) == []


@needs_soffice
def test_the_real_converter_still_converts_the_next_document(
    real_client: TestClient,
) -> None:
    job_id, token = _create(real_client)
    _upload(real_client, job_id, token, _with_document_xml("<<< not xml"))
    assert (
        real_client.post(
            f"/v1/jobs/{job_id}/convert", headers=_bearer(token)
        ).status_code
        == 422
    )
    real_client.delete(f"/v1/jobs/{job_id}", headers=_bearer(token))

    job_id, token = _create(real_client)
    _upload(real_client, job_id, token, _loadable_docx())
    response = real_client.post(f"/v1/jobs/{job_id}/convert", headers=_bearer(token))
    assert response.status_code == 200, response.text
    download = real_client.get(f"/v1/jobs/{job_id}/output", headers=_bearer(token))
    assert download.content.startswith(b"%PDF-")
    real_client.delete(f"/v1/jobs/{job_id}", headers=_bearer(token))


def test_a_main_document_that_is_not_xml_is_refused_before_the_converter(
    client: TestClient,
) -> None:
    job_id, token = _create(client)
    _upload(client, job_id, token, _with_document_xml("this is not xml"))
    response = client.post(f"/v1/jobs/{job_id}/convert", headers=_bearer(token))
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_input"
