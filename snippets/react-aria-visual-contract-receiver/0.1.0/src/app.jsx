import React, {useEffect, useMemo, useRef, useSyncExternalStore} from "react";
import {
  Button,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Select,
  SelectValue
} from "react-aria-components";
import {useListData} from "react-stately";
import {createReceiverController} from "./controller.mjs";
import {SPECIMENS} from "./model.mjs";

function useReceiver(initialSpecimenId) {
  const controller = useMemo(
    () => createReceiverController(initialSpecimenId),
    [initialSpecimenId]
  );
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
  return {controller, snapshot};
}

function StateReadout({snapshot}) {
  return (
    <dl className="state-readout" aria-label="Receiver state">
      <div>
        <dt>Draft</dt>
        <dd>{snapshot.draft.specimenId}</dd>
      </div>
      <div>
        <dt>Request</dt>
        <dd>{snapshot.request ? `${snapshot.request.generation} · ${snapshot.request.status}` : "Ready"}</dd>
      </div>
      <div>
        <dt>Accepted</dt>
        <dd>{snapshot.accepted?.coordinate ?? "Awaiting preview"}</dd>
      </div>
      <div>
        <dt>Release</dt>
        <dd>{snapshot.released?.receiptId ?? "Awaiting acceptance"}</dd>
      </div>
    </dl>
  );
}

function NativeReceiver({snapshot, onDraftChange, onPreview, onRelease, previewButtonRef}) {
  return (
    <section className="receiver-card" aria-labelledby="native-receiver-title">
      <p className="eyebrow">Native HTML receiver</p>
      <h2 id="native-receiver-title">Browser semantics carry the first route</h2>
      <p id="native-receiver-description">
        The native select keeps its visible label, stable values, and familiar
        keyboard behavior while it receives the same accepted tokens.
      </p>

      <div className="field-stack">
        <label htmlFor="native-specimen">Specimen state</label>
        <span className="select-shell">
          <select
            id="native-specimen"
            value={snapshot.draft.specimenId}
            onChange={(event) => onDraftChange(event.target.value)}
            aria-describedby="native-receiver-description"
          >
            {SPECIMENS.map((specimen) => (
              <option key={specimen.id} value={specimen.id}>
                {specimen.label}
              </option>
            ))}
          </select>
        </span>
      </div>

      <div className="action-row">
        <button ref={previewButtonRef} type="button" onClick={() => onPreview(previewButtonRef)}>
          Request native preview
        </button>
        <button type="button" className="secondary-action" onClick={onRelease}>
          Release accepted state
        </button>
      </div>
    </section>
  );
}

function AriaReceiver({snapshot, collection, onDraftChange, onPreview, onRelease, previewButtonRef}) {
  return (
    <section className="receiver-card" aria-labelledby="aria-receiver-title">
      <p className="eyebrow">React Aria receiver</p>
      <h2 id="aria-receiver-title">Headless behavior receives the same contract</h2>
      <p id="aria-receiver-description">
        React Aria owns interaction semantics and React Stately owns the stable
        collection. The domain controller continues to own acceptance and release.
      </p>

      <Select
        className="field-stack aria-select"
        selectedKey={snapshot.draft.specimenId}
        onSelectionChange={(key) => onDraftChange(String(key))}
        aria-describedby="aria-receiver-description"
      >
        <Label>Specimen state</Label>
        <Button className="select-trigger">
          <SelectValue />
          <span className="select-caret" aria-hidden="true" />
        </Button>
        <Popover className="select-popover">
          <ListBox items={collection.items} className="select-listbox">
            {(specimen) => (
              <ListBoxItem id={specimen.id} textValue={specimen.label} className="select-option">
                <span>{specimen.label}</span>
                <small>{specimen.summary}</small>
              </ListBoxItem>
            )}
          </ListBox>
        </Popover>
      </Select>

      <div className="action-row">
        <Button ref={previewButtonRef} onPress={() => onPreview(previewButtonRef)}>
          Request React Aria preview
        </Button>
        <Button className="secondary-action" onPress={onRelease}>
          Release accepted state
        </Button>
      </div>
    </section>
  );
}

export function App({settlementDelay = 12}) {
  const {controller, snapshot} = useReceiver(SPECIMENS[0].id);
  const collection = useListData({
    initialItems: SPECIMENS,
    getKey: (specimen) => specimen.id
  });
  const pendingPreview = useRef(null);
  const nativePreviewButtonRef = useRef(null);
  const ariaPreviewButtonRef = useRef(null);

  useEffect(() => () => {
    pendingPreview.current?.abort();
    pendingPreview.current = null;
  }, []);

  const requestPreview = (returnFocusRef) => {
    pendingPreview.current?.abort();
    const cancellation = new AbortController();
    pendingPreview.current = cancellation;
    const ticket = controller.beginPreview();
    const timer = globalThis.setTimeout(() => {
      cancellation.signal.removeEventListener("abort", cancelTimer);
      if (pendingPreview.current === cancellation) pendingPreview.current = null;
      if (cancellation.signal.aborted) return;
      const result = controller.settlePreview(ticket, "accepted");
      if (result.kind === "accepted") returnFocusRef.current?.focus();
    }, settlementDelay);
    const cancelTimer = () => globalThis.clearTimeout(timer);
    cancellation.signal.addEventListener("abort", cancelTimer, {once: true});
  };

  return (
    <main className="app-shell">
      <header className="hero">
        <p className="eyebrow">Visual contract receiver · 0.1.0</p>
        <h1>One accepted token coordinate, two semantic control routes</h1>
        <p>
          Compare native HTML with React Aria while one framework-neutral state
          machine protects draft intent, asynchronous acceptance, and repeatable release.
        </p>
        <nav aria-label="Receiver routes">
          <a href="./source/native-receiver.html">Open the script-independent native route</a>
          <a href="./source/semantic-reading.html">Read the semantic companion</a>
        </nav>
      </header>

      <div className="receiver-grid">
        <NativeReceiver
          snapshot={snapshot}
          onDraftChange={controller.chooseDraft}
          onPreview={requestPreview}
          onRelease={controller.release}
          previewButtonRef={nativePreviewButtonRef}
        />
        <AriaReceiver
          snapshot={snapshot}
          collection={collection}
          onDraftChange={controller.chooseDraft}
          onPreview={requestPreview}
          onRelease={controller.release}
          previewButtonRef={ariaPreviewButtonRef}
        />
      </div>

      <section className="operating-state" aria-labelledby="operating-state-title">
        <div>
          <p className="eyebrow">Inspectable operating state</p>
          <h2 id="operating-state-title">Draft, request, acceptance, and release keep separate names</h2>
        </div>
        <StateReadout snapshot={snapshot} />
        <p className="status-line" role="status" aria-live="polite" aria-atomic="true">
          {snapshot.status.message}
        </p>
      </section>
    </main>
  );
}
