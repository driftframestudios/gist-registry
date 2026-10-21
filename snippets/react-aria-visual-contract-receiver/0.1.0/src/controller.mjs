import {
  createReceiverState,
  RECEIVER_TRANSITIONS
} from "./model.mjs";

const {
  beginPreview,
  chooseDraft,
  releaseAccepted,
  settlePreview
} = RECEIVER_TRANSITIONS;

class ReceiverListenerNotificationError extends Error {
  constructor(listenerIndex) {
    super("A receiver subscriber requires notification recovery.");
    this.name = "ReceiverListenerNotificationError";
    this.code = "receiver_listener_notification_failed";
    this.listenerIndex = listenerIndex;
    Object.freeze(this);
  }
}

/**
 * Reports notification failures after the next domain state has committed.
 * Caller-thrown values stay outside the aggregate; owned summaries identify
 * affected listener positions without carrying private failure material.
 */
export class ReceiverNotificationError extends AggregateError {
  constructor(listenerIndexes, committedState) {
    const failures = listenerIndexes.map(
      (listenerIndex) => new ReceiverListenerNotificationError(listenerIndex)
    );
    super(
      failures,
      "The receiver state transition committed; subscriber notification requires recovery."
    );
    this.name = "ReceiverNotificationError";
    this.code = "receiver_notification_failed";
    this.committedState = committedState;
    this.details = Object.freeze({
      committed: true,
      generation: committedState.generation,
      statusKind: committedState.status.kind,
      listenerFailureCount: failures.length
    });
    Object.freeze(this.errors);
    Object.freeze(this);
  }
}

/**
 * A framework-neutral owner for the receiver state machine.
 * React subscribes to it; model tests call it directly.
 */
export function createReceiverController(initialSpecimenId) {
  let state = createReceiverState(initialSpecimenId);
  const listeners = new Set();

  const emit = () => {
    // Every subscriber present at commit time receives one delivery attempt.
    // Subscription changes made by a callback apply to the next transition.
    const notificationSnapshot = [...listeners];
    const failedListenerIndexes = [];
    for (const [listenerIndex, listener] of notificationSnapshot.entries()) {
      try {
        listener();
      } catch {
        failedListenerIndexes.push(listenerIndex);
      }
    }
    if (failedListenerIndexes.length > 0) {
      throw new ReceiverNotificationError(failedListenerIndexes, state);
    }
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
      if (typeof listener !== "function") {
        throw new TypeError("Receiver subscription requires a listener function.");
      }
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
