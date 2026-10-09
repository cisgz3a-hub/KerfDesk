import { useEffect, useRef, useState } from 'react';
import { machineKindOf } from '../../core/scene';
import type { HeightfieldReliefObject } from '../../core/scene/scene-object';
import type { ReliefAuthoringDocument } from '../../core/scene/relief/relief-authoring';
import {
  createBlankReliefAuthoringDocument,
  createReliefAuthoringDocument,
} from '../../core/relief/relief-authoring-document';
import { Dialog, DialogActions, Button } from '../kit';
import { requestProFeature } from '../licensing/edition';
import { useStore } from '../state';
import { composeReliefInWorker } from './relief-authoring-worker-client';
import { ReliefAuthoringDialog } from './ReliefAuthoringDialog';
import './relief-authoring.css';

export function CreateEditableReliefButton(): JSX.Element | null {
  const cnc = useStore((s) => machineKindOf(s.project.machine) === 'cnc');
  const [open, setOpen] = useState(false);
  if (!cnc) return null;
  return (
    <>
      <button
        title="Choose physical dimensions, then sculpt or add vector relief shapes"
        type="button"
        onClick={() => requestProFeature('relief', () => setOpen(true))}
      >
        Create editable relief…
      </button>
      {open ? <CreateEditableReliefWorkflow onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** The stable application host owns this workflow after its menu closes. */
export function CreateEditableReliefWorkflow(props: {
  readonly onClose: () => void;
}): JSX.Element | null {
  const { onClose } = props;
  const epoch = useStore((s) => s.projectDocumentEpoch);
  const [editor, setEditor] = useState<{ readonly id: string; readonly epoch: number } | null>(
    null,
  );
  const relief = useStore((s) => {
    if (editor === null || editor.epoch !== s.projectDocumentEpoch) return null;
    const object = s.project.scene.objects.find((item) => item.id === editor.id);
    return object?.kind === 'relief' && object.reliefSource.kind === 'heightfield-v1'
      ? (object as HeightfieldReliefObject)
      : null;
  });
  useEffect(() => {
    if (editor !== null && relief === null) onClose();
  }, [editor, relief, onClose]);
  if (editor === null)
    return <CreateReliefDialog onClose={onClose} onCreated={(id) => setEditor({ id, epoch })} />;
  return relief === null ? null : <ReliefAuthoringDialog relief={relief} onClose={onClose} />;
}
type CreateReliefProps = { readonly onClose: () => void; readonly onCreated: (id: string) => void };
function CreateReliefDialog(props: CreateReliefProps): JSX.Element {
  const [widthMm, setWidthMm] = useState('100');
  const [heightMm, setHeightMm] = useState('100');
  const [depthMm, setDepthMm] = useState('5');
  const [grid, setGrid] = useState(256);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const epoch = useStore((s) => s.projectDocumentEpoch);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const dimensions = [Number(widthMm), Number(heightMm), Number(depthMm)];
  const valid = dimensions.every((value) => Number.isFinite(value) && value > 0);
  async function create(): Promise<void> {
    if (!valid || busy) return;
    const document = createBlankReliefAuthoringDocument({
      width: grid,
      height: grid,
      physicalWidthMm: Number(widthMm),
      physicalHeightMm: Number(heightMm),
      maxDepthMm: Number(depthMm),
    });
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setBusy(true);
    setError('');
    const result = await prepareNewRelief(document, epoch, controller.signal);
    if (controller.signal.aborted || result.kind === 'cancelled') return;
    setBusy(false);
    if (result.kind === 'error') {
      setError(result.reason);
      return;
    }
    props.onCreated(result.id);
  }
  return (
    <Dialog
      title="Create editable relief"
      size="md"
      panelClassName="lf-relief-create-dialog"
      onClose={props.onClose}
    >
      <p>
        Choose the carving area and depth. The editor opens with a base plane ready to sculpt or
        combine with closed vector shapes.
      </p>
      <ReliefCreationDimensions
        busy={busy}
        valid={valid}
        widthMm={widthMm}
        heightMm={heightMm}
        depthMm={depthMm}
        grid={grid}
        setWidthMm={setWidthMm}
        setHeightMm={setHeightMm}
        setDepthMm={setDepthMm}
        setGrid={setGrid}
      />
      {busy ? <p role="status">Creating relief…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <DialogActions>
        <Button title="Close without creating a relief" onClick={props.onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          title="Create a relief and open its component editor"
          disabled={!valid || busy}
          onClick={() => {
            void create();
          }}
        >
          Create relief
        </Button>
      </DialogActions>
    </Dialog>
  );
}
function DimensionInput(props: {
  readonly label: string;
  readonly value: string;
  readonly setValue: (value: string) => void;
}): JSX.Element {
  return (
    <label>
      {props.label}
      <input
        title={props.label}
        aria-label={props.label}
        type="number"
        min="0"
        step="any"
        value={props.value}
        onChange={(event) => props.setValue(event.currentTarget.value)}
      />
    </label>
  );
}

type NewReliefResult =
  | { readonly kind: 'ok'; readonly id: string }
  | { readonly kind: 'error'; readonly reason: string }
  | { readonly kind: 'cancelled' };
async function prepareNewRelief(
  document: ReliefAuthoringDocument,
  epoch: number,
  signal: AbortSignal,
): Promise<NewReliefResult> {
  const result = await composeReliefInWorker(document, signal);
  if (signal.aborted || result.kind === 'cancelled') return { kind: 'cancelled' };
  if (result.kind === 'error') return result;
  const state = useStore.getState();
  if (state.projectDocumentEpoch !== epoch || machineKindOf(state.project.machine) !== 'cnc')
    return {
      kind: 'error',
      reason:
        'The project changed during preparation. Create the relief in the current CNC project.',
    };
  // Retain the exact composed floor field as a component that can be sculpted.
  const retained = createReliefAuthoringDocument(result.field);
  const editable = {
    ...retained,
    components: retained.components.map((component) => ({ ...component, name: 'Sculpting base' })),
  };
  if (!state.addEditableRelief(result.field, editable))
    return { kind: 'error', reason: 'The relief could not be added. The project was kept.' };
  const id = useStore.getState().selectedObjectId;
  return id === null
    ? { kind: 'error', reason: 'The new relief could not be selected.' }
    : { kind: 'ok', id };
}

type DimensionProps = {
  readonly busy: boolean;
  readonly valid: boolean;
  readonly widthMm: string;
  readonly heightMm: string;
  readonly depthMm: string;
  readonly grid: number;
  readonly setWidthMm: (value: string) => void;
  readonly setHeightMm: (value: string) => void;
  readonly setDepthMm: (value: string) => void;
  readonly setGrid: (value: number) => void;
};
function ReliefCreationDimensions(props: DimensionProps): JSX.Element {
  return (
    <fieldset disabled={props.busy}>
      <legend>Relief dimensions</legend>
      <div className="lf-relief-dimensions">
        <DimensionInput
          label="Relief width (mm)"
          value={props.widthMm}
          setValue={props.setWidthMm}
        />
        <DimensionInput
          label="Relief height (mm)"
          value={props.heightMm}
          setValue={props.setHeightMm}
        />
        <DimensionInput
          label="Maximum relief depth (mm)"
          value={props.depthMm}
          setValue={props.setDepthMm}
        />
      </div>
      <label>
        Detail grid
        <select
          aria-label="Authoring grid size (cells per side)"
          title="Choose the retained relief detail resolution"
          value={props.grid}
          onChange={(event) => props.setGrid(Number(event.currentTarget.value))}
        >
          {[128, 256, 512, 1024].map((size) => (
            <option key={size} value={size}>
              {size} × {size} cells
            </option>
          ))}
        </select>
      </label>
      {props.valid ? (
        <p className="lf-relief-note">
          Cell size: {(Number(props.widthMm) / props.grid).toPrecision(4)} ×{' '}
          {(Number(props.heightMm) / props.grid).toPrecision(4)} mm. CAM sampling is configured
          separately.
        </p>
      ) : (
        <p role="alert">Width, height and depth must be positive numbers.</p>
      )}
      <p className="lf-relief-note">
        The base begins at the relief floor. Brush strokes raise it towards the stock top. This is a
        one-sided height surface.
      </p>
    </fieldset>
  );
}
