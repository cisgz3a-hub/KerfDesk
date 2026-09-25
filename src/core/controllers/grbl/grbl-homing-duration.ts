// How long a GRBL-family homing cycle can physically take, from the `$$`
// settings it reads. Stock GRBL answers no status query while it homes
// (limits.c:320), and neither does grblHAL unless "report when homing" (bit 12
// of $10) is on, which is off by default (machine_limits.c:336-337, config.h:
// 751-753). So the host cannot tell a long cycle from a hung one by status
// silence; the firmware bounds the cycle itself and raises ALARM:8/9 when a
// switch is not found. This mirrors that bound (controller audit 2026-09-25
// ST-4). gnea/grbl at bfb67f0c:
//   - limits_go_home runs 2 * N_HOMING_LOCATE_CYCLE + 2 = 4 moves per cycle
//     (limits.c:171, 363; config.h:118 N_HOMING_LOCATE_CYCLE 1): a search of
//     HOMING_AXIS_SEARCH_SCALAR (1.5) x max travel at $25, a pull-off at $25,
//     a locate of HOMING_AXIS_LOCATE_SCALAR (5.0) x $27 at $24, and a pull-off
//     at $25 (limits.c:27-30, 200, 209, 352-361); each move ends with a $26 ms
//     debounce delay (limits.c:349). Every axis moves at the cycle's rate
//     (limits.c:258 scales the vector rate by sqrt(axes)).
//   - mc_homing_cycle runs one cycle per HOMING_CYCLE_n mask (motion_control.c:
//     229-236). Treating each axis as its own cycle bounds every grouping.
// grblHAL core at d7aaee3d runs the same moves with 2 * $43 + 2 per cycle
// (machine_limits.c:272, 517; $43 defaults to 1, config.h:1677-1678) and a
// locate of 10 x $27 (config.h:434, machine_limits.c:500), with the $26
// debounce after each (machine_limits.c:485).
// Pure-core: no clock, no I/O.

import type { GrblSettingRow } from './grbl-settings';

/** How one firmware's homing cycle moves. */
export type HomingCycleModel = {
  /** The locate move as a multiple of the pull-off distance ($27). */
  readonly locateScalar: number;
  /** The setting holding the number of locate cycles, or null for one. */
  readonly locateCyclesSettingId: number | null;
};

export const GRBL_HOMING_CYCLE: HomingCycleModel = { locateScalar: 5, locateCyclesSettingId: null };

export const GRBLHAL_HOMING_CYCLE: HomingCycleModel = {
  locateScalar: 10,
  locateCyclesSettingId: 43,
};

const SEARCH_SCALAR = 1.5;
const MAX_TRAVEL_IDS = [130, 131, 132] as const;
const LOCATE_FEED_ID = 24;
const SEEK_RATE_ID = 25;
const DEBOUNCE_MS_ID = 26;
const PULL_OFF_ID = 27;

type SettingRows = ReadonlyArray<Pick<GrblSettingRow, 'id' | 'numericValue'>>;

/** The longest a `$H` can take on these settings, in ms; null when a setting
 *  it needs was not reported. */
export function grblHomingDurationBoundMs(
  rows: SettingRows,
  cycle: HomingCycleModel = GRBL_HOMING_CYCLE,
): number | null {
  const value = (id: number): number | null => settingValue(rows, id);
  const seek = value(SEEK_RATE_ID);
  const feed = value(LOCATE_FEED_ID);
  const pullOff = value(PULL_OFF_ID);
  const travels = MAX_TRAVEL_IDS.map(value);
  if (seek === null || seek <= 0 || feed === null || feed <= 0) return null;
  if (pullOff === null || pullOff < 0) return null;
  const locates = locateCycles(rows, cycle);
  let minutes = 0;
  for (const travel of travels) {
    if (travel === null || travel < 0) return null;
    // One search, then a pull-off before and after each locate.
    minutes +=
      (SEARCH_SCALAR * travel + (locates + 1) * pullOff) / seek +
      (locates * cycle.locateScalar * pullOff) / feed;
  }
  const debounceMs = Math.max(0, value(DEBOUNCE_MS_ID) ?? 0);
  const movesPerAxis = 2 * locates + 2;
  return minutes * 60_000 + movesPerAxis * MAX_TRAVEL_IDS.length * debounceMs;
}

function locateCycles(rows: SettingRows, cycle: HomingCycleModel): number {
  if (cycle.locateCyclesSettingId === null) return 1;
  const reported = settingValue(rows, cycle.locateCyclesSettingId);
  return reported === null || reported < 1 ? 1 : Math.floor(reported);
}

function settingValue(rows: SettingRows, id: number): number | null {
  const found = rows.find((row) => row.id === id)?.numericValue;
  return found === undefined || found === null || !Number.isFinite(found) ? null : found;
}
