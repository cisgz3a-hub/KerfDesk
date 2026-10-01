// A new laser job starts at 100% feed, rapid and power (ADR-355).
//
// Live override percentages are per-run adjustments held by the CONTROLLER,
// not by the project. They outlive the job they were set in: a completed job
// leaves them in place, and on grblHAL with `$676` bit 3 clear ("Clear feed
// override" off) they even survive the soft reset Abort sends. Left alone, the
// next job silently runs at its reviewed speed and power multiplied by the old
// percentages: an operator reported typing new speed and power for a fresh
// image and watching it burn like the job they had just stopped.
//
// GRBL's receive interrupt sets pending override flags; its main loop applies
// them at a realtime checkpoint. A status may still show 100% before that
// checkpoint, and a reset plus an adjustment in the same flag batch applies
// reset first, then the adjustment. An owned queued command/ACK therefore
// flushes older flags before these standalone reset bytes and the first window.
// The window is validated before that boundary. Realtime bytes owe no ACK or
// RX budget and never share a queued line (ADR-361). Pause/Resume do not pass
// through this new-run baseline; their per-run adjustments stay put.

import {
  RT_FEED_OV_RESET,
  RT_RAPID_OV_FULL,
  RT_SPINDLE_OV_RESET,
  type OverrideValues,
} from '../../core/controllers/grbl';
import { wireEncodingError } from '../../core/controllers/serial-wire-encoding';
import type { ControllerDriver } from '../../core/controllers';
import type { MachineKind } from '../../core/scene';
import { startControllerCommand, type ControllerLifecycleRefs } from './laser-interactive-command';
import type { SafeWrite } from './laser-safe-write';
import type { LaserState } from './laser-store';
import { pushLog } from './laser-store-helpers';

const BASELINE_PERCENT = 100;

/** Decide the reset after every Start refusal point, so a refused Start sends
 * nothing: `send` writes `bytes` and then the first program window, and
 * `accepted` records the reset in the log once that window is on the wire. */
export function laserStartOverrideReset(
  machineKind: MachineKind,
  state: Pick<LaserState, 'capabilities' | 'ovCache'>,
): {
  readonly bytes: string;
  readonly send: (
    firstWindow: string,
    safeWrite: (payload: string, action: 'start') => Promise<void>,
    stillOwned: () => boolean,
    markProgramAttempted: () => void,
  ) => Promise<void>;
  readonly accepted: (current: LaserState, patch: Partial<LaserState>) => Partial<LaserState>;
} {
  const before = state.ovCache;
  const bytes = laserStartOverrideResetPrefix(machineKind, state.capabilities.overrides, before);
  return {
    bytes,
    send: (firstWindow, safeWrite, stillOwned, markProgramAttempted) =>
      sendResetThenFirstWindow(
        bytes,
        firstWindow,
        (payload) => safeWrite(payload, 'start'),
        stillOwned,
        markProgramAttempted,
      ),
    accepted: (current, patch) =>
      bytes === ''
        ? patch
        : { ...patch, log: pushLog(current, laserStartOverrideResetLogLine(before)) },
  };
}

export const LASER_START_OVERRIDE_RESET = RT_FEED_OV_RESET + RT_RAPID_OV_FULL + RT_SPINDLE_OV_RESET;

/** A processed queued line proves older realtime flags reached their checkpoint
 * before the later reset batch. Call while Start/Fire owns override admission. */
export function flushPendingOverrideCommands(
  refs: ControllerLifecycleRefs,
  write: SafeWrite,
  driver: Pick<ControllerDriver, 'commands'>,
  action: 'start' | 'fire',
): Promise<ReadonlyArray<string>> {
  return startControllerCommand(refs, write, {
    kind: action === 'start' ? 'start-arming' : 'interactive-command',
    label: action === 'start' ? 'Laser override baseline fence' : 'Fire override baseline fence',
    command: `${driver.commands.settleDwell}\n`,
    action,
    source: 'system',
    timeoutMs: 1_500,
    ...(action === 'start' ? { statusOwnership: 'laser-start-override-dwell' } : {}),
  });
}

/** The reset, when there is one, as its own realtime-only write (no newline,
 * so it owes no acknowledgement), then the first program window. A window the
 * wire cannot carry is refused by `write` before a byte leaves the host, so
 * the reset is held back from it too. The reset's write is an await the Start
 * did not have before: an Abort, disconnect or controller reset that lands in
 * it owns the wire from then on, so the window is written only while the Start
 * still owns it. After Abort's soft reset a controller without a homing lock
 * boots Idle and would run that window. */
export async function sendResetThenFirstWindow(
  bytes: string,
  firstWindow: string,
  write: (payload: string) => Promise<void>,
  stillOwned: () => boolean,
  markProgramAttempted: () => void,
): Promise<void> {
  if (bytes !== '' && wireEncodingError(firstWindow) === null) {
    await write(bytes);
    if (!stillOwned()) return;
  }
  markProgramAttempted();
  await write(firstWindow);
}

/** Even a reported baseline can precede application of a pending adjustment.
 * Supported laser Starts always establish the baseline after the flag fence. */
export function laserStartNeedsOverrideReset(
  machineKind: MachineKind,
  controllerHasOverrides: boolean,
  _overrides: OverrideValues | null,
): boolean {
  return machineKind === 'laser' && controllerHasOverrides;
}

export function overridesAtBaseline(overrides: OverrideValues): boolean {
  return (
    overrides.feed === BASELINE_PERCENT &&
    overrides.rapid === BASELINE_PERCENT &&
    overrides.spindle === BASELINE_PERCENT
  );
}

/** The bytes to send ahead of the first program window: the reset, or ''. */
export function laserStartOverrideResetPrefix(
  machineKind: MachineKind,
  controllerHasOverrides: boolean,
  overrides: OverrideValues | null,
): string {
  return laserStartNeedsOverrideReset(machineKind, controllerHasOverrides, overrides)
    ? LASER_START_OVERRIDE_RESET
    : '';
}

/** Low-power Fire lights the beam with one `M3 S<n>` capped at an absolute
 * share of full power, but the controller scales S by its power (spindle)
 * override (GRBL
 * https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/spindle_control.c#L195;
 * grblHAL
 * https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/spindle_control.c#L867-L868),
 * so a 200% left over from a job doubled the 5% ceiling (controller audit
 * P-2, ADR-375). Fire flushes pending flags, then always resets that one
 * override on supported firmware. Reported 100% may precede a pending change.
 * Fire does not move, so feed and rapid do not matter.
 * Returns the realtime byte to write ahead of Fire-on, or ''. */
export function firePowerOverrideReset(
  controllerHasOverrides: boolean,
  _overrides: OverrideValues | null,
): string {
  return controllerHasOverrides ? RT_SPINDLE_OV_RESET : '';
}

export function firePowerOverrideResetLogLine(before: OverrideValues | null): string {
  return before === null
    ? '[lf2] Reset the power override to 100% before Fire.'
    : `[lf2] Reset the power override to 100% before Fire (was ${before.spindle}%).`;
}

export function laserStartOverrideResetLogLine(before: OverrideValues | null): string {
  return before === null
    ? '[lf2] Reset feed, rapid and power overrides to 100% as the job started.'
    : `[lf2] Reset overrides to 100% as the job started (were feed ${before.feed}%, rapid ${before.rapid}%, power ${before.spindle}%).`;
}
