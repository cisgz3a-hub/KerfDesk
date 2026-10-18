// RunGcodeFileDialog — Frame, review and Start for a G-code file opened in the
// Inspector (ADR-630, WORKFLOW.md F-M2). Frame is the only gate; findings are
// warnings. Refusals are only what the controller cannot take as a job.

import { useMemo, useState } from 'react';
import {
  normalizeExternalProgram,
  reviewExternalProgram,
  type ExternalProgram,
} from '../../core/external-program';
import { formatDuration } from '../../core/job/format-duration';
import { machineKindOf } from '../../core/scene';
import { formatLengthWithUnit } from '../display-length';
import { Button, Dialog, DialogActions } from '../kit';
import { useStore } from '../state';
import { useLengthUnit } from '../state/display-units';
import { useLaserStore } from '../state/laser-store';
import { jogFrameCommandBlockMessage } from '../state/laser-store-helpers';
import {
  externalStartIssue,
  frameExternalProgram,
  startExternalProgram,
  type ExternalFrame,
} from './external-run';
import type { GcodeInspectorAnalysis } from './gcode-inspector-analysis';
import { deviceInspectionContext } from './gcode-inspection-source';
import { hasGcodeInspectorAnalysis } from './gcode-inspector-worker-protocol';
import { useGcodeInspection } from './use-gcode-inspection';
import { prepareExternalRun, type PreparedExternalRun } from './prepare-external-run';
import { RunGcodeFileSummary } from './RunGcodeFileSummary';
import './run-gcode-file.css';

export type RunGcodeFileDialogProps = {
  readonly name: string;
  readonly text: string;
  readonly onClose: () => void;
  /** The job is streaming; the caller closes the Inspector too. */
  readonly onStarted: () => void;
};

export function RunGcodeFileDialog(props: RunGcodeFileDialogProps): JSX.Element {
  const normalized = useMemo(() => normalizeExternalProgram(props.text), [props.text]);
  return (
    <Dialog title={`Run ${props.name}`} size="md" onClose={props.onClose}>
      {normalized.kind === 'refused' ? (
        <RefusedRun reasons={normalized.reasons} onClose={props.onClose} />
      ) : (
        <InspectExternalRun {...props} program={normalized.program} />
      )}
    </Dialog>
  );
}

// Normalization can join numeric fragments across a comment. Parse and time
// precisely those sendable bytes through the existing cancellable worker;
// the original file's Inspector model cannot authorize this executable.
function InspectExternalRun(
  props: RunGcodeFileDialogProps & { readonly program: ExternalProgram },
): JSX.Element {
  const project = useStore((state) => state.project);
  const source = useMemo(
    () => ({
      ...deviceInspectionContext(project.device, machineKindOf(project.machine)),
      kind: 'text' as const,
      text: props.program.gcode,
    }),
    [props.program, project.device, project.machine],
  );
  const inspection = useGcodeInspection(source);
  if (inspection.kind === 'error')
    return <RefusedRun reasons={[inspection.reason]} onClose={props.onClose} />;
  if (inspection.kind !== 'ready' || inspection.source !== source)
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
  const result = inspection.result;
  if (!hasGcodeInspectorAnalysis(result))
    return <RefusedRun reasons={[result.parsed.reason]} onClose={props.onClose} />;
  const prepared = prepareExternalRun(props.name, props.program, (gcode) =>
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
    <RunControls {...props} prepared={prepared} analysis={result.analysis} />
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

// Frame and Start, one at a time, keeping the last error to show.
function useExternalRunActions(
  prepared: Extract<PreparedExternalRun, { readonly kind: 'ready' }>,
  onStarted: () => void,
) {
  const [frame, setFrame] = useState<ExternalFrame | null>(null);
  const [busy, setBusy] = useState<'framing' | 'starting' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const attempt = async (kind: 'framing' | 'starting', work: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await work();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  };
  const runFrame = (): Promise<void> =>
    attempt('framing', async () => {
      const framed = await frameExternalProgram(prepared.run);
      setFrame(framed);
      if (framed === null)
        setError('The Frame did not run or did not finish cleanly, so Start stays locked.');
    });
  const runStart = (): Promise<void> =>
    attempt('starting', async () => {
      if (frame !== null && (await startExternalProgram(frame))) onStarted();
    });
  return { frame, busy, error, runFrame, runStart };
}

function RunControls(
  props: RunGcodeFileDialogProps & {
    readonly prepared: Extract<PreparedExternalRun, { readonly kind: 'ready' }>;
    readonly analysis: GcodeInspectorAnalysis;
  },
): JSX.Element {
  const { prepared } = props;
  const unit = useLengthUnit();
  const project = useStore((state) => state.project);
  const laser = useLaserStore((state) => state);
  const { frame, busy, error, runFrame, runStart } = useExternalRunActions(
    prepared,
    props.onStarted,
  );
  const connected = laser.connection.kind === 'connected';
  const frameBlock = connected
    ? jogFrameCommandBlockMessage(laser)
    : 'Connect to the machine first.';
  const startIssue = externalStartIssue(frame, laser, project);
  const status =
    busy === 'framing'
      ? 'Framing… the head traces the program outline with the tool off.'
      : (startIssue ?? 'Ready to start: the framed program and placement are unchanged.');
  return (
    <>
      <RunGcodeFileSummary
        prepared={prepared}
        analysis={props.analysis}
        machineKind={machineKindOf(project.machine)}
        formatLength={(mm) => formatLengthWithUnit(mm, unit)}
        formatSeconds={formatDuration}
      />
      <p className="lf-muted" role="status" aria-live="polite">
        {status}
      </p>
      {error === null ? null : (
        <p className="lf-run-gcode-error" role="alert">
          {error}
        </p>
      )}
      <DialogActions>
        <Button type="button" onClick={props.onClose}>
          Close
        </Button>
        <Button
          type="button"
          disabled={busy !== null || frameBlock !== null}
          title={frameBlock ?? 'Trace the program outline over the material with the tool off.'}
          onClick={() => void runFrame()}
        >
          Frame
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={busy !== null || startIssue !== null}
          title={startIssue ?? 'Send this program to the machine.'}
          onClick={() => void runStart()}
        >
          Start
        </Button>
      </DialogActions>
    </>
  );
}
