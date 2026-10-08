import { useEffect, useRef, useState } from 'react';
import { machineKindOf } from '../../core/scene';
import { createBlankReliefAuthoringDocument } from '../../core/relief/relief-authoring-document';
import { Dialog } from '../kit';
import { useStore } from '../state';
import { NumberControl } from './ReliefComponentControls';
import { composeReliefInWorker } from './relief-authoring-worker-client';

export function CreateEditableReliefButton(): JSX.Element | null {
  const cnc = useStore((s) => machineKindOf(s.project.machine) === 'cnc');
  const [open, setOpen] = useState(false);
  if (!cnc) return null;
  return (
    <>
      <button
        title="Choose physical dimensions for a new editable scalar relief"
        type="button"
        onClick={() => setOpen(true)}
      >
        Create editable relief…
      </button>
      {open ? <CreateReliefDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function CreateReliefDialog(props: { readonly onClose: () => void }): JSX.Element {
  const [widthMm, setWidthMm] = useState(100);
  const [heightMm, setHeightMm] = useState(100);
  const [depthMm, setDepthMm] = useState(5);
  const [grid, setGrid] = useState(256);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const epoch = useStore((s) => s.projectDocumentEpoch);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function create(): Promise<void> {
    const document = createBlankReliefAuthoringDocument({
      width: grid,
      height: grid,
      physicalWidthMm: widthMm,
      physicalHeightMm: heightMm,
      maxDepthMm: depthMm,
    });
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setBusy(true);
    setError('');
    const result = await composeReliefInWorker(document, controller.signal);
    if (controller.signal.aborted) return;
    setBusy(false);
    if (result.kind !== 'ok') {
      if (result.kind === 'error') setError(result.reason);
      return;
    }
    const state = useStore.getState();
    if (state.projectDocumentEpoch !== epoch || machineKindOf(state.project.machine) !== 'cnc') {
      setError(
        'The project changed during preparation. Create the relief in the current CNC project.',
      );
      return;
    }
    if (state.addEditableRelief(result.field, document)) props.onClose();
  }
  return (
    <Dialog title="Create editable relief" size="md" onClose={props.onClose}>
      <fieldset disabled={busy}>
        <legend>One-sided relief dimensions</legend>
        <NumberControl label="Relief width (mm)" value={widthMm} commit={setWidthMm} />
        <NumberControl label="Relief height (mm)" value={heightMm} commit={setHeightMm} />
        <NumberControl label="Maximum relief depth (mm)" value={depthMm} commit={setDepthMm} />
        <NumberControl label="Authoring grid size (cells per side)" value={grid} commit={setGrid} />
        <p>
          Grid cells: {widthMm / grid} × {heightMm / grid} mm. Authoring is limited to 1,048,576
          cells. CAM sampling is configured separately.
        </p>
        <p>
          The initial plane is at the relief floor. Select this relief, open Edit relief components
          and add shapes from closed vectors.
        </p>
        <button
          title="Create and select an editable relief with the chosen dimensions"
          type="button"
          onClick={() => {
            void create();
          }}
        >
          Create relief
        </button>
      </fieldset>
      {busy ? <p role="status">Creating relief…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <button title="Close without creating a relief" type="button" onClick={props.onClose}>
        Cancel
      </button>
    </Dialog>
  );
}
