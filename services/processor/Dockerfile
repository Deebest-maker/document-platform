FROM ghcr.io/astral-sh/uv:0.12.18@sha256:3adc3706091ce7c2fe595e669628caedd6d951551b92b258b7e7dbe06d9440bc AS uv
FROM python:3.13.15-slim-bookworm@sha256:2325bb286ec344af3e5898cc224b5844e2707ac6e26b1632516fd3edc84a5e26 AS builder

COPY --from=uv /uv /usr/local/bin/uv
ENV UV_PYTHON_DOWNLOADS=never UV_LINK_MODE=copy
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

FROM python:3.13.15-slim-bookworm@sha256:2325bb286ec344af3e5898cc224b5844e2707ac6e26b1632516fd3edc84a5e26 AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

# ── System packages: LibreOffice Writer (headless), qpdf, fonts ─────
# Licenses:
#   libreoffice-writer: MPL-2.0 (see /usr/share/doc/libreoffice-common/copyright)
#   qpdf:              Apache-2.0
#   fonts-liberation2:  OFL-1.1 (SIL Open Font License)
#
# --no-install-recommends avoids X11/desktop dependencies.
# The apt lists are cleaned to keep the image lean.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libreoffice-writer \
        qpdf \
        fonts-liberation2 \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 10001 processor && useradd --uid 10001 --gid processor --no-create-home processor

# ── Jobs root directory ─────────────────────────────────────────────
# Created at build time with the sentinel so the processor can start
# without manual setup. Owned by the processor user.
RUN mkdir -p /var/lib/document-platform-processor/jobs \
    && touch /var/lib/document-platform-processor/jobs/.document-platform-jobs-root \
    && chown -R 10001:10001 /var/lib/document-platform-processor

COPY --from=builder /app/.venv /app/.venv
COPY app ./app

USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 CMD ["/app/.venv/bin/python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health/live', timeout=2)"]
CMD ["/app/.venv/bin/uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log", "--no-server-header"]
