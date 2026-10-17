"""HTTP-level integration tests for the job surface.

These tests cover the happy path (create → upload → convert → download →
delete) with the fake engine, plus authorization, state-transition and
input-validation edges. M4B adds DOCX preflight validation, so the
happy path must upload a valid DOCX.
"""

from __future__ import annotations

import io
import zipfile

from fastapi.testclient import TestClient

from app.config import Settings


def _minimal_docx() -> bytes:
    """Build a minimal valid DOCX that passes preflight validation."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            "[Content_Types].xml",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType='
            '"application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/word/document.xml" ContentType='
            '"application/vnd.openxmlformats-officedocument.wordprocessingml'
            '.document.main+xml"/>'
            "</Types>",
        )
        zf.writestr(
            "_rels/.rels",
            '<?xml version="1.0"?><Relationships/>',
        )
        zf.writestr(
            "word/document.xml",
            '<?xml version="1.0"?>'
            '<w:document xmlns:w="http://schemas.openxmlformats.org/'
            'wordprocessingml/2006/main">'
            "<w:body><w:p><w:r><w:t>test</w:t></w:r></w:p></w:body>"
            "</w:document>",
        )
    return buf.getvalue()


def _create(client: TestClient) -> tuple[str, str]:
    response = client.post("/v1/jobs", json={"tool": "word-to-pdf"})
    assert response.status_code == 201, response.text
    data = response.json()
    assert data["state"] == "created"
    return data["id"], data["token"]


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_happy_path(client: TestClient) -> None:
    job_id, token = _create(client)

    docx_bytes = _minimal_docx()
    upload = client.put(
        f"/v1/jobs/{job_id}/input",
        headers=_bearer(token),
        content=docx_bytes,
    )
    assert upload.status_code == 200

    state = client.get(f"/v1/jobs/{job_id}", headers=_bearer(token)).json()
    assert state["state"] == "uploading"
    assert state["input_bytes"] == len(docx_bytes)

    convert = client.post(f"/v1/jobs/{job_id}/convert", headers=_bearer(token))
    assert convert.status_code == 200, convert.text
    assert convert.json()["state"] == "succeeded"
    assert convert.json()["output_bytes"] > 0

    download = client.get(f"/v1/jobs/{job_id}/output", headers=_bearer(token))
    assert download.status_code == 200
    assert download.headers["content-type"] == "application/pdf"
    assert download.headers.get("cache-control") == "no-store"
    # Filename stays fixed; no part of the request derives it.
    disposition = download.headers.get("content-disposition", "")
    assert "word-to-pdf.pdf" in disposition
    assert download.content.startswith(b"%PDF-")

    delete = client.delete(f"/v1/jobs/{job_id}", headers=_bearer(token))
    assert delete.status_code == 204
    # Subsequent requests see INVALID_JOB because the job was deleted.
    gone = client.get(f"/v1/jobs/{job_id}", headers=_bearer(token))
    assert gone.status_code == 404
    assert gone.json()["detail"]["code"] == "invalid_job"


def test_authorization_header_is_required(client: TestClient) -> None:
    job_id, _ = _create(client)
    response = client.get(f"/v1/jobs/{job_id}")
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "invalid_token"


def test_unknown_job_returns_invalid_job(client: TestClient) -> None:
    response = client.get("/v1/jobs/does-not-exist", headers=_bearer("whatever"))
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "invalid_job"


def test_wrong_token_returns_invalid_token(client: TestClient) -> None:
    job_id, _ = _create(client)
    response = client.get(f"/v1/jobs/{job_id}", headers=_bearer("not-the-token"))
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "invalid_token"


def test_token_from_one_job_cannot_access_another(client: TestClient) -> None:
    job_a, token_a = _create(client)
    job_b, _token_b = _create(client)
    assert job_a != job_b
    response = client.get(f"/v1/jobs/{job_b}", headers=_bearer(token_a))
    assert response.status_code == 401


def test_empty_upload_is_invalid_input(client: TestClient) -> None:
    job_id, token = _create(client)
    response = client.put(
        f"/v1/jobs/{job_id}/input", headers=_bearer(token), content=b""
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_input"


def test_oversized_upload_is_limit_exceeded(
    client: TestClient, processor_settings: Settings
) -> None:
    job_id, token = _create(client)
    oversize = b"x" * (processor_settings.max_input_bytes + 1)
    response = client.put(
        f"/v1/jobs/{job_id}/input", headers=_bearer(token), content=oversize
    )
    assert response.status_code == 413
    assert response.json()["detail"]["code"] == "limit_exceeded"


def test_cannot_convert_before_uploading(client: TestClient) -> None:
    job_id, token = _create(client)
    response = client.post(f"/v1/jobs/{job_id}/convert", headers=_bearer(token))
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "conflict"


def test_cannot_download_before_succeeded(client: TestClient) -> None:
    job_id, token = _create(client)
    response = client.get(f"/v1/jobs/{job_id}/output", headers=_bearer(token))
    assert response.status_code == 409


def test_delete_is_idempotent(client: TestClient) -> None:
    job_id, token = _create(client)
    first = client.delete(f"/v1/jobs/{job_id}", headers=_bearer(token))
    assert first.status_code == 204
    second = client.delete(f"/v1/jobs/{job_id}", headers=_bearer(token))
    # After the first delete the job is gone, so the second returns 404.
    assert second.status_code == 404


def test_only_known_tool_is_accepted(client: TestClient) -> None:
    response = client.post("/v1/jobs", json={"tool": "pdf-to-word"})
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_input"


def test_cannot_upload_twice(client: TestClient) -> None:
    job_id, token = _create(client)
    first = client.put(
        f"/v1/jobs/{job_id}/input", headers=_bearer(token), content=b"PK"
    )
    assert first.status_code == 200
    second = client.put(
        f"/v1/jobs/{job_id}/input", headers=_bearer(token), content=b"PK"
    )
    assert second.status_code == 409
