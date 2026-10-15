"""Bounded label admission with explicit pre-sort and ownership observations."""

MAX_MEMBERS = 4
MAX_LABEL_BYTES = 8


class CapacityError(ValueError):
    pass


def capture(labels, sort_values=sorted):
    if type(labels) is not list:
        raise ValueError("labels must be a list")
    if len(labels) > MAX_MEMBERS:
        raise CapacityError("label count exceeds supported capacity")
    for value in labels:
        if type(value) is not str:
            raise ValueError("labels must contain text")
        if len(value) > MAX_LABEL_BYTES:
            raise CapacityError("label length exceeds byte capacity")
        if len(value.encode("utf-8")) > MAX_LABEL_BYTES:
            raise CapacityError("label bytes exceed supported capacity")
    return tuple(sort_values(labels))


def require(condition, message="exercise expectation differed"):
    if not condition:
        raise AssertionError(message)


def run():
    calls = []

    def observe_sort(values):
        calls.append(len(values))
        return sorted(values)

    caller = ["ββββ", "a"]
    admitted = capture(caller, observe_sort)
    require(admitted == ("a", "ββββ"))
    caller[:] = ["changed"]
    require(admitted == ("a", "ββββ"))
    require(calls == [2])
    for invalid in [["a"] * 5, ["ββββa"], ["a" * 1000]]:
        try:
            capture(invalid, observe_sort)
        except CapacityError:
            pass
        else:
            raise AssertionError("one-over input must be rejected")
    require(calls == [2], "capacity rejection precedes sorting and snapshot allocation")
    # Contrast: a late budget check already performed the protected sorting.
    observe_sort(["a"] * 5)
    require(calls != [2], "the same independent oracle detects late admission")
    print("admission exercise: passed; UTF-8 edge, pre-sort rejection, snapshot ownership, and late-check contrast observed")


if __name__ == "__main__":
    run()
