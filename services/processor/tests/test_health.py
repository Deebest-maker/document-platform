from fastapi.testclient import TestClient

from app.main import app


def test_liveness_exposes_only_safe_status() -> None:
    with TestClient(app) as client:
        response = client.get("/health/live")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    assert response.json() == {"status": "ok"}


def test_foundation_does_not_accept_document_jobs() -> None:
    with TestClient(app) as client:
        response = client.post("/v1/jobs/merge-pdf", content=b"synthetic input")

    assert response.status_code == 404
