// GRBL settings collector — pure state machine that watches a stream of
// classified responses and assembles the device's `$$` dump into a
// DeviceProfile patch. Runs once on connect (laser-store.ts kicks $$
// during handshake) and surfaces the result for the user to apply or
// dismiss.
//
// The map of GRBL setting numbers we look at:
//   $11   Junction deviation (mm)              → junctionDeviationMm
//   $30   Max spindle/laser RPM (S-value top)  → maxPowerS
//   $31   Min spindle/laser RPM (S-value floor)→ minPowerS
//   $32   Laser mode enabled (0/1)             → laserModeEnabled
//   $110  Max rate X (mm/min)                  ┐
//   $111  Max rate Y (mm/min)                  ├ taken as max of XY → maxFeed
//   $120  Acceleration X (mm/sec²)             ┐
//   $121  Acceleration Y (mm/sec²)             ├ taken as min of XY → accelMmPerSec2
//   $130  Max travel X (mm)                    → bedWidth
//   $131  Max travel Y (mm)                    → bedHeight
//
// Notes:
//   - `maxFeed` takes the max of X/Y because UI/G-code allows commanding
//     either axis at the device's top speed; the planner clamps per-axis
//     downstream.
//   - `accelMmPerSec2` takes the MIN of X/Y because vector moves are bound
//     by the slowest axis; using the slower one is a safe over-estimate for
//     time, and the planner can pick a smaller value per-move if needed.
//   - GRBL ships `$120`/`$121` already in mm/sec² — no unit conversion.
//   - Unknown / extra settings are ignored. The patch contains only fields
//     we could compute, so it merges cleanly with the existing profile.
//
// Pure-core compliant: no I/O, no clock, no random.

import type { DeviceProfile } from '../../devices/device-profile';
import { settingsMapToRows, type GrblSettingRow } from './grbl-settings';
import type { ControllerEvent } from '../controller-event';

export type ControllerSettingsSnapshot = Partial<
  Pick<
    DeviceProfile,
    | 'maxPowerS'
    | 'minPowerS'
    | 'laserModeEnabled'
    | 'maxFeed'
    | 'accelMmPerSec2'
    | 'bedWidth'
    | 'bedHeight'
    | 'zTravelMm'
    | 'junctionDeviationMm'
  >
> & {
  readonly softLimitsEnabled?: boolean;
  readonly hardLimitsEnabled?: boolean;
  readonly homingEnabled?: boolean;
  readonly homingDirectionMask?: number;
  readonly zMaxFeed?: number;
  readonly zAccelMmPerSec2?: number;
  // Per-axis max rates ($110/$111). `maxFeed` (a DeviceProfile key) keeps the
  // collapsed GREATER of the two for the planner/emit; these retain the raw
  // pair so an advisory can warn against the SLOWER axis (Codex re-audit R4).
  readonly maxFeedX?: number;
  readonly maxFeedY?: number;
};

export type SettingsCollectorState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'collecting'; readonly map: ReadonlyMap<number, string> }
  | {
      readonly kind: 'done';
      readonly patch: Partial<DeviceProfile>;
      readonly controllerSettings: ControllerSettingsSnapshot;
      readonly settingsRows: ReadonlyArray<GrblSettingRow>;
    };

export function idleCollector(): SettingsCollectorState {
  return { kind: 'idle' };
}

// Begin a new collection window. Called by laser-store right before it
// writes `$$\n` to the serial port.
export function startCollecting(): SettingsCollectorState {
  return { kind: 'collecting', map: new Map() };
}

// Consume one classified response. Three transitions:
//   collecting + setting  → collecting (with an updated map)
//   collecting + ok (after at least one setting seen) → done
//   anything else         → state unchanged
//
// The "after at least one setting" guard avoids consuming a pre-`$$` ok
// (e.g., the welcome banner's ack) as if it were the end of the dump.
export function onResponse(
  state: SettingsCollectorState,
  response: ControllerEvent,
): SettingsCollectorState {
  if (state.kind !== 'collecting') return state;
  if (response.kind === 'setting') {
    const next = new Map(state.map);
    next.set(response.id, response.value);
    return { kind: 'collecting', map: next };
  }
  if (response.kind === 'ok' && state.map.size > 0) {
    return {
      kind: 'done',
      patch: settingsMapToProfilePatch(state.map),
      controllerSettings: settingsMapToControllerSettings(state.map),
      settingsRows: settingsMapToRows(state.map),
    };
  }
  return state;
}

