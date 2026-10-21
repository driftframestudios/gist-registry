/** Stable collection keys remain product data rather than render positions. */
export const SPECIMENS = Object.freeze([
  Object.freeze({
    id: "participant-intake",
    label: "Participant intake",
    summary: "A short intake flow with a visible owner and review state."
  }),
  Object.freeze({
    id: "review-routing",
    label: "Review routing",
    summary: "A routing decision with explicit authority and recovery context."
  }),
  Object.freeze({
    id: "release-receipt",
    label: "Release receipt",
    summary: "A release record that binds accepted meaning to one coordinate."
  })
]);

const specimensById = new Map(SPECIMENS.map((specimen) => [specimen.id, specimen]));

function assertSpecimenId(specimenId) {
  if (!specimensById.has(specimenId)) {
    throw new TypeError(`Unknown specimen ID: ${String(specimenId)}`);
  }
}

function freezeState(state) {
  return Object.freeze({
    ...state,
    draft: Object.freeze({...state.draft}),
    request: state.request ? Object.freeze({...state.request}) : null,
    accepted: state.accepted ? Object.freeze({...state.accepted}) : null,
    released: state.released ? Object.freeze({...state.released}) : null,
    status: Object.freeze({...state.status})
  });
}

export function createReceiverState(initialSpecimenId = SPECIMENS[0].id) {
  assertSpecimenId(initialSpecimenId);
  return freezeState({
    generation: 0,
    draft: {specimenId: initialSpecimenId},
    request: null,
    accepted: null,
    released: null,
    status: {
      kind: "ready",
      message: "Choose a specimen state, then request a preview."
    }
  });
}

export function chooseDraft(state, specimenId) {
  assertSpecimenId(specimenId);
  if (state.draft.specimenId === specimenId) {
    return state;
  }

  return freezeState({
    ...state,
    draft: {specimenId},
    status: {
      kind: "draft_changed",
      message: `Draft changed to ${labelFor(specimenId)}.`
    }
  });
}

export function beginPreview(state) {
  const generation = state.generation + 1;
  const ticket = Object.freeze({
    generation,
    specimenId: state.draft.specimenId
  });

  return {
    ticket,
    state: freezeState({
      ...state,
      generation,
      request: {
        ...ticket,
        status: "pending"
      },
      status: {
        kind: "pending",
        message: `Preview request ${generation} is evaluating ${labelFor(ticket.specimenId)}.`
      }
    })
  };
}

export function settlePreview(state, ticket, outcome = "accepted") {
  if (
    !state.request ||
    state.request.generation !== ticket.generation ||
    state.request.specimenId !== ticket.specimenId
  ) {
    return {
      state,
      result: Object.freeze({
        kind: "stale",
        generation: ticket.generation,
        currentGeneration: state.generation
      })
    };
  }

  if (outcome !== "accepted" && outcome !== "rejected") {
    throw new TypeError(`Unsupported preview outcome: ${String(outcome)}`);
  }

  if (state.request.status !== "pending") {
    const settledOutcome = state.request.status;
    if (settledOutcome === outcome) {
      return {
        state,
        result: Object.freeze({
          kind: "settlement_replayed",
          generation: ticket.generation,
          outcome
        })
      };
    }

    return {
      state,
      result: Object.freeze({
        kind: "settlement_conflict",
        generation: ticket.generation,
        attemptedOutcome: outcome,
        settledOutcome
      })
    };
  }

  if (outcome === "rejected") {
    const nextState = freezeState({
      ...state,
      request: {...state.request, status: "rejected"},
      status: {
        kind: "rejected",
        message: `Preview request ${ticket.generation} needs revision. The earlier accepted state remains available.`
      }
    });
    return {
      state: nextState,
      result: Object.freeze({kind: "rejected", generation: ticket.generation})
    };
  }

  const accepted = {
    specimenId: ticket.specimenId,
    generation: ticket.generation,
    coordinate: `receiver:${ticket.generation}:${ticket.specimenId}`
  };
  const nextState = freezeState({
    ...state,
    request: {...state.request, status: "accepted"},
    accepted,
    released: null,
    status: {
      kind: "accepted",
      message: `Preview request ${ticket.generation} accepted ${labelFor(ticket.specimenId)}.`
    }
  });

  return {
    state: nextState,
    result: Object.freeze({kind: "accepted", ...accepted})
  };
}

export function releaseAccepted(state) {
  if (!state.accepted) {
    return {
      state: freezeState({
        ...state,
        status: {
          kind: "release_waiting",
          message: "Release becomes available after a preview reaches accepted state."
        }
      }),
      result: Object.freeze({kind: "waiting_for_acceptance"})
    };
  }

  const receiptId = `release:${state.accepted.generation}:${state.accepted.specimenId}`;
  if (state.released?.receiptId === receiptId) {
    return {
      state,
      result: Object.freeze({kind: "replayed", ...state.released})
    };
  }

  const released = {
    receiptId,
    acceptedCoordinate: state.accepted.coordinate,
    specimenId: state.accepted.specimenId,
    generation: state.accepted.generation
  };
  const nextState = freezeState({
    ...state,
    released,
    status: {
      kind: "released",
      message: `${labelFor(state.accepted.specimenId)} released with receipt ${receiptId}.`
    }
  });

  return {
    state: nextState,
    result: Object.freeze({kind: "released", ...released})
  };
}

export function labelFor(specimenId) {
  assertSpecimenId(specimenId);
  return specimensById.get(specimenId).label;
}

/** The controller routes every state-changing domain operation through this inventory. */
export const RECEIVER_TRANSITIONS = Object.freeze({
  chooseDraft,
  beginPreview,
  settlePreview,
  releaseAccepted
});
