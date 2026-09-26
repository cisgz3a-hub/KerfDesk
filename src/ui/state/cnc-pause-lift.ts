// cnc-pause-lift (ADR-401) — "Pause and lift". A confirmed CNC Pause stops
// the router in place with the spindle off, but the bit stays in the wood,
// and a door-resume would restart the spindle there. GRBL cannot move while
// it holds a job, so once the hold has fully settled (Door:0 or Hold:0) the
// lift soft-resets the controller, which at a settled hold raises no alarm
// and keeps machine position, proves the work frame came back unchanged, and
// raises the bit to the program's own safe height. Resume then re-enters the
// cut from above (cnc-pause-reentry-run).
//
// Anything that makes the lift unsafe before the reset leaves the ordinary
// door pause untouched. Anything that fails after the reset ends the job:
// the controller no longer holds it, so the only safe outcome is the stop
// Abort sends, and pass recovery takes over.

import type { StatusReport } from '../../core/controllers/grbl';
import { formatGcodeCoordinateMm } from '../../core/gcode';
import type { MotionPoint } from '../../core/job/motion-manifest';
import {
  CNC_REENTRY_MODAL_LINE,
  cncPauseLiftLine,
  planCncPauseReentry,
  type CncPauseReentryPlan,
} from '../../core/recovery/cnc-pause-reentry';
import {
  assertOwnsCncPauseLift,
  failCncPauseLift,
  moveCncLift,
  sendCncLiftLine,
  waitForCncLiftStatus,
  type CncPauseLiftContext,
} from './cnc-pause-lift-commands';
import {
  nextCncPauseLiftToken,
  ownsCncPauseLift,
  reportedMachinePositionMm,
  samePoint,
  scaled,
  workPositionOf,
  type CncPauseLift,
} from './cnc-pause-lift-state';
import {
  cancelControllerResetWait,
  waitForControllerResetBoundary,
} from './laser-controller-reset-wait';
import { controllerPlannerSizeBlocks } from './laser-rx-capacity-evidence';
import type { LaserState } from './laser-store';
import { pushLog } from './laser-store-helpers';

const RESET_TIMEOUT_MS = 8_000;

type LiftStart =
  | { readonly kind: 'lift'; readonly lift: CncPauseLift }
  | { readonly kind: 'skip'; readonly reason: string | null };

/**
 * Runs after a confirmed CNC Pause. Resolves once the bit is at safe height,
 * once the lift was skipped (the plain pause stays), or once a failed lift
 * has ended the job with its notice.
 */
export async function liftPausedCncJob(context: CncPauseLiftContext): Promise<void> {
  const start = startingLift(context);
  if (start.kind === 'skip') {
    if (start.reason !== null) logNoLift(context, start.reason);
    return;
  }
  const { lift } = start;
  let resetAttempted = false;
  try {
    await resetForLift(context, lift, () => {
      resetAttempted = true;
    });
    const wroteG92 = await verifyFrameAfterReset(context, lift);
    await moveCncLift(
      context,
      lift,
      cncPauseLiftLine(lift.plan),
      { z: lift.plan.safeZMm },
      'pause',
    );
    finishLift(context, lift, wroteG92);
  } catch (error) {
    if (resetAttempted) {
      await failCncPauseLift(context, lift.token, error);
      return;
    }
    // Nothing reached the controller: the settled door pause still holds.
    context.set((state) => ({
      ...(state.cncPauseLift?.token === lift.token ? { cncPauseLift: null } : {}),
      log: pushLog(state, `[lf2] Pause and lift skipped: ${messageOf(error)}`),
    }));
  }
}

function startingLift(context: CncPauseLiftContext): LiftStart {
  const state = context.get();
  const driver = context.driver();
  if (state.activeJobMachineKind !== 'cnc' || state.streamer?.status !== 'paused') {
    return { kind: 'skip', reason: null };
  }
  const refusal = liftRefusal(context, state);
  if (refusal !== null) return { kind: 'skip', reason: refusal };
  const { statusReport: report, wcoCache } = state;
  const reportInches = state.controllerSettings?.reportInches === true;
  const machineMm =
    report === null ? null : reportedMachinePositionMm(report, wcoCache, reportInches);
  if (machineMm === null || wcoCache === null) {
    return { kind: 'skip', reason: 'The paused position is not known.' };
  }
  const workOffsetMm = scaled(wcoCache, reportInches);
  const stopPoint = {
    x: machineMm.x - workOffsetMm.x,
    y: machineMm.y - workOffsetMm.y,
    z: machineMm.z - workOffsetMm.z,
  };
  const planned = planCncPauseReentry({
    lines: state.streamer.queued,
    ackedLines: state.streamer.completed,
    sentLines: state.streamer.queueIndex,
    stopPoint,
    controllerKind: driver.kind,
    plannerBlocks: controllerPlannerSizeBlocks(state),
  });
  if (planned.kind === 'no-lift') return { kind: 'skip', reason: planned.reason };
  return {
    kind: 'lift',
    lift: {
      token: nextCncPauseLiftToken(),
      phase: 'lifting',
      streamerEpoch: state.streamerEpoch,
      resetWriteEpoch: null,
      plan: planned.plan,
      reportInches,
      machineMm,
      workOffsetMm,
      workOriginActive: state.workOriginActive,
      workOriginSource: state.workOriginSource,
    },
  };
}

