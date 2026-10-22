import "../node-runtime-admission.mjs";

import assert from "node:assert/strict";
import test from "node:test";
import {
  createReceiverController,
  ReceiverNotificationError
} from "../src/controller.mjs";
import {
  beginPreview,
  chooseDraft,
  createReceiverState,
  releaseAccepted,
  settlePreview,
  RECEIVER_TRANSITIONS
} from "../src/model.mjs";

test("draft, request, accepted, and released state remain distinct", () => {
  const initial = createReceiverState("participant-intake");
  const drafted = chooseDraft(initial, "review-routing");
  const started = beginPreview(drafted);

  assert.equal(drafted.draft.specimenId, "review-routing");
  assert.equal(drafted.request, null);
  assert.equal(started.state.request.specimenId, "review-routing");
  assert.equal(started.state.request.status, "pending");
  assert.equal(started.state.accepted, null);

  const settled = settlePreview(started.state, started.ticket, "accepted");
  assert.equal(settled.state.request.status, "accepted");
  assert.equal(settled.state.accepted.specimenId, "review-routing");
  assert.equal(settled.state.released, null);

  const released = releaseAccepted(settled.state);
  assert.equal(released.state.released.specimenId, "review-routing");
  assert.equal(released.result.kind, "released");
});

test("a newer generation owns settlement and a late result becomes stale", () => {
  const controller = createReceiverController("participant-intake");
  const first = controller.beginPreview();
  controller.chooseDraft("release-receipt");
  const second = controller.beginPreview();

  const late = controller.settlePreview(first, "accepted");
  assert.deepEqual(late, {
    kind: "stale",
    generation: 1,
    currentGeneration: 2
  });
  assert.equal(controller.getSnapshot().accepted, null);

  const current = controller.settlePreview(second, "accepted");
  assert.equal(current.kind, "accepted");
  assert.equal(controller.getSnapshot().accepted.specimenId, "release-receipt");
});

test("a rejected current request preserves the earlier accepted state", () => {
  const controller = createReceiverController("participant-intake");
  const acceptedTicket = controller.beginPreview();
  controller.settlePreview(acceptedTicket, "accepted");

  controller.chooseDraft("review-routing");
  const rejectedTicket = controller.beginPreview();
  const rejected = controller.settlePreview(rejectedTicket, "rejected");

  assert.equal(rejected.kind, "rejected");
  assert.equal(controller.getSnapshot().accepted.specimenId, "participant-intake");
  assert.equal(controller.getSnapshot().request.status, "rejected");
});

test("release is idempotent for one accepted coordinate", () => {
  const controller = createReceiverController("review-routing");
  const ticket = controller.beginPreview();
  controller.settlePreview(ticket, "accepted");

  const first = controller.release();
  const second = controller.release();

  assert.equal(first.kind, "released");
  assert.equal(second.kind, "replayed");
  assert.equal(second.receiptId, first.receiptId);
  assert.equal(controller.getSnapshot().released.receiptId, first.receiptId);
});

test("a terminal acceptance replay preserves its release receipt", () => {
  const controller = createReceiverController("review-routing");
  const ticket = controller.beginPreview();
  controller.settlePreview(ticket, "accepted");
  const released = controller.release();
  const beforeReplay = controller.getSnapshot();

  const replay = controller.settlePreview(ticket, "accepted");

  assert.deepEqual(replay, {
    kind: "settlement_replayed",
    generation: ticket.generation,
    outcome: "accepted"
  });
  assert.equal(controller.getSnapshot(), beforeReplay);
  assert.equal(controller.getSnapshot().released.receiptId, released.receiptId);
});

test("a terminal rejection keeps authority when a conflicting settlement arrives", () => {
  const controller = createReceiverController("participant-intake");
  const ticket = controller.beginPreview();
  controller.settlePreview(ticket, "rejected");
  const rejectedState = controller.getSnapshot();

  const conflict = controller.settlePreview(ticket, "accepted");

  assert.deepEqual(conflict, {
    kind: "settlement_conflict",
    generation: ticket.generation,
    attemptedOutcome: "accepted",
    settledOutcome: "rejected"
  });
  assert.equal(controller.getSnapshot(), rejectedState);
  assert.equal(controller.getSnapshot().accepted, null);
});

test("the transition inventory owns every controller state change", () => {
  assert.deepEqual(Object.keys(RECEIVER_TRANSITIONS), [
    "chooseDraft",
    "beginPreview",
    "settlePreview",
    "releaseAccepted"
  ]);
  assert.ok(Object.isFrozen(RECEIVER_TRANSITIONS));
  for (const transition of Object.values(RECEIVER_TRANSITIONS)) {
    assert.equal(typeof transition, "function");
  }
});

test("typed admission reports unknown specimen identities and outcomes", () => {
  assert.throws(() => createReceiverState("missing-specimen"), /Unknown specimen ID/);
  const started = beginPreview(createReceiverState());
  assert.throws(
    () => settlePreview(started.state, started.ticket, "eventually"),
    /Unsupported preview outcome/
  );
});

test("subscriber failures preserve the committed state and deliver the full listener snapshot", () => {
  const controller = createReceiverController("participant-intake");
  const deliveries = [];
  controller.subscribe(() => {
    deliveries.push("first");
    throw new Error("caller-owned failure detail");
  });
  controller.subscribe(() => deliveries.push("second"));

  let failure;
  try {
    controller.chooseDraft("review-routing");
  } catch (error) {
    failure = error;
  }

  const committedState = controller.getSnapshot();
  assert.ok(failure instanceof ReceiverNotificationError);
  assert.equal(failure.code, "receiver_notification_failed");
  assert.deepEqual(failure.details, {
    committed: true,
    generation: 0,
    statusKind: "draft_changed",
    listenerFailureCount: 1
  });
  assert.equal(failure.committedState, committedState);
  assert.equal(committedState.draft.specimenId, "review-routing");
  assert.deepEqual(deliveries, ["first", "second"]);
  assert.equal(failure.errors.length, 1);
  assert.equal(failure.errors[0].code, "receiver_listener_notification_failed");
  assert.equal(failure.errors[0].listenerIndex, 0);
  assert.equal(Object.isFrozen(failure), true);
  assert.equal(Object.isFrozen(failure.errors), true);
  assert.equal(String(failure).includes("caller-owned failure detail"), false);
});

test("unsubscribe during emission takes effect after the current listener snapshot", () => {
  const controller = createReceiverController("participant-intake");
  const deliveries = [];
  let unsubscribeSecond;
  controller.subscribe(() => {
    deliveries.push("first");
    unsubscribeSecond();
  });
  unsubscribeSecond = controller.subscribe(() => deliveries.push("second"));

  controller.chooseDraft("review-routing");
  assert.deepEqual(deliveries, ["first", "second"]);

  controller.chooseDraft("release-receipt");
  assert.deepEqual(deliveries, ["first", "second", "first"]);
});

test("subscription admits listener functions before a transition can commit", () => {
  const controller = createReceiverController("participant-intake");

  assert.throws(
    () => controller.subscribe({handle: "change"}),
    /listener function/
  );
  controller.chooseDraft("review-routing");
  assert.equal(controller.getSnapshot().draft.specimenId, "review-routing");
});
