from fastapi.testclient import TestClient


def test_liveness_exposes_only_safe_status(client: TestClient) -> None:
    response = client.get("/health/live")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    assert response.json() == {"status": "ok"}


def test_readiness_is_ok_when_jobs_root_is_valid(client: TestClient) -> None:
    response = client.get("/health/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_foundation_endpoint_404_still_holds(client: TestClient) -> None:
    response = client.post("/v1/jobs/merge-pdf", content=b"synthetic input")
    assert response.status_code in (404, 405)
