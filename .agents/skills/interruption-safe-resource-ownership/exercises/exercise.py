"""Synthetic lifecycle model: ownership and interruption have separate oracles."""

from dataclasses import dataclass


@dataclass
class Pending:
    owned: bool = True
    visible: bool = False

    def publish(self, *, retain_obsolete_owner=False):
        self.visible = True
        self.owned = retain_obsolete_owner


def release_all(actions):
    failures = []
    for action in actions:
        try:
            action()
        except BaseException as error:
            failures.append(error)
    return failures


def selected_failure(primary, secondary, *, bypass_control=False):
    failures = [error for error in [primary, *secondary] if error is not None]
    if not bypass_control:
        for error in failures:
            if not isinstance(error, Exception):
                return error
    return failures[0] if failures else None


def require(condition, message="exercise expectation differed"):
    if not condition:
        raise AssertionError(message)


def ownership_oracle(value):
    require(value.visible is True)
    require(value.owned is False, "a published target has transferred ownership")


def run():
    attempts = []
    primary = OSError("synthetic operation failure")
    control = KeyboardInterrupt("synthetic control")

    def interrupted_close():
        attempts.append("stream")
        raise control

    failures = release_all([interrupted_close, lambda: attempts.append("descriptor")])
    require(attempts == ["stream", "descriptor"])
    require(failures == [control])
    require(selected_failure(primary, failures) is control)
    require(selected_failure(control, [primary]) is control)
    require(selected_failure(primary, []) is primary)

    published = Pending()
    published.publish()
    ownership_oracle(published)

    mutated = Pending()
    mutated.publish(retain_obsolete_owner=True)
    try:
        ownership_oracle(mutated)
    except AssertionError:
        pass
    else:
        raise AssertionError("ownership mutation must be detected")
    try:
        require(selected_failure(primary, failures, bypass_control=True) is control)
    except AssertionError:
        pass
    else:
        raise AssertionError("control-priority mutation must be detected")
    print("lifecycle exercise: passed; remaining releases, transfer, and control identity observed; two mutations distinguished")


if __name__ == "__main__":
    run()
