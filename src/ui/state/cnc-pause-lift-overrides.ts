// cnc-pause-lift-overrides (ADR-411 Amendment 1) — the feed, rapid and
// spindle overrides a Pause and lift puts back. Its soft reset returns them
// to 100%: stock GRBL always does, and grblHAL always does for the spindle and
// for feed and rapid unless its keep-override settings are on. A cut the
// operator had slowed because it chattered would resume at full feed. Once the
// bit is up, the lift sets them again with the realtime override bytes and
// confirms them from the status report's Ov: field.

import {
  RT_FEED_OV_MINUS_1,
  RT_FEED_OV_MINUS_10,
  RT_FEED_OV_PLUS_1,
  RT_FEED_OV_PLUS_10,
  RT_FEED_OV_RESET,
  RT_RAPID_OV_FULL,
  RT_RAPID_OV_HALF,
  RT_RAPID_OV_QUARTER,
  RT_SPINDLE_OV_MINUS_1,
  RT_SPINDLE_OV_MINUS_10,
  RT_SPINDLE_OV_PLUS_1,
  RT_SPINDLE_OV_PLUS_10,
  RT_SPINDLE_OV_RESET,
  type OverrideValues,
} from '../../core/controllers/grbl';
import {
  assertOwnsCncPauseLift,
  CncPauseLiftLostError,
  waitForCncLiftStatus,
  type CncPauseLiftContext,
} from './cnc-pause-lift-commands';
import type { CncPauseLift } from './cnc-pause-lift-state';
import { overridesAtBaseline } from './laser-start-override-reset';
import { pushLog } from './laser-store-helpers';

const BASELINE_PERCENT = 100;

const RAPID_BYTES: Readonly<Record<number, string>> = {
  100: RT_RAPID_OV_FULL,
  50: RT_RAPID_OV_HALF,
  25: RT_RAPID_OV_QUARTER,
};

type StepBytes = {
  readonly reset: string;
  readonly plus10: string;
  readonly minus10: string;
  readonly plus1: string;
  readonly minus1: string;
};

const FEED_BYTES: StepBytes = {
  reset: RT_FEED_OV_RESET,
  plus10: RT_FEED_OV_PLUS_10,
  minus10: RT_FEED_OV_MINUS_10,
  plus1: RT_FEED_OV_PLUS_1,
  minus1: RT_FEED_OV_MINUS_1,
};

const SPINDLE_BYTES: StepBytes = {
  reset: RT_SPINDLE_OV_RESET,
  plus10: RT_SPINDLE_OV_PLUS_10,
  minus10: RT_SPINDLE_OV_MINUS_10,
  plus1: RT_SPINDLE_OV_PLUS_1,
  minus1: RT_SPINDLE_OV_MINUS_1,
};

/**
 * The realtime bytes that take the overrides to `target` from any starting
 * value: each override is reset to 100% first, so grblHAL's kept values and
 * GRBL's reset ones end in the same place. A rapid value outside GRBL's three
 * steps is left alone. Empty when the target is 100% everywhere.
 */
export function cncLiftOverrideBytes(target: OverrideValues): string {
  if (overridesAtBaseline(target)) return '';
  return (
    steppedBytes(target.feed, FEED_BYTES) +
    (RAPID_BYTES[target.rapid] ?? '') +
    steppedBytes(target.spindle, SPINDLE_BYTES)
  );
}

function steppedBytes(percent: number, bytes: StepBytes): string {
  const delta = Math.round(percent) - BASELINE_PERCENT;
  const tens = Math.trunc(delta / 10);
  const ones = delta - tens * 10;
  return (
    bytes.reset +
    (tens >= 0 ? bytes.plus10 : bytes.minus10).repeat(Math.abs(tens)) +
    (ones >= 0 ? bytes.plus1 : bytes.minus1).repeat(Math.abs(ones))
  );
}

function overridesReached(reported: OverrideValues, target: OverrideValues): boolean {
  return (
    reported.feed === Math.round(target.feed) &&
    reported.spindle === Math.round(target.spindle) &&
    (RAPID_BYTES[target.rapid] === undefined || reported.rapid === target.rapid)
  );
}

/** Puts the settled pause's overrides back after the lift's reset. A
 *  controller that does not confirm them is logged, not failed: the bit is
 *  already up, and the overrides stay adjustable while the job is paused. */
export async function restoreCncLiftOverrides(
  context: CncPauseLiftContext,
  lift: CncPauseLift,
): Promise<void> {
  const target = lift.overrides;
  const bytes = target === null ? '' : cncLiftOverrideBytes(target);
  if (target === null || bytes === '') return;
  assertOwnsCncPauseLift(context, lift.token);
  // Realtime bytes only, no newline: GRBL acts on them at once and owes no ok.
  await context.safeWrite(bytes, 'pause', 'system');
  const values = `feed ${target.feed}%, rapid ${target.rapid}%, spindle ${target.spindle}%`;
  try {
    await waitForCncLiftStatus(
      context,
      lift.token,
      (report) => report.ov != null && overridesReached(report.ov, target),
      'The controller did not report the restored overrides.',
    );
  } catch (error) {
    if (error instanceof CncPauseLiftLostError) throw error;
    context.set((state) => ({
      log: pushLog(
        state,
        `[lf2] Pause and lift: the controller did not confirm the overrides were put back (${values}). Check them before resuming.`,
      ),
    }));
    return;
  }
  context.set((state) => ({
    log: pushLog(state, `[lf2] Pause and lift: overrides put back to ${values} after the reset.`),
  }));
}
