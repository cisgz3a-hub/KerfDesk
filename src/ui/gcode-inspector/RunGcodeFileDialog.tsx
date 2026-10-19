// RunGcodeFileDialog — Frame, review and Start for a G-code file opened in the
// Inspector (ADR-630, WORKFLOW.md F-M2). Frame is the only gate; findings are
// warnings. Refusals are only what the controller cannot take as a job.

import { useMemo, useState } from 'react';
import { reviewExternalProgram, type ExternalProgram } from '../../core/external-program';
import { machineKindOf } from '../../core/scene';
import { Button, Dialog, DialogActions } from '../kit';
import { useStore } from '../state';
import { deviceInspectionContext } from './gcode-inspection-source';
import { hasGcodeInspectorAnalysis } from './gcode-inspector-worker-protocol';
import { useGcodeInspection } from './use-gcode-inspection';
import { prepareExternalRun } from './prepare-external-run';
import { RunGcodeFileControls } from './RunGcodeFileControls';
import { useLiveRunStart, useNormalizedProgram, type RunStart } from './use-external-program';
import './run-gcode-file.css';

export type RunGcodeFileDialogProps = {
  readonly name: string;
  readonly text: string;
  readonly onClose: () => void;
  /** The job is streaming; the caller closes the Inspector too. */
  readonly onStarted: () => void;
};

const DRAWN_ORIGIN: RunStart = { x: 0, y: 0, z: 0 };

export function RunGcodeFileDialog(props: RunGcodeFileDialogProps): JSX.Element {
  const normalized = useNormalizedProgram(props.text);
  return (
    <Dialog title={`Run ${props.name}`} size="md" onClose={props.onClose}>
      {normalized === null ? (
        <Preparing onClose={props.onClose} />
      ) : normalized.kind === 'refused' ? (
        <RefusedRun reasons={normalized.reasons} onClose={props.onClose} />
      ) : (
        <InspectExternalRun {...props} program={normalized.program} />
      )}
    </Dialog>
  );
}

// The exact sendable bytes are parsed and timed again through the existing
// cancellable worker, from where the head stands: the first move, relative
// moves and arcs start there. While framing, and while that Frame holds, the
// start is pinned so the head's passing positions do not re-read the program.
function InspectExternalRun(
  props: RunGcodeFileDialogProps & { readonly program: ExternalProgram },
): JSX.Element {
  const project = useStore((state) => state.project);
  const live = useLiveRunStart();
  const [pinned, setPinned] = useState<RunStart | null>(null);
  const start = pinned ?? live;
  const source = useMemo(
    () => ({
      ...deviceInspectionContext(project.device, machineKindOf(project.machine)),
      kind: 'text' as const,
      text: props.program.gcode,
      ...(start === null ? {} : { initialPositionMm: start }),
    }),
    [props.program, project.device, project.machine, start],
  );
  const inspection = useGcodeInspection(source);
  if (inspection.kind === 'error')
    return <RefusedRun reasons={[inspection.reason]} onClose={props.onClose} />;
  if (inspection.kind !== 'ready' || inspection.source !== source)
    return <Preparing onClose={props.onClose} />;
  const result = inspection.result;
  if (!hasGcodeInspectorAnalysis(result))
    return <RefusedRun reasons={[result.parsed.reason]} onClose={props.onClose} />;
  const prepared = prepareExternalRun(props.name, props.program, start ?? DRAWN_ORIGIN, (gcode) =>
    reviewExternalProgram(
      gcode,
      result.parsed.model,
      {
        machineKind: machineKindOf(project.machine),
        laserMaxPowerS: project.device.maxPowerS,
      },
      result.analysis.findings,
    ),
  );
  return prepared.kind === 'refused' ? (
    <RefusedRun reasons={prepared.reasons} onClose={props.onClose} />
  ) : (
    <RunGcodeFileControls
      prepared={prepared}
      analysis={result.analysis}
      start={start}
      onPin={setPinned}
      onClose={props.onClose}
      onStarted={props.onStarted}
    />
  );
}

function Preparing(props: { readonly onClose: () => void }): JSX.Element {
  return (
    <>
      <p role="status">Preparing the exact program to send…</p>
      <DialogActions>
        <Button type="button" onClick={props.onClose}>
          Close
        </Button>
      </DialogActions>
    </>
  );
}

function RefusedRun(props: {
  readonly reasons: ReadonlyArray<string>;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <>
      <p role="alert">KerfDesk cannot send this file as a job:</p>
      <ul>
        {props.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
      <DialogActions>
        <Button type="button" onClick={props.onClose}>
          Close
        </Button>
      </DialogActions>
    </>
  );
}
