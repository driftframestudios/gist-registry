import assert from "node:assert/strict";
import test from "node:test";
import {createReceiverController} from "../src/controller.mjs";
import {
  beginPreview,
  chooseDraft,
  createReceiverState,
  releaseAccepted,
  settlePreview
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

test("typed admission reports unknown specimen identities and outcomes", () => {
  assert.throws(() => createReceiverState("missing-specimen"), /Unknown specimen ID/);
  const started = beginPreview(createReceiverState());
  assert.throws(
    () => settlePreview(started.state, started.ticket, "eventually"),
    /Unsupported preview outcome/
  );
});
