"""Response headers for an API that never serves a page.

Every response is JSON, an empty body or a PDF download. None of it should be
cached, sniffed into another type, framed, or allowed to load anything, and the
referrer should not travel with it. Added here so a new route cannot forget.
"""

from __future__ import annotations

from typing import Final

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

_HEADERS: Final[tuple[tuple[str, str], ...]] = (
    ("X-Content-Type-Options", "nosniff"),
    ("Referrer-Policy", "no-referrer"),
    ("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'"),
    ("Cross-Origin-Resource-Policy", "same-site"),
)
# Set only if the route did not choose its own.
_DEFAULT_HEADERS: Final[tuple[tuple[str, str], ...]] = (("Cache-Control", "no-store"),)


class SecurityHeadersMiddleware:
    """Pure ASGI, so it never buffers a request or response body."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in _HEADERS:
                    headers[name] = value
                for name, value in _DEFAULT_HEADERS:
                    if name not in headers:
                        headers[name] = value
            await send(message)

        await self.app(scope, receive, send_with_headers)
