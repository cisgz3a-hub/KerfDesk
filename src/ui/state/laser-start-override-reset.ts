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
// The reset is three GRBL realtime bytes, written on their own immediately
// ahead of the program's first window: a queued line may not carry a byte
// above 0x7F (ADR-361, audit transport-2). GRBL acts on realtime bytes the
// moment they arrive and never stores them in its receive buffer, so they
// cost no RX budget and cannot reorder behind a queued line. The reset goes
// out only when the window can, so a Start that is refused, including one
// whose program the wire cannot carry, sends nothing at all. Pausing and
// resuming a running job never passes through here, so adjustments made
// during a job stay put.

import {
  RT_FEED_OV_RESET,
  RT_RAPID_OV_FULL,
  RT_SPINDLE_OV_RESET,
  type OverrideValues,
} from '../../core/controllers/grbl';
import { wireEncodingError } from '../../core/controllers/serial-wire-encoding';
import type { MachineKind } from '../../core/scene';
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
  readonly send: (firstWindow: string, write: (payload: string) => Promise<void>) => Promise<void>;
  readonly accepted: (current: LaserState, patch: Partial<LaserState>) => Partial<LaserState>;
} {
  const before = state.ovCache;
  const bytes = laserStartOverrideResetPrefix(machineKind, state.capabilities.overrides, before);
  return {
    bytes,
    send: (firstWindow, write) => sendResetThenFirstWindow(bytes, firstWindow, write),
    accepted: (current, patch) =>
      bytes === ''
        ? patch
        : { ...patch, log: pushLog(current, laserStartOverrideResetLogLine(before)) },
  };
}

export const LASER_START_OVERRIDE_RESET = RT_FEED_OV_RESET + RT_RAPID_OV_FULL + RT_SPINDLE_OV_RESET;

/** The reset, when there is one, as its own realtime-only write (no newline,
 * so it owes no acknowledgement), then the first program window. A window the
 * wire cannot carry is refused by `write` before a byte leaves the host, so
 * the reset is held back from it too. */
export async function sendResetThenFirstWindow(
  bytes: string,
  firstWindow: string,
  write: (payload: string) => Promise<void>,
): Promise<void> {
  if (bytes !== '' && wireEncodingError(firstWindow) === null) await write(bytes);
  await write(firstWindow);
}

/** Unknown overrides (no `Ov:` report yet this session) cannot be proved to be
 * at 100%, so they are reset as well. Known-baseline values need nothing. */
export function laserStartNeedsOverrideReset(
  machineKind: MachineKind,
  controllerHasOverrides: boolean,
  overrides: OverrideValues | null,
): boolean {
  if (machineKind !== 'laser' || !controllerHasOverrides) return false;
  return overrides === null || !overridesAtBaseline(overrides);
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

export function laserStartOverrideResetLogLine(before: OverrideValues | null): string {
  return before === null
    ? '[lf2] Reset feed, rapid and power overrides to 100% as the job started.'
    : `[lf2] Reset overrides to 100% as the job started (were feed ${before.feed}%, rapid ${before.rapid}%, power ${before.spindle}%).`;
}
