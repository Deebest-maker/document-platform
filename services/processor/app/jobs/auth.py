"""Capability-token authorization.

Each job has:
    * `id` — random URL-safe identifier used only for addressing.
    * `token` — separate cryptographically random secret given to the
      browser once, never persisted server-side; only its hash is stored.

The browser presents both: `GET /v1/jobs/{id}` with
`Authorization: Bearer <token>`. The server resolves the job by ID, then
compares the hash of the supplied token to the stored hash in constant
time. Any mismatch returns INVALID_TOKEN (401); a job that does not exist
returns INVALID_JOB (404). Both branches are indistinguishable in timing
to a well-behaved client.

Both the ID and the token are 256-bit URL-safe values; a per-request lookup
costs one dict access and one `hmac.compare_digest`.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from typing import Final

_ID_BYTES: Final[int] = 16  # 128 bits — collision-resistant for in-memory store.
_TOKEN_BYTES: Final[int] = 32  # 256 bits — the actual secret.


def new_job_id() -> str:
    """Random URL-safe job identifier."""
    return secrets.token_urlsafe(_ID_BYTES)


def new_token() -> str:
    """Random URL-safe capability token. Never stored server-side."""
    return secrets.token_urlsafe(_TOKEN_BYTES)


def hash_token(token: str) -> str:
    """SHA-256 of the token as hex. Deterministic; comparison uses constant time."""
    if not token:
        return ""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def tokens_match(supplied_token: str, stored_hash: str) -> bool:
    """Constant-time comparison of a supplied token's hash against the stored one.

    Returns False for empty inputs. Mismatched lengths still take constant
    time because hashlib emits a fixed-length hex string.
    """
    if not supplied_token or not stored_hash:
        return False
    candidate = hash_token(supplied_token)
    return hmac.compare_digest(candidate, stored_hash)


@dataclass(slots=True, frozen=True)
class Credential:
    """A fresh (job_id, token) pair handed to the browser once."""

    job_id: str
    token: str
    token_hash: str


def issue() -> Credential:
    """Mint a new credential pair."""
    job_id = new_job_id()
    token = new_token()
    return Credential(job_id=job_id, token=token, token_hash=hash_token(token))


_BEARER_PREFIX: Final[str] = "Bearer "


def extract_bearer_token(authorization_header: str | None) -> str | None:
    """Pull `<token>` out of an `Authorization: Bearer <token>` header.

    Returns None on missing/malformed input. Does NOT log the token.
    """
    if not authorization_header:
        return None
    if not authorization_header.startswith(_BEARER_PREFIX):
        return None
    token = authorization_header[len(_BEARER_PREFIX) :].strip()
    return token or None