/** Why the controller evidence rules the lift out, or null. */
function liftRefusal(context: CncPauseLiftContext, state: LaserState): string | null {
  if (state.connection.kind !== 'connected' || context.driver().realtime.softReset === null) {
    return 'The controller has no soft reset to clear its hold with.';
  }
  if (state.controllerSettings?.laserModeEnabled !== false) {
    // With $32=1 GRBL does not spin the spindle up while idle.
    return 'Laser mode ($32) is on or unconfirmed, so the spindle cannot spin up above the cut.';
  }
  if (state.controllerBuildInfo?.optionCodes.includes('P') === true) {
    return 'The controller parks the spindle itself (parking is compiled in).';
  }
  if (state.mpgActive === true) return 'A pendant (MPG) has control of the machine.';
  if (context.refs.controllerResetWait != null) return 'Another controller reset is pending.';
  return holdRefusal(state);
}

/** Why the paused hold itself rules the lift out, or null. */
function holdRefusal(state: LaserState): string | null {
  const report = state.statusReport;
  if (!isSettledHold(report)) {
    return report?.state === 'Door' && report.subState === 1
      ? 'The door input is open.'
      : 'The pause has not settled.';
  }
  if (state.wcoCache === null || state.reportUnitsUnconfirmed === true) {
    return 'The work offset is not known.';
  }
  return null;
}

function isSettledHold(report: StatusReport | null): boolean {
  return (report?.state === 'Door' || report?.state === 'Hold') && report.subState === 0;
}

async function resetForLift(
  context: CncPauseLiftContext,
  lift: CncPauseLift,
  markAttempted: () => void,
): Promise<void> {
  const softReset = context.driver().realtime.softReset;
  if (softReset === null) throw new Error('The controller has no soft reset.');
  const epoch = context.refs.writeEpoch ?? 0;
  const boundary = waitForControllerResetBoundary(context.refs, epoch, RESET_TIMEOUT_MS);
  context.set((state) => ({
    cncPauseLift: { ...lift, resetWriteEpoch: epoch },
    log: pushLog(
      state,
      `[lf2] Pause and lift: resetting the settled hold to lift the bit to Z${formatGcodeCoordinateMm(lift.plan.safeZMm)}.`,
    ),
  }));
  markAttempted();
  try {
    await context.safeWrite(softReset, 'pause', 'system');
  } catch (error) {
    // A fast banner advances the epoch before the write resolves; that
    // observed reboot is stronger evidence than the transport's answer.
    if ((context.refs.writeEpoch ?? 0) === epoch) {
      cancelControllerResetWait(context.refs, 'The lift reset write failed.');
      await boundary.catch(() => undefined);
      throw error;
    }
  }
  await boundary;
  assertOwnsCncPauseLift(context, lift.token);
}

/**
 * The reboot must not have moved the machine, and the work frame the paused
 * program ran in must be back before anything moves. GRBL drops a G92 origin
 * and a tool length offset on reset; one G92 puts the whole offset back.
 * Returns whether that G92 was written.
 */
async function verifyFrameAfterReset(
  context: CncPauseLiftContext,
  lift: CncPauseLift,
): Promise<boolean> {
  const report = await waitForCncLiftStatus(
    context,
    lift.token,
    (candidate) => candidate.state === 'Idle' && candidate.wco !== null,
    'The controller did not report Idle with its work offset after the lift reset.',
  );
  const machine = reportedMachinePositionMm(report, report.wco, lift.reportInches);
  if (machine === null || !samePoint(machine, lift.machineMm)) {
    throw new Error('The machine position changed across the lift reset.');
  }
  await sendCncLiftLine(context, lift.token, CNC_REENTRY_MODAL_LINE, 'pause');
  if (report.wco !== null && samePoint(scaled(report.wco, lift.reportInches), lift.workOffsetMm)) {
    return false;
  }
  await sendCncLiftLine(
    context,
    lift.token,
    workOriginLine(workPositionOf(lift, machine)),
    'pause',
  );
  await waitForCncLiftStatus(
    context,
    lift.token,
    (candidate) =>
      candidate.wco !== null &&
      samePoint(scaled(candidate.wco, lift.reportInches), lift.workOffsetMm),
    'The work offset did not come back after the lift reset.',
  );
  return true;
}

function workOriginLine(work: MotionPoint): string {
  const mm = formatGcodeCoordinateMm;
  return `G92 X${mm(work.x)} Y${mm(work.y)} Z${mm(work.z)}`;
}

function finishLift(context: CncPauseLiftContext, lift: CncPauseLift, wroteG92: boolean): void {
  context.set((state) => {
    const current = state.cncPauseLift ?? null;
    if (current === null || !ownsCncPauseLift(state, lift.token)) return {};
    return {
      cncPauseLift: { ...current, phase: 'lifted' },
      // The frame was proven unchanged above, so the origin the reset
      // cleared is the one still in effect. Work-Z evidence stays cleared.
      workOriginActive: lift.workOriginActive,
      workOriginSource: wroteG92 ? 'g92' : lift.workOriginSource,
      log: pushLog(state, liftedMessage(lift.plan)),
    };
  });
}

function liftedMessage(plan: CncPauseReentryPlan): string {
  return (
    `[lf2] Pause and lift: the bit is at Z${formatGcodeCoordinateMm(plan.safeZMm)} with the ` +
    `spindle off. Resume spins it up there, returns above the cut and continues from ` +
    `streamed line ${plan.resumeLineIndex + 1}.`
  );
}

function logNoLift(context: CncPauseLiftContext, reason: string): void {
  context.set((state) => ({
    log: pushLog(state, `[lf2] Paused without lifting the bit: ${reason}`),
  }));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
