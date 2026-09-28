// grbl-sim-overrides — the GRBL simulator's realtime feed, rapid and spindle
// overrides (gnea/grbl 1.1h protocol.c:318-368). Feed and spindle step by 10
// or 1 inside 10-200%, rapid picks 100, 50 or 25%, and a soft reset puts all
// three back to 100% (main.c:77-79; grblHAL does the same unless its
// keep-override settings are on, grbllib.c:464-468). Reports carry `Ov:` while
// any override is off 100% and at a door, standing in for GRBL's refresh
// counter, which reports it right after a change.

export type GrblSimOverrides = {
  readonly feed: number;
  readonly rapid: number;
  readonly spindle: number;
};

export const GRBL_SIM_BASELINE_OVERRIDES: GrblSimOverrides = {
  feed: 100,
  rapid: 100,
  spindle: 100,
};

const MIN_PERCENT = 10;
const MAX_PERCENT = 200;

function clampPercent(value: number): number {
  return Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, value));
}

const FEED_STEPS: Readonly<Record<string, number>> = {
  '\x91': 10,
  '\x92': -10,
  '\x93': 1,
  '\x94': -1,
};
const SPINDLE_STEPS: Readonly<Record<string, number>> = {
  '\x9a': 10,
  '\x9b': -10,
  '\x9c': 1,
  '\x9d': -1,
};
const RAPID_VALUES: Readonly<Record<string, number>> = { '\x95': 100, '\x96': 50, '\x97': 25 };

/** The overrides after one realtime byte, or null when it is not an override. */
export function applyGrblSimOverrideByte(
  overrides: GrblSimOverrides,
  byte: string,
): GrblSimOverrides | null {
  if (byte === '\x90') return { ...overrides, feed: 100 };
  if (byte === '\x99') return { ...overrides, spindle: 100 };
  const feedStep = FEED_STEPS[byte];
  if (feedStep !== undefined) {
    return { ...overrides, feed: clampPercent(overrides.feed + feedStep) };
  }
  const spindleStep = SPINDLE_STEPS[byte];
  if (spindleStep !== undefined) {
    return { ...overrides, spindle: clampPercent(overrides.spindle + spindleStep) };
  }
  const rapid = RAPID_VALUES[byte];
  return rapid === undefined ? null : { ...overrides, rapid };
}

/** The status report's `|Ov:` field, or '' when the report omits it. */
export function grblSimOverrideField(overrides: GrblSimOverrides, atDoor: boolean): string {
  const baseline = overrides.feed === 100 && overrides.rapid === 100 && overrides.spindle === 100;
  return atDoor || !baseline ? `|Ov:${overrides.feed},${overrides.rapid},${overrides.spindle}` : '';
}
