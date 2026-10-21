import {
  beginPreview,
  chooseDraft,
  createReceiverState,
  releaseAccepted,
  settlePreview
} from "./model.mjs";

/**
 * A framework-neutral owner for the receiver state machine.
 * React subscribes to it; model tests call it directly.
 */
export function createReceiverController(initialSpecimenId) {
  let state = createReceiverState(initialSpecimenId);
  const listeners = new Set();

  const emit = () => {
    for (const listener of listeners) listener();
  };

  const replace = (nextState) => {
    if (nextState === state) return;
    state = nextState;
    emit();
  };

  return Object.freeze({
    getSnapshot() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    chooseDraft(specimenId) {
      replace(chooseDraft(state, specimenId));
      return state;
    },
    beginPreview() {
      const transition = beginPreview(state);
      replace(transition.state);
      return transition.ticket;
    },
    settlePreview(ticket, outcome) {
      const transition = settlePreview(state, ticket, outcome);
      replace(transition.state);
      return transition.result;
    },
    release() {
      const transition = releaseAccepted(state);
      replace(transition.state);
      return transition.result;
    }
  });
}