// Convert a raw GRBL settings map into a partial DeviceProfile. Each
// field is added only when the corresponding setting parsed cleanly,
// so partial machines (a GRBL fork that omits one of the settings)
// still produce a useful patch for the fields that did parse.
export function settingsMapToProfilePatch(
  map: ReadonlyMap<number, string>,
): Partial<DeviceProfile> {
  // Build the patch via object spread so every field stays as the
  // (readonly) DeviceProfile declares it. A `Partial<DeviceProfile>`
  // type alias inherits the readonly modifiers — direct assignment
  // is a compile error — so we accumulate field objects and merge.
  const fields: Array<Partial<DeviceProfile>> = [];

  pushPositiveSetting(fields, map, 11, (value) => ({ junctionDeviationMm: value }));
  pushPositiveSetting(fields, map, 30, (value) => ({ maxPowerS: value }));
  pushNonNegativeSetting(fields, map, 31, (value) => ({ minPowerS: value }));
  pushLaserModeSetting(fields, map);

  const rateX = parseFiniteNumber(map.get(110));
  const rateY = parseFiniteNumber(map.get(111));
  const maxRate = pickGreaterPositive(rateX, rateY);
  if (maxRate !== null) fields.push({ maxFeed: maxRate });

  const accelX = parseFiniteNumber(map.get(120));
  const accelY = parseFiniteNumber(map.get(121));
  const minAccel = pickLesserPositive(accelX, accelY);
  if (minAccel !== null) fields.push({ accelMmPerSec2: minAccel });

  pushPositiveSetting(fields, map, 130, (value) => ({ bedWidth: value }));
  pushPositiveSetting(fields, map, 131, (value) => ({ bedHeight: value }));
  pushPositiveSetting(fields, map, 132, (value) => ({ zTravelMm: value }));

  return Object.assign({}, ...fields) as Partial<DeviceProfile>;
}

export function settingsMapToControllerSettings(
  map: ReadonlyMap<number, string>,
): ControllerSettingsSnapshot {
  const softLimitsEnabled = parseBooleanSetting(map, 20);
  const hardLimitsEnabled = parseBooleanSetting(map, 21);
  const homingEnabled = parseBooleanSetting(map, 22);
  const homingDirectionMask = parseNonNegativeInteger(map.get(23));
  const zMaxFeed = parsePositiveNumber(map.get(112));
  const zAccelMmPerSec2 = parsePositiveNumber(map.get(122));
  const maxFeedX = parsePositiveNumber(map.get(110));
  const maxFeedY = parsePositiveNumber(map.get(111));
  return {
    ...settingsMapToProfilePatch(map),
    ...(softLimitsEnabled === undefined ? {} : { softLimitsEnabled }),
    ...(hardLimitsEnabled === undefined ? {} : { hardLimitsEnabled }),
    ...(homingEnabled === undefined ? {} : { homingEnabled }),
    ...(homingDirectionMask === undefined ? {} : { homingDirectionMask }),
    ...(zMaxFeed === undefined ? {} : { zMaxFeed }),
    ...(zAccelMmPerSec2 === undefined ? {} : { zAccelMmPerSec2 }),
    ...(maxFeedX === undefined ? {} : { maxFeedX }),
    ...(maxFeedY === undefined ? {} : { maxFeedY }),
  };
}

function parseBooleanSetting(map: ReadonlyMap<number, string>, id: number): boolean | undefined {
  const value = parseFiniteNumber(map.get(id));
  if (value === 0) return false;
  if (value === 1) return true;
  return undefined;
}

function parsePositiveNumber(value: string | undefined): number | undefined {
  const parsed = parseFiniteNumber(value);
  return parsed !== null && parsed > 0 ? parsed : undefined;
}

function parseNonNegativeInteger(value: string | undefined): number | undefined {
  const parsed = parseFiniteNumber(value);
  return parsed !== null && Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function pushPositiveSetting(
  fields: Array<Partial<DeviceProfile>>,
  map: ReadonlyMap<number, string>,
  id: number,
  build: (value: number) => Partial<DeviceProfile>,
): void {
  const value = parseFiniteNumber(map.get(id));
  if (value !== null && value > 0) fields.push(build(value));
}

function pushNonNegativeSetting(
  fields: Array<Partial<DeviceProfile>>,
  map: ReadonlyMap<number, string>,
  id: number,
  build: (value: number) => Partial<DeviceProfile>,
): void {
  const value = parseFiniteNumber(map.get(id));
  if (value !== null && value >= 0) fields.push(build(value));
}

function pushLaserModeSetting(
  fields: Array<Partial<DeviceProfile>>,
  map: ReadonlyMap<number, string>,
): void {
  const laserMode = parseFiniteNumber(map.get(32));
  if (laserMode === 0 || laserMode === 1) {
    fields.push({ laserModeEnabled: laserMode === 1 });
  }
}

// `$N=value` values arrive as strings like "1000", "0.010", "2500.000".
// parseFloat is lenient about trailing garbage; we want strict.
function parseFiniteNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function pickGreaterPositive(a: number | null, b: number | null): number | null {
  const candidates = [a, b].filter((n): n is number => n !== null && n > 0);
  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}

function pickLesserPositive(a: number | null, b: number | null): number | null {
  const candidates = [a, b].filter((n): n is number => n !== null && n > 0);
  if (candidates.length === 0) return null;
  return Math.min(...candidates);
}
