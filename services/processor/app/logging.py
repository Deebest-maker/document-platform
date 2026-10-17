"""Structured, allowlisted logging.

The processor emits only JSON-shaped log records with fields drawn from
a fixed allowlist. Document bytes, extracted text, user filenames,
tokens and raw tracebacks never reach a log line. The logger prefers
machine-readable output so a future log aggregator can filter on
`event`, `code` and `job_id` without parsing free-form messages.

M4A ships this helper so later slices (M4B/M4C) do not reinvent it or
leak content accidentally.
"""

from __future__ import annotations

import json
import logging
import sys
from typing import Any, Final

_ALLOWED_FIELDS: Final[frozenset[str]] = frozenset(
    {
        "event",
        "level",
        "code",
        "job_id",
        "tool",
        "state",
        "input_bytes",
        "output_bytes",
        "duration_ms",
        "engine",
        "pid",
    }
)


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:  # noqa: D401
        payload: dict[str, Any] = {
            "level": record.levelname.lower(),
            "event": record.getMessage(),
        }
        extras = getattr(record, "extra_fields", None)
        if isinstance(extras, dict):
            for key, value in extras.items():
                if key in _ALLOWED_FIELDS:
                    payload[key] = value
        return json.dumps(payload, separators=(",", ":"), ensure_ascii=True)


def configure_logging(level: int = logging.INFO) -> None:
    """Install the JSON handler on the root logger.

    Idempotent: calling twice does not duplicate handlers. We attach to
    `processor` namespace loggers only; the root logger is left to the
    uvicorn/pytest harness so test output stays readable.
    """
    logger = logging.getLogger("processor")
    logger.setLevel(level)
    logger.propagate = False
    for handler in logger.handlers:
        if getattr(handler, "_processor_configured", False):
            return
    handler = logging.StreamHandler(stream=sys.stdout)
    handler.setFormatter(_JsonFormatter())
    handler._processor_configured = True  # type: ignore[attr-defined]
    logger.addHandler(handler)


def safe_log(
    logger: logging.Logger,
    level: int,
    event: str,
    **fields: Any,
) -> None:
    """Emit a log record carrying only allowlisted fields.

    Unknown keys are silently dropped. This is a last-line defence
    against a caller passing `filename` or `token` by accident.
    """
    filtered = {key: value for key, value in fields.items() if key in _ALLOWED_FIELDS}
    logger.log(level, event, extra={"extra_fields": filtered})
