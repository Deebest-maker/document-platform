from app.errors import MESSAGES, STATUS, ErrorCode, ProcessorError


def test_every_error_code_has_a_message_and_status() -> None:
    for code in ErrorCode:
        assert code in MESSAGES, code
        assert code in STATUS, code
        assert MESSAGES[code]
        assert 400 <= STATUS[code] < 600


def test_processor_error_carries_safe_vocabulary_only() -> None:
    error = ProcessorError(ErrorCode.INVALID_INPUT)
    assert error.code is ErrorCode.INVALID_INPUT
    assert error.message == MESSAGES[ErrorCode.INVALID_INPUT]
    # The exception's own str must be the stable code, never a path or filename.
    assert str(error) == "invalid_input"


def test_messages_contain_no_identifying_placeholders() -> None:
    # Our allowlisted copy never relies on `.format()` placeholders.
    for message in MESSAGES.values():
        assert "{" not in message
        assert "%s" not in message
