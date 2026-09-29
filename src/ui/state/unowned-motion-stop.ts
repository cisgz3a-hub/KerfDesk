// unowned-motion-stop — Abort for motion the controller reports with no owner
// here (unowned-controller-motion.ts; controller audit 2, ADR-375 C-2). Every
// Abort (the Live Motion bar, Ctrl+. and the crash screen) runs runStopJob,
// which asks this module first. The reset alone, sent into a Console G1 or
// `$J=`, killed the steppers mid-move. Each state now gets the stop that keeps
// the machine position where the firmware has one:
//
// - Jog: jog cancel (0x85) decelerates, drops the jog and returns to Idle with
//   no reset; only a controller in Jog acts on it. A driver without it (the
//   Falcon contract) sends a feed hold, which GRBL applies to a jog as the
//   same cancel.
//   https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/serial.c#L159-L162
//   https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L262-L268
// - Run: a feed hold, then the reset once a fresh report shows the hold
//   complete. The reset kills the steppers and raises ALARM:3 only in a cycle,
//   a jog, homing or a hold still decelerating; a completed hold keeps
//   position and stays held until cycle start or a reset.
//   https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/motion_control.c#L380-L386
//   https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L377-L381
//   https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/motion_control.c#L1196-L1204
// - Hold, Door: that reset, once a hold still settling (Hold:1, Door:2 and
//   later) has completed.
// - Home: the reset at once. GRBL's homing loop ends only on a reset, a door
//   or its own finish, and FluidNC ignores a feed hold while homing.
//   https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/limits.c#L320-L324
//   https://github.com/bdring/FluidNC/blob/fdc17a2c9c0367b07345c16da3937ff0739d4702/FluidNC/src/Protocol.cpp#L850-L853
//
// The wait for a settled hold is bounded: past UNOWNED_HOLD_SETTLE_TIMEOUT_MS
// the reset goes anyway, as every Abort did before. A driver without a feed
// hold (Smoothieware) keeps the immediate reset.

import type { ControllerDriver } from '../../core/controllers';
import { softResetMayLosePosition } from './job-stop-request';
import type { LaserSafetyAction } from './laser-safety-notice';
import type { LaserState } from './laser-store';
import { unownedControllerMotion } from './unowned-controller-motion';

/** 'stopped': the motion ended with no reset. 'reset': send the reset now. */
export type UnownedMotionStop = 'stopped' | 'reset';

export type UnownedMotionStopContext = {
  readonly get: () => LaserState;
  readonly safeWrite: (line: string, action?: LaserSafetyAction) => Promise<void>;
  readonly driver: () => ControllerDriver;
};

// A feed hold decelerates at the configured acceleration, well under a second
// on a typical machine; the bound only keeps a silent controller from holding
// the reset back.
export const UNOWNED_HOLD_SETTLE_TIMEOUT_MS = 2_000;
const SETTLE_POLL_MS = 50;

export async function stopUnownedControllerMotion(
  context: UnownedMotionStopContext,
): Promise<UnownedMotionStop> {
  const motion = unownedControllerMotion(context.get());
  if (motion === 'Jog') return (await cancelUnownedJog(context)) ? 'stopped' : 'reset';
  if (motion === 'Run') await holdUntilSettled(context);
  if (motion === 'Hold' || motion === 'Door') await waitForReportedHold(context);
  return 'reset';
}

/** Whether a jog-ending byte reached the transport. */
async function cancelUnownedJog(context: UnownedMotionStopContext): Promise<boolean> {
  const { jogCancel, hold } = context.driver().realtime;
  try {
    if (jogCancel !== null) {
      // The operator Cancel path: it also retires any jog or Frame still
      // waiting to be sent and the completed Frame permit.
      await context.get().cancelJog();
      return true;
    }
    if (hold === null) return false;
    await context.safeWrite(hold, 'stop');
    return true;
  } catch {
    // A failed write falls back to the reset, which reports the transport.
    return false;
  }
}

async function holdUntilSettled(context: UnownedMotionStopContext): Promise<void> {
  const { hold, statusQuery } = context.driver().realtime;
  // Without both a settled hold can be neither requested nor seen.
  if (hold === null || statusQuery === null) return;
  try {
    await context.safeWrite(hold, 'stop');
  } catch {
    return;
  }
  await waitForSettledReport(context, statusQuery, context.get().statusSequence);
}

async function waitForReportedHold(context: UnownedMotionStopContext): Promise<void> {
  const state = context.get();
  const report = state.statusReport;
  const statusQuery = context.driver().realtime.statusQuery;
  // A hold without a substate says nothing about settling: reset as before.
  if (report === null || report.subState === null || statusQuery === null) return;
  if (!softResetMayLosePosition(report, null, false)) return;
  await waitForSettledReport(context, statusQuery, state.statusSequence);
}

/** Poll until a report newer than `afterSequence` shows the reset would keep
 *  position, the session ends, or the bound passes. */
async function waitForSettledReport(
  context: UnownedMotionStopContext,
  statusQuery: string,
  afterSequence: number,
): Promise<void> {
  const session = context.get().controllerSessionEpoch;
  const deadline = Date.now() + UNOWNED_HOLD_SETTLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const state = context.get();
    if (state.connection.kind !== 'connected' || state.controllerSessionEpoch !== session) return;
    const fresh = state.statusSequence > afterSequence;
    if (fresh && !softResetMayLosePosition(state.statusReport, null, false)) return;
    await context.safeWrite(statusQuery).catch(() => undefined);
    await sleep(SETTLE_POLL_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
