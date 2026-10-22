"""Caller identity for per-client limits (M7B, ADR-033)."""

from __future__ import annotations

from starlette.requests import Request

from app.jobs.client import caller_address, client_key, new_salt


def _request(peer: str | None, forwarded: str | None = None) -> Request:
    headers: list[tuple[bytes, bytes]] = []
    if forwarded is not None:
        headers.append((b"x-forwarded-for", forwarded.encode()))
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/v1/jobs",
        "headers": headers,
        "client": (peer, 5000) if peer is not None else None,
    }
    return Request(scope)


def test_without_a_trusted_proxy_the_peer_is_the_caller_and_the_header_is_ignored() -> (
    None
):
    request = _request("203.0.113.9", "198.51.100.1, 192.0.2.7")
    assert caller_address(request, 0) == "203.0.113.9"


def test_one_trusted_proxy_means_the_last_entry_is_the_caller() -> None:
    # The client sent "6.6.6.6"; our proxy appended the address it saw.
    request = _request("10.0.0.2", "6.6.6.6, 203.0.113.9")
    assert caller_address(request, 1) == "203.0.113.9"


def test_two_trusted_proxies_means_second_from_the_right() -> None:
    request = _request("10.0.0.3", "6.6.6.6, 203.0.113.9, 10.0.0.2")
    assert caller_address(request, 2) == "203.0.113.9"


def test_entries_left_of_the_trusted_ones_cannot_choose_the_bucket() -> None:
    first = _request("10.0.0.2", "1.1.1.1, 203.0.113.9")
    second = _request("10.0.0.2", "2.2.2.2, 203.0.113.9")
    salt = new_salt()
    assert client_key(first, trusted_hops=1, salt=salt) == client_key(
        second, trusted_hops=1, salt=salt
    )


def test_a_missing_or_short_header_falls_back_to_the_peer() -> None:
    assert caller_address(_request("10.0.0.2"), 1) == "10.0.0.2"
    assert caller_address(_request("10.0.0.2", "203.0.113.9"), 2) == "10.0.0.2"


def test_a_garbage_entry_falls_back_to_the_peer() -> None:
    assert caller_address(_request("10.0.0.2", "not-an-ip"), 1) == "10.0.0.2"


def test_ipv6_callers_share_a_budget_per_64() -> None:
    a = _request("2001:db8:1:2:aaaa:bbbb:cccc:dddd")
    b = _request("2001:db8:1:2:1111:2222:3333:4444")
    other = _request("2001:db8:1:3::1")
    salt = new_salt()
    assert client_key(a, trusted_hops=0, salt=salt) == client_key(
        b, trusted_hops=0, salt=salt
    )
    assert client_key(a, trusted_hops=0, salt=salt) != client_key(
        other, trusted_hops=0, salt=salt
    )


def test_an_ipv4_mapped_ipv6_address_is_the_ipv4_address() -> None:
    assert caller_address(_request("::ffff:203.0.113.9"), 0) == "203.0.113.9"


def test_no_peer_still_gives_a_key() -> None:
    assert client_key(_request(None), trusted_hops=0, salt=new_salt())


def test_the_key_is_not_the_address_and_changes_with_the_salt() -> None:
    request = _request("203.0.113.9")
    first = client_key(request, trusted_hops=0, salt=new_salt())
    second = client_key(request, trusted_hops=0, salt=new_salt())
    assert "203.0.113.9" not in first
    assert first != second
