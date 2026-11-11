import type { OutputCompilationProgress } from '../../io/gcode/prepare-output-async';
import { Button, Dialog, DialogActions } from '../kit';
import { CncSetupDocumentExport } from './CncSetupDocumentExport';
import { GCODE_SAVE_REFUSED } from './export-refusal';
import { useGcodeSaveFlowStore, type GcodeSaveFlow } from './gcode-save-flow';

type VisibleFlow = Exclude<GcodeSaveFlow, { readonly kind: 'working' }>;

/** The Save G-code dialog, shown only when the save needs it: a slow
 * preparation, a CNC export's choices, a fresh click for the file dialog, or a
 * refusal (gcode-save-flow.ts, ADR-656 Amendment 4). */
export function GcodeSaveDialog(): JSX.Element | null {
  const flow = useGcodeSaveFlowStore((state) => state.flow);
  if (flow === null || flow.kind === 'working') return null;
  if (flow.kind === 'refused') return <RefusedSave reasons={flow.reasons} onClose={flow.close} />;
  const close = closeAction(flow);
  return (
    <Dialog title="Save G-code" onClose={close ?? (() => undefined)} size="sm">
      <div className="lf-dialog-body" aria-live="polite">
        <p>{flowMessage(flow)}</p>
        {flow.kind === 'preparing' ? <PreparationProgress progress={flow.progress} /> : null}
        {flow.kind === 'ready' ? (
          <CncSetupDocumentExport artifact={flow.artifact} ctx={flow.ctx} onSaved={flow.close} />
        ) : null}
      </div>
      <DialogActions>
        <Button disabled={close === null} {...(close === null ? {} : { onClick: close })}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={flow.kind !== 'ready'}
          {...(flow.kind === 'ready' ? { onClick: flow.save } : {})}
        >
          Save as…
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// Once the file dialog is open its answer stands (ADR-656 decision 3).
function closeAction(flow: VisibleFlow): (() => void) | null {
  if (flow.kind === 'preparing') return flow.cancel;
  if (flow.kind === 'ready' || flow.kind === 'refused') return flow.close;
  return null;
}

/** One refusal, one dismissal: the reasons and a single Close. */
function RefusedSave(props: {
  readonly reasons: ReadonlyArray<string>;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <Dialog title="Save G-code" onClose={props.onClose} size="sm">
      <div className="lf-dialog-body" role="alert">
        <p>{GCODE_SAVE_REFUSED}:</p>
        <ul>
          {props.reasons.map((reason, index) => (
            <li key={`${index}-${reason}`}>{reason}</li>
          ))}
        </ul>
        <p>No file was created or changed.</p>
      </div>
      <DialogActions>
        <Button variant="primary" onClick={props.onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function PreparationProgress(props: {
  readonly progress: OutputCompilationProgress | null;
}): JSX.Element | null {
  const progress = props.progress;
  if (progress === null) return null;
  const label = preparationPhase(progress.phase);
  if (progress.total === 0) return <p>{label}…</p>;
  return (
    <p>
      <progress
        aria-label="G-code preparation progress"
        max={progress.total}
        value={progress.completed}
      />{' '}
      {label}: {progress.completed} of {progress.total}
    </p>
  );
}

function preparationPhase(phase: OutputCompilationProgress['phase']): string {
  switch (phase) {
    case 'normalizing':
      return 'Reading the operations';
    case 'planning':
      return 'Planning toolpaths';
    case 'merging':
      return 'Putting the toolpaths in order';
    case 'finalizing':
      return 'Writing the G-code';
  }
}

function flowMessage(flow: Exclude<VisibleFlow, { readonly kind: 'refused' }>): string {
  switch (flow.kind) {
    case 'preparing':
      return 'Preparing your G-code file…';
    case 'ready':
      return 'The complete export is ready. Choose a filename and folder, such as Downloads or Desktop. You can create a new file.';
    case 'choosing':
      return 'Choose a destination in the file dialog.';
  }
}
