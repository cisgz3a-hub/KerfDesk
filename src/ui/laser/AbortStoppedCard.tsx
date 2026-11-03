// AbortStoppedCard — the Alarm 3 card after the operator's own ABORT JOB
// (ADR-341 Amendment 11). It replaces "Reset during motion … Re-home the
// machine ($H)" with what happened, in plain words, and offers the origin the
// job ran with back as the main action (abort-alarm-recovery.ts). Set origin
// here stays beside it as the alternative, with the sentence the Review
// recovery uses. A machine without homing is not told to home.

import { useState } from 'react';
import type { ControllerKind } from '../../core/devices';
import type { MachineKind } from '../../core/scene';
import type { JobStopRequest } from '../state/job-stop-request';
import { useToastStore } from '../state/toast-store';
import { commandLabels, useActiveDriverCommands } from './AlarmRecoveryActions';
import { restoreOriginAfterAbort, setOriginHereAfterAbort } from './abort-alarm-recovery';
import { formatOriginMm } from './laser-recovery-origin';

export const ABORT_STOPPED_TITLE = 'You stopped the job';

export const ABORT_SET_ORIGIN_HERE_NOTE =
  'Set origin here would put the origin where the head is now, not where the job started.';

type Saved = { readonly x: number; readonly y: number };

type CardProps = {
  readonly request: JobStopRequest;
  readonly controllerKind: ControllerKind;
  readonly machineKind: MachineKind;
  readonly homingEnabled: boolean;
  readonly homeFromAlarm: boolean;
  readonly canUnlock: boolean;
  readonly onHome: () => void;
  readonly onUnlock: () => void;
};

type ActionRun = (action: () => Promise<void>, done: string) => Promise<void>;

export function AbortStoppedCard(props: CardProps): JSX.Element {
  const saved = props.request.originAtStopMm ?? null;
  const homeFirst = props.homingEnabled && props.homeFromAlarm;
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const run: ActionRun = async (action, done) => {
    if (running) return;
    setRunning(true);
    setFailure(null);
    try {
      await action();
      // The alarm is cleared by now, so this card is gone: the toast says it.
      useToastStore.getState().pushToast(done, 'success');
    } catch (error: unknown) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  };
  return (
    <div style={cardStyle} role="alert">
      <strong>{ABORT_STOPPED_TITLE}</strong>
      <p style={detailStyle}>{abortStoppedDetail(saved, props.controllerKind, homeFirst)}</p>
      {saved !== null && (
        <p style={detailStyle}>
          {restoreExplanation(homeFirst)} {ABORT_SET_ORIGIN_HERE_NOTE}
          {props.machineKind === 'cnc' ? ' The reset cleared work Z too: zero Z again.' : ''}
        </p>
      )}
      <div style={actionRowStyle}>
        {saved === null ? null : (
          <OriginActions
            saved={saved}
            homeFirst={homeFirst}
            canUnlock={props.canUnlock}
            running={running}
            run={run}
          />
        )}
        <AlarmActions
          showHome={saved === null && homeFirst}
          canUnlock={props.canUnlock}
          running={running}
          onHome={props.onHome}
          onUnlock={props.onUnlock}
        />
      </div>
      {failure !== null && (
        <p role="alert" style={detailStyle}>
          {failure}
        </p>
      )}
    </div>
  );
}

/** Restore saved origin (the main action) and Set origin here. */
function OriginActions(props: {
  readonly saved: Saved;
  readonly homeFirst: boolean;
  readonly canUnlock: boolean;
  readonly running: boolean;
  readonly run: ActionRun;
}): JSX.Element {
  const commands = useActiveDriverCommands();
  const home = commandLabels(commands.home ?? '$H').sequence;
  const unlock = commands.unlock ?? '$X';
  const { saved, homeFirst, running, run } = props;
  const restoreLabel = homeFirst ? 'Home, then restore origin' : 'Restore saved origin';
  return (
    <>
      {(homeFirst || props.canUnlock) && (
        <button
          type="button"
          disabled={running}
          onClick={() =>
            void run(() => restoreOriginAfterAbort(saved, homeFirst), restoredMessage(saved))
          }
          title={
            homeFirst
              ? `Send ${home}, then write the job's origin back with one G92. The head moves to its home switches first.`
              : `Send ${unlock}, then write the job's origin back with one G92. The head does not move.`
          }
        >
          {running ? 'Working…' : restoreLabel}
        </button>
      )}
      {props.canUnlock && (
        <button
          type="button"
          disabled={running}
          onClick={() => void run(setOriginHereAfterAbort, SET_HERE_DONE_MESSAGE)}
          title={`Send ${unlock}, then make the head's current position the work origin.`}
        >
          Set origin here
        </button>
      )}
    </>
  );
}

/** Home (only with homing, and only when there is no origin to restore) and
 *  plain Unlock, for an operator who wants to jog first. */
function AlarmActions(props: {
  readonly showHome: boolean;
  readonly canUnlock: boolean;
  readonly running: boolean;
  readonly onHome: () => void;
  readonly onUnlock: () => void;
}): JSX.Element {
  const commands = useActiveDriverCommands();
  const home = commandLabels(commands.home ?? '$H');
  const unlock = commands.unlock ?? '$X';
  return (
    <>
      {props.showHome && (
        <button type="button" disabled={props.running} onClick={props.onHome}>
          {home.label}
        </button>
      )}
      {props.canUnlock && (
        <button
          type="button"
          disabled={props.running}
          onClick={props.onUnlock}
          title={`Send ${unlock} to unlock the controller without changing the origin.`}
        >
          {`${unlock} — Unlock`}
        </button>
      )}
    </>
  );
}

/** What happened: stopped, laser off, and what the reset did to the origin. */
export function abortStoppedDetail(
  saved: Saved | null,
  controllerKind: ControllerKind,
  homeFirst: boolean,
): string {
  if (saved === null) {
    return (
      'The laser is off. Stopping reset the controller, which locked it. ' +
      (homeFirst
        ? 'Home the machine before you run the job again.'
        : 'Unlock it, then move the head to where the job should start.')
    );
  }
  const where = `X ${formatOriginMm(saved.x)}, Y ${formatOriginMm(saved.y)} mm from machine zero`;
  // grblHAL keeps a G92 origin through a reset (ADR-375); KerfDesk still
  // re-confirms it after the alarm, so the same action is offered.
  return controllerKind === 'grblhal'
    ? `The laser is off. The controller reset; grblHAL keeps your origin (${where}) through a reset.`
    : `The laser is off. The controller reset, so your origin was cleared. It was at ${where}.`;
}

function restoreExplanation(homeFirst: boolean): string {
  return homeFirst
    ? 'Home, then restore origin measures the machine again and puts the origin back where the job started.'
    : 'Restore saved origin unlocks the controller and puts the origin back where the job started, without moving the head.';
}

function restoredMessage(saved: Saved): string {
  return (
    `Origin restored at X ${formatOriginMm(saved.x)}, Y ${formatOriginMm(saved.y)} mm from ` +
    'machine zero. Frame the job to check where it lands before you start.'
  );
}

const SET_HERE_DONE_MESSAGE =
  'Origin set where the head stopped. Frame the job to check where it lands before you start.';

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--lf-warning)',
  background: 'var(--lf-tint-warning)',
  color: 'var(--lf-warning-fg)',
  padding: 8,
  borderRadius: 4,
};
const detailStyle: React.CSSProperties = { margin: '4px 0' };
const actionRowStyle: React.CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap' };
