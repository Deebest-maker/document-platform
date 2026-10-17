from app.jobs.auth import (
    Credential,
    extract_bearer_token,
    hash_token,
    issue,
    new_job_id,
    new_token,
    tokens_match,
)


def test_new_ids_are_random_and_url_safe() -> None:
    ids = {new_job_id() for _ in range(50)}
    assert len(ids) == 50
    for value in ids:
        # URL-safe base64 alphabet only
        assert all(c.isalnum() or c in "-_" for c in value)


def test_new_tokens_are_random_and_long() -> None:
    tokens = {new_token() for _ in range(50)}
    assert len(tokens) == 50
    # URL-safe base64 of 32 bytes is 43 chars (no padding).
    assert all(len(token) >= 42 for token in tokens)


def test_hash_token_is_deterministic_and_hex() -> None:
    first = hash_token("secret")
    second = hash_token("secret")
    assert first == second
    assert len(first) == 64
    int(first, 16)


def test_hash_token_handles_empty_input() -> None:
    assert hash_token("") == ""


def test_tokens_match_only_on_identity() -> None:
    token = new_token()
    stored = hash_token(token)
    assert tokens_match(token, stored) is True
    assert tokens_match(token + "x", stored) is False
    assert tokens_match("", stored) is False
    assert tokens_match(token, "") is False


def test_issue_mints_a_consistent_pair() -> None:
    credential = issue()
    assert isinstance(credential, Credential)
    assert credential.job_id and credential.token
    assert credential.token_hash == hash_token(credential.token)
    assert tokens_match(credential.token, credential.token_hash)


def test_extract_bearer_token() -> None:
    assert extract_bearer_token("Bearer abc") == "abc"
    assert extract_bearer_token("Bearer   abc  ") == "abc"
    assert extract_bearer_token(None) is None
    assert extract_bearer_token("") is None
    assert extract_bearer_token("abc") is None
    assert extract_bearer_token("Basic abc") is None
    assert extract_bearer_token("Bearer ") is None
