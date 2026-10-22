"""Who is calling, without keeping their address.

Per-client limits need a stable key for one caller. The key is a keyed hash
(BLAKE2b with a random per-process salt) of the caller's network address, so
neither the limiter nor the job record holds an address, and a memory dump
cannot be turned back into one. The salt changes on every start: nothing
persists across restarts, by design. The key is never logged.

Which address is "the caller" depends on the deployment:

* ``trusted_hops == 0`` (default): the TCP peer. Right when clients connect
  directly. Behind a reverse proxy it is the proxy for everyone, so every
  client would share one budget.
* ``trusted_hops == N``: ``N`` trusted proxies append to ``X-Forwarded-For``;
  the caller is the entry the first of them recorded, ``N`` from the right.
  Anything further left is client-supplied and ignored, so it cannot be used
  to pick a different bucket.

IPv6 callers are keyed by their /64, because one subscriber normally holds a
whole /64 and could otherwise rotate addresses to dodge the limit.
"""

from __future__ import annotations

import hashlib
import ipaddress
import secrets
from typing import Final

from starlette.requests import Request

_UNKNOWN: Final[str] = "unknown"


def new_salt() -> bytes:
    return secrets.token_bytes(16)


def _normalise(raw: str) -> str | None:
    try:
        address = ipaddress.ip_address(raw.strip())
    except ValueError:
        return None
    if isinstance(address, ipaddress.IPv6Address):
        if address.ipv4_mapped is not None:
            return str(address.ipv4_mapped)
        return str(ipaddress.ip_network(f"{address}/64", strict=False))
    return str(address)


def caller_address(request: Request, trusted_hops: int) -> str:
    """Best available address for the caller, normalised; never empty."""
    peer = request.client.host if request.client else ""
    if trusted_hops > 0:
        parts = [
            part.strip()
            for part in request.headers.get("x-forwarded-for", "").split(",")
            if part.strip()
        ]
        if len(parts) >= trusted_hops:
            forwarded = _normalise(parts[-trusted_hops])
            if forwarded is not None:
                return forwarded
    return _normalise(peer) or peer or _UNKNOWN


def client_key(request: Request, *, trusted_hops: int, salt: bytes) -> str:
    address = caller_address(request, trusted_hops)
    return hashlib.blake2b(address.encode(), key=salt, digest_size=12).hexdigest()
