// RunGcodeFileControls — the Run dialog's review, Frame and Start (ADR-630).
// Frame is the only gate. The refusals here are factual: no reported head
// position to read the program from, or a line the connected controller
// cannot take, which Start would refuse anyway, so it is said before Frame.

import { useEffect, useMemo, useState } from 'react';
import { streamingModeForController } from '../../core/devices';
import { findLitRapids } from '../../core/external-program';
import { formatDuration } from '../../core/job/format-duration';
import { machineKindOf } from '../../core/scene';
import { formatLengthWithUnit } from '../display-length';
import { Button, DialogActions } from '../kit';
import { useStore } from '../state';
import { useLengthUnit } from '../state/display-units';
import { useLaserStore, type LaserState } from '../state/laser-store';
import { assertGcodeFitsController } from '../state/laser-start-program-assertions';
import {
  externalRunMachineBlock,
  externalStartIssue,
  frameExternalProgram,
  startExternalProgram,
  type ExternalFrame,
} from './external-run';
import { externalOutlineBedWarnings } from './external-run-bed';
import { externalZTopWarnings } from './external-run-z-top';
import { externalControllerWarnings } from './external-run-readiness';
import type { GcodeInspectorAnalysis } from './gcode-inspector-analysis';
import type { PreparedExternalRun } from './prepare-external-run';
import { RunGcodeFileSummary } from './RunGcodeFileSummary';
import type { RunStart } from './use-external-program';

type ReadyRun = Extract<PreparedExternalRun, { readonly kind: 'ready' }>;

export const CLOSE_WHILE_STARTING =
  'Start is preparing the controller. Close is available once the job starts or Start stops; ABORT JOB stays on the Live Motion bar.';

export const WAITING_FOR_POSITION =
  'Waiting for the connected machine to report where the head is, which the program is read from.';

// Frame and Start, one at a time, keeping the last error to show. The start
// position is held while framing and while the Frame stays valid, so the
// review is not read again from the head's passing positions. The Frame
// record lives with the dialog: a CNC Frame that leaves the bit retracted
// pins the start it left, and the review is read again from there.
function useExternalRunActions(
  prepared: ReadyRun,
  frameState: FrameState,
  onPin: (start: RunStart | null) => void,
  onStarted: () => void,
  onArming: (arming: boolean) => void,
) {
  const { frame, onFramed: setFrame } = frameState;
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
      onPin(prepared.run.start);
      const framed = await frameExternalProgram(prepared.run).catch((caught: unknown) => {
        onPin(null);
        throw caught;
      });
      setFrame(framed);
      if (framed === null) {
        onPin(null);
        setError('The Frame did not run or did not finish cleanly, so Start stays locked.');
      } else if (framed.run.start !== prepared.run.start) {
        onPin(framed.run.start);
      }
    });
  // Closing the dialog cannot cancel a Start that is arming, so the dialog
  // stays until it streams or stops. The lock follows the Start itself, not
  // this component, which a re-read of the review can replace meanwhile.
  const runStart = (): Promise<void> =>
    attempt('starting', async () => {
      if (frame === null) return;
      onArming(true);
      try {
        if (await startExternalProgram(frame)) onStarted();
      } finally {
        onArming(false);
      }
    });
  return { frame, busy, error, runFrame, runStart };
}

function useControllerFitIssue(gcode: string): string | null {
  const project = useStore((state) => state.project);
  const controllerKind = useLaserStore((state) => state.activeControllerKind);
  const { controllerKind: deviceKind, streamingMode, rxBufferBytes } = project.device;
  return useMemo(() => {
    try {
      assertGcodeFitsController(
        gcode,
        { streamingMode: streamingModeForController(deviceKind, streamingMode), rxBufferBytes },
        controllerKind,
      );
      return null;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      return message.replace(/ Job not started\.$/, '');
    }
  }, [gcode, controllerKind, deviceKind, streamingMode, rxBufferBytes]);
}

/** Why Frame is unavailable now, or null when it can run. */
function frameBlockReason(
  laser: LaserState,
  fitIssue: string | null,
  start: RunStart | null,
): string | null {
  return (
    externalRunMachineBlock(laser) ?? fitIssue ?? (start === null ? WAITING_FOR_POSITION : null)
  );
}

