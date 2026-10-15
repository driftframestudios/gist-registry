"""Exercise narrow error translation and last-accepted-state preservation."""
import hashlib
import json


class ReviewError(ValueError):
    code = "review_failure"
    message = "The review could not be accepted."
    recovery = "Return to the review owner."

    def __init__(self):
        super().__init__(self.message)

    def public(self):
        return {"code": self.code, "message": self.message, "recovery": self.recovery}


class SourceUnavailable(ReviewError):
    code = "source_unavailable"
    message = "The source could not be read."
    recovery = "Restore source access and request a new read."


class InvalidSource(ReviewError):
    code = "invalid_source"
    message = "The source is outside the supported review shape."
    recovery = "Supply the bounded source object for review."


class StaleReview(ReviewError):
    code = "stale_review"
    message = "The reviewed source differs from the received source."
    recovery = "Review the current source before acceptance."


def receive(read_source, reviewed_digest, accepted, validate):
    try:
        raw = read_source()
    except OSError as cause:
        raise SourceUnavailable() from cause
    if type(raw) is not bytes or len(raw) > 128:
        raise InvalidSource()
    if hashlib.sha256(raw).hexdigest() != reviewed_digest:
        raise StaleReview()
    try:
        value = json.loads(raw)
    except (ValueError, UnicodeError) as cause:
        raise InvalidSource() from cause
    if type(value) is not dict or set(value) != {"value"} or type(value["value"]) is not int:
        raise InvalidSource()
    validate(value)  # Owned calculation stays outside read/parse translation.
    accepted["bytes"] = raw
    return raw


def fail(error):
    raise error


def run():
    raw = b'{"value":7}'
    digest = hashlib.sha256(raw).hexdigest()
    state = {"bytes": b'{"value":3}'}
    prior = state["bytes"]
    cause = OSError("synthetic source detail stays in diagnostic context")
    try:
        receive(lambda: fail(cause), digest, state, lambda _: None)
    except SourceUnavailable as error:
        assert error.__cause__ is cause
        assert error.public() == {
            "code": "source_unavailable", "message": "The source could not be read.",
            "recovery": "Restore source access and request a new read."}
        assert "synthetic" not in json.dumps(error.public())
    else:
        raise AssertionError("The dependency failure needs a public category")
    for source, expected in ((b'{"value":8}', StaleReview), (b"x" * 129, InvalidSource)):
        try:
            receive(lambda: source, digest, state, lambda _: None)
        except expected:
            pass
        else:
            raise AssertionError("The source boundary failed")
        assert state["bytes"] == prior
    for error in (OSError("owned calculation defect"), RuntimeError("programming defect"), KeyboardInterrupt("control")):
        try:
            receive(lambda: raw, digest, state, lambda _: fail(error))
        except BaseException as observed:
            assert observed is error
        else:
            raise AssertionError("The exact internal/control failure must propagate")
        assert state["bytes"] == prior
    assert receive(lambda: raw, digest, state, lambda _: None) == raw
    assert state["bytes"] == raw
    print("PASS: fixed public category, private cause, stale/capacity rejection, narrow catch, exact control, retained state, success")


if __name__ == "__main__":
    if not __debug__:
        raise RuntimeError("Run this executable exercise with Python assertions enabled")
    run()
