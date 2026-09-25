// How long a stock GRBL 1.1 homing cycle can physically take, from the `$$`
// settings it reads. GRBL answers no status query while it homes (limits.c:319-
// 320), so the host cannot tell a long cycle from a hung one by status silence;
// GRBL bounds the cycle itself and raises ALARM:8/9 when a switch is not found.
// This mirrors that bound (controller audit 2026-09-25 ST-4). gnea/grbl at
// bfb67f0c:
//   - limits_go_home runs 2 * N_HOMING_LOCATE_CYCLE + 2 = 4 moves per cycle
//     (limits.c:171, 363; config.h:118 N_HOMING_LOCATE_CYCLE 1): a search of
//     HOMING_AXIS_SEARCH_SCALAR (1.5) x max travel at $25, a pull-off at $25,
//     a locate of HOMING_AXIS_LOCATE_SCALAR (5.0) x $27 at $24, and a pull-off
//     at $25 (limits.c:27-30, 200, 209, 352-361); each move ends with a $26 ms
//     debounce delay (limits.c:349). Every axis moves at the cycle's rate
//     (limits.c:258 scales the vector rate by sqrt(axes)).
//   - mc_homing_cycle runs one cycle per HOMING_CYCLE_n mask (motion_control.c:
//     229-236). Treating each axis as its own cycle bounds every grouping.
// Pure-core: no clock, no I/O.

import type { GrblSettingRow } from './grbl-settings';

const SEARCH_SCALAR = 1.5;
const LOCATE_SCALAR = 5;
const MOVES_PER_CYCLE = 4;
const MAX_TRAVEL_IDS = [130, 131, 132] as const;
const LOCATE_FEED_ID = 24;
const SEEK_RATE_ID = 25;
const DEBOUNCE_MS_ID = 26;
const PULL_OFF_ID = 27;

/** The longest a `$H` can take on these settings, in ms; null when a setting
 *  it needs was not reported. */
export function grblHomingDurationBoundMs(
  rows: ReadonlyArray<Pick<GrblSettingRow, 'id' | 'numericValue'>>,
): number | null {
  const value = (id: number): number | null => {
    const found = rows.find((row) => row.id === id)?.numericValue;
    return found === undefined || found === null || !Number.isFinite(found) ? null : found;
  };
  const seek = value(SEEK_RATE_ID);
  const feed = value(LOCATE_FEED_ID);
  const pullOff = value(PULL_OFF_ID);
  const travels = MAX_TRAVEL_IDS.map(value);
  if (seek === null || seek <= 0 || feed === null || feed <= 0) return null;
  if (pullOff === null || pullOff < 0) return null;
  let minutes = 0;
  for (const travel of travels) {
    if (travel === null || travel < 0) return null;
    minutes += (SEARCH_SCALAR * travel + 2 * pullOff) / seek + (LOCATE_SCALAR * pullOff) / feed;
  }
  const debounceMs = Math.max(0, value(DEBOUNCE_MS_ID) ?? 0);
  return minutes * 60_000 + MOVES_PER_CYCLE * MAX_TRAVEL_IDS.length * debounceMs;
}