/** The dialog's Frame record, kept while the review is read again. */
export type FrameState = {
  readonly frame: ExternalFrame | null;
  readonly onFramed: (frame: ExternalFrame | null) => void;
};

export function RunGcodeFileControls(props: {
  readonly prepared: ReadyRun;
  readonly frameState: FrameState;
  readonly analysis: GcodeInspectorAnalysis;
  /** Null until the connected machine reports where the head stands. */
  readonly start: RunStart | null;
  readonly onPin: (start: RunStart | null) => void;
  readonly onClose: () => void;
  readonly onStarted: () => void;
  /** True while Start is arming, when the dialog refuses to close. */
  readonly onArming: (arming: boolean) => void;
}): JSX.Element {
  const { prepared, onPin } = props;
  const unit = useLengthUnit();
  const project = useStore((state) => state.project);
  const laser = useLaserStore((state) => state);
  const actions = useExternalRunActions(
    prepared,
    props.frameState,
    onPin,
    props.onStarted,
    props.onArming,
  );
  const { frame, busy, error } = actions;
  const fitIssue = useControllerFitIssue(prepared.run.gcode);
  const litRapids = useMemo(() => findLitRapids(prepared.run.gcode), [prepared.run.gcode]);
  // A spent or expired Frame no longer holds the start: read the program again
  // from wherever the head is now.
  const frameSpent = frame !== null && laser.frameVerification !== frame.verification;
  useEffect(() => {
    if (frameSpent && busy === null) onPin(null);
  }, [frameSpent, busy, onPin]);
  const frameBlock = frameBlockReason(laser, fitIssue, props.start);
  const startIssue = externalStartIssue(frame, laser, project);
  const status =
    busy === 'framing'
      ? 'Framing… the head traces the program outline with the tool off, then returns.'
      : (startIssue ?? 'Ready to start: the framed program and placement are unchanged.');
  return (
    <>
      <RunGcodeFileSummary
        prepared={prepared}
        analysis={props.analysis}
        machineKind={machineKindOf(project.machine)}
        startKnown={props.start !== null}
        controllerWarnings={externalControllerWarnings(project, laser, litRapids)}
        bedWarnings={[
          ...externalOutlineBedWarnings(prepared.run.envelope, laser, project.device),
          ...externalZTopWarnings(prepared.review.zLifts, laser, project),
        ]}
        formatLength={(mm) => formatLengthWithUnit(mm, unit)}
        formatSeconds={formatDuration}
      />
      {fitIssue === null ? null : (
        <p className="lf-run-gcode-error" role="alert">
          {fitIssue}
        </p>
      )}
      <p className="lf-muted" role="status" aria-live="polite">
        {status}
      </p>
      {error === null ? null : (
        <p className="lf-run-gcode-error" role="alert">
          {error}
        </p>
      )}
      <RunActions
        busy={busy}
        frameBlock={frameBlock}
        startIssue={startIssue}
        onClose={props.onClose}
        onFrame={() => void actions.runFrame()}
        onStart={() => void actions.runStart()}
      />
    </>
  );
}

function RunActions(props: {
  readonly busy: 'framing' | 'starting' | null;
  readonly frameBlock: string | null;
  readonly startIssue: string | null;
  readonly onClose: () => void;
  readonly onFrame: () => void;
  readonly onStart: () => void;
}): JSX.Element {
  const { busy } = props;
  return (
    <DialogActions>
      <Button
        type="button"
        disabled={busy === 'starting'}
        {...(busy === 'starting' ? { title: CLOSE_WHILE_STARTING } : {})}
        onClick={props.onClose}
      >
        Close
      </Button>
      <Button
        type="button"
        disabled={busy !== null || props.frameBlock !== null}
        title={props.frameBlock ?? 'Trace the program outline over the material with the tool off.'}
        onClick={props.onFrame}
      >
        Frame
      </Button>
      <Button
        type="button"
        variant="primary"
        disabled={busy !== null || props.startIssue !== null}
        title={props.startIssue ?? 'Send this program to the machine.'}
        onClick={props.onStart}
      >
        Start
      </Button>
    </DialogActions>
  );
}
