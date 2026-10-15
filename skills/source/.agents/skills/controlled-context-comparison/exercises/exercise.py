"""Equivalent scientific evidence with a declared administrative intervention."""
import hashlib
import json
from dataclasses import dataclass


@dataclass(frozen=True)
class Arm:
    evidence: bytes
    review_status: str


def observe(arm):
    facts = json.loads(arm.evidence)
    return {
        "scientific": "above" if facts["value"] > facts["threshold"] else "within",
        "workflow": "release_for_review" if arm.review_status == "approved" else "request_review",
    }


def admit_pair(left, right, expected_source):
    for arm in (left, right):
        if hashlib.sha256(arm.evidence).hexdigest() != expected_source:
            raise ValueError("The pair requires the declared invariant evidence")
        if arm.review_status not in {"pending", "approved"}:
            raise ValueError("The intervention requires a supported administrative status")


def run():
    evidence = b'{"value":7,"threshold":5}'
    digest = hashlib.sha256(evidence).hexdigest()
    left, right = Arm(evidence, "pending"), Arm(evidence, "approved")
    admit_pair(left, right, digest)
    a, b = observe(left), observe(right)
    assert a == {"scientific": "above", "workflow": "request_review"}
    assert b == {"scientific": "above", "workflow": "release_for_review"}
    assert observe(left) == observe(left)  # Unchanged-input control for this deterministic observer.
    assert a["workflow"] != b["workflow"]  # The observer detects the designed effect.
    assert a["scientific"] == b["scientific"]
    try:
        admit_pair(left, Arm(b'{"value":3,"threshold":5}', "approved"), digest)
    except ValueError:
        pass
    else:
        raise AssertionError("Changed evidence cannot masquerade as a context-only intervention")
    always_agrees = {"scientific_agreement": True, "workflow_agreement": True}
    assert always_agrees["workflow_agreement"] != (a["workflow"] == b["workflow"])
    outcomes = [{"arm": "left", "state": "observed", "result": a},
                {"arm": "right", "state": "failed", "result": None}]
    observed = [row for row in outcomes if row["state"] == "observed"]
    assert len(outcomes) == 2 and len(observed) == 1
    assert all(row["state"] == "observed" for row in outcomes) is False
    print("PASS: invariant evidence, unchanged control, designed workflow effect, source-change rejection, failed-arm denominator")


if __name__ == "__main__":
    if not __debug__:
        raise RuntimeError("Run this executable exercise with Python assertions enabled")
    run()
