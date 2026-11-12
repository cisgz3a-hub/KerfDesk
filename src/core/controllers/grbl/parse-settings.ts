// GRBL settings collector — pure state machine that watches a stream of
// classified responses and assembles the device's `$$` dump into a
// DeviceProfile patch. Runs once on connect (laser-store.ts kicks $$
// during handshake) and surfaces the result for the user to apply or
// dismiss.
//
// The map of GRBL setting numbers we look at:
//   $11   Junction deviation (mm)              → junctionDeviationMm
//   $30   Max spindle/laser RPM (S-value top)  → maxPowerS (0 → maxPowerSReportedAsZero)
//   $31   Min spindle/laser RPM (S-value floor)→ minPowerS
//   $32   Mode of operation                    → machineMode + laserModeEnabled
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
//   - `$32` is three-way on grblHAL (Normal / Laser / Lathe) and boolean on
//     grbl and FluidNC — see grbl-machine-mode.ts. `laserModeEnabled` stays
//     the answer to "is laser mode on?", while `machineMode` carries the
//     mode the controller actually reported.
//   - Unknown / extra settings are ignored. The patch contains only fields
//     we could compute, so it merges cleanly with the existing profile.
//
// Pure-core compliant: no I/O, no clock, no random.

import type { DeviceProfile } from '../../devices/device-profile';
import { settingsMapToRows, type GrblSettingRow } from './grbl-settings';
import { homingCycleAxesField } from './grblhal-homing-cycles';
import {
  isLaserModeEnabled,
  parseGrblMachineMode,
  type GrblMachineMode,
} from './grbl-machine-mode';
import type { ControllerEvent } from '../controller-event';
import { rotaryAxesMaskField } from './reported-turn-units';
import { maxOf, minOf } from '../../util';

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
  readonly statusReportMask?: number;
  // This `$$` shows `$10` whole, as grblHAL at COMPATIBILITY_LEVEL 0 or 1
  // stores and prints it, so its upper bits are what the reports carry
  // (statusReportMaskFields).
  readonly statusReportMaskIsFull?: true;
  // This `$$` lists one of `$14`-`$18`, grblHAL's signal invert and pull-up
  // masks, which stock GRBL leaves unused. It is how a grblHAL build that
  // greets as "Grbl 1.1f" shows itself under a stock-GRBL profile
  // (grblHalSignalSettingsField; ADR-375 Amendment 5).
  readonly listsGrblHalSignalSettings?: true;
  readonly reportInches?: boolean;
  readonly homingPullOffMm?: number;
  readonly zMaxFeed?: number;
  readonly zAccelMmPerSec2?: number;
  // Per-axis max rates ($110/$111). `maxFeed` (a DeviceProfile key) keeps the
  // collapsed GREATER of the two for the planner/emit; these retain the raw
  // pair so an advisory can warn against the SLOWER axis (Codex re-audit R4).
  readonly maxFeedX?: number;
  readonly maxFeedY?: number;
  // The mode `$32` actually reported. `laserModeEnabled` above answers only
  // "is laser mode on?"; this distinguishes a grblHAL lathe ($32=2) from a
  // controller that never reported $32, which the boolean alone cannot.
  readonly machineMode?: GrblMachineMode;
  // grblHAL `$384` "Disable G92 persistence". Off, its default, grblHAL saves a
  // G92 origin (Set origin here) and restores it at power-up. Read, never
  // written, so Job Review can say which (ADR-375).
  readonly g92PersistenceDisabled?: boolean;
  // grblHAL `$22` bit 3 "Set machine origin to 0" (force set origin), read
  // only from a dump that prints the whole `$22` bitfield (ADR-375
  // Amendment 4); undefined for stock GRBL and FluidNC, which print 0 or 1.
  readonly homingForceSetOrigin?: boolean;
  // grblHAL `$44`-`$49`: the axes its homing passes cover, when the dump lists
  // them (grblhal-homing-cycles.ts). An axis in none is never homed.
  readonly homingCycleAxesMask?: number;
  // `$100` / `$101` / `$102`: one step's length bounds how far the machine position a
  // status report shows can sit from the firmware's own (ADR-375).
  readonly stepsPerMmX?: number;
  readonly stepsPerMmY?: number;
  readonly stepsPerMmZ?: number;
  // `$103`: steps per unit of a 4th (A) axis, degrees on a rotary. Job Review
  // checks rotary image rows against it (ADR-315 Amendment 1, ADR-695).
  readonly stepsPerUnitA?: number;
  // `$112` / `$113`: the Z and A axes' max rates. A rotary on Z or A cannot
  // turn faster; the planner caps any move that asks for more (ADR-695
  // Amendment 1).
  readonly maxRateZ?: number;
  readonly maxRateA?: number;
  // grblHAL `$376` rotary axes mask. With `$13=1` an axis past Z outside it is
  // reported in inches (reported-turn-units.ts; Oracle audit O1 O12-P1-1).
  readonly rotaryAxesMask?: number;
  // `$30=0` was reported. `maxPowerS` holds only a positive S range, because a
  // zero top must never reach a profile, but the report itself is evidence:
  // the controller has no S range at all (ADR-567 Amendment 1).
  readonly maxPowerSReportedAsZero?: true;
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
  const hardLimitsEnabled = grblEnableBit(parseFiniteNumber(map.get(21)));
  const homingEnabled = grblEnableBit(parseFiniteNumber(map.get(22)));
  const homingDirectionMask = parseNonNegativeInteger(map.get(23));
  const reportInches = parseBooleanSetting(map, 13);
  const homingPullOffMm = parseNonNegativeNumber(map.get(27));
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
    ...statusReportMaskFields(map),
    ...(reportInches === undefined ? {} : { reportInches }),
    ...(homingPullOffMm === undefined ? {} : { homingPullOffMm }),
    ...(zMaxFeed === undefined ? {} : { zMaxFeed }),
    ...(zAccelMmPerSec2 === undefined ? {} : { zAccelMmPerSec2 }),
    ...(maxFeedX === undefined ? {} : { maxFeedX }),
    ...(maxFeedY === undefined ? {} : { maxFeedY }),
    ...machineModeField(map),
    ...g92PersistenceField(map),
    ...grblHalSignalSettingsField(map),
    ...forceSetOriginField(map),
    ...homingCycleAxesField(map),
    ...stepsPerMmFields(map),
    ...rotaryAxesMaskField(map),
    ...zeroMaxPowerField(map),
  };
}

// A reported `$30=0`, which settingsMapToProfilePatch leaves out of `maxPowerS`.
function zeroMaxPowerField(
  map: ReadonlyMap<number, string>,
): Pick<ControllerSettingsSnapshot, 'maxPowerSReportedAsZero'> {
  return parseFiniteNumber(map.get(30)) === 0 ? { maxPowerSReportedAsZero: true } : {};
}

/** The `$30` the controller reported, including 0; undefined when it did not
 *  report one. Use `maxPowerS` wherever a usable S range is needed. */
export function reportedMaxPowerS(
  settings: Pick<ControllerSettingsSnapshot, 'maxPowerS' | 'maxPowerSReportedAsZero'>,
): number | undefined {
  return settings.maxPowerS ?? (settings.maxPowerSReportedAsZero === true ? 0 : undefined);
}

/** True when the reported `$30` is not above `$31`, so no S value lies between
 *  them. GRBL-family settings reject negative values, so an unreported `$31`
 *  counts as 0. Stock GRBL then drives full PWM for every S, S0 included:
 *  `spindle_compute_pwm_value` returns the maximum when `rpm_min >= rpm_max`
 *  before its S0 branch (gnea/grbl spindle_control.c). */
export function laserPowerRangeIsEmpty(
  settings: Pick<ControllerSettingsSnapshot, 'maxPowerS' | 'maxPowerSReportedAsZero' | 'minPowerS'>,
): boolean {
  const maxS = reportedMaxPowerS(settings);
  return maxS !== undefined && maxS <= (settings.minPowerS ?? 0);
}

// Kept out of settingsMapToControllerSettings' spread chain so that function
// stays under the cyclomatic-complexity cap.
function machineModeField(
  map: ReadonlyMap<number, string>,
): Pick<ControllerSettingsSnapshot, 'machineMode'> {
  const machineMode = parseGrblMachineMode(map.get(32));
  return machineMode === undefined ? {} : { machineMode };
}

// grblHAL lists `$384` (Format_Bool) only at COMPATIBILITY_LEVEL <= 1, where a
// warm reset keeps G92 whatever it says; it decides whether G92 is also saved
// and restored at power-up:
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/settings.c#L2475-L2477
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/gcode.c#L833-L838
function g92PersistenceField(
  map: ReadonlyMap<number, string>,
): Pick<ControllerSettingsSnapshot, 'g92PersistenceDisabled'> {
  const g92PersistenceDisabled = parseBooleanSetting(map, 384);
  return g92PersistenceDisabled === undefined ? {} : { g92PersistenceDisabled };
}

// grblHAL's `$22` bit 3 is force set origin, which puts a homed axis at 0 and
// decides its envelope. `$$` prints the whole bitfield, and lists extended
// settings such as `$384`, only at COMPATIBILITY_LEVEL <= 1; above that `$22`
// is 0 or 1 and force origin is a build default no setting reports. So the
// bit is read when `$22` carries more than bit 0 or the dump lists `$384`:
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/settings.h#L714-L718
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/settings.c#L1775-L1782
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/system.c#L300-L317
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/machine_limits.c#L116-L140
function forceSetOriginField(
  map: ReadonlyMap<number, string>,
): Pick<ControllerSettingsSnapshot, 'homingForceSetOrigin'> {
  const flags = parseNonNegativeInteger(map.get(22));
  if (flags === undefined || (flags <= 1 && !map.has(384))) return {};
  return { homingForceSetOrigin: (flags & 8) !== 0 };
}

// grblHAL keeps its signal invert and pull-up masks in `$14`-`$18`, which stock
// GRBL leaves unused, and its `$$` lists them at COMPATIBILITY_LEVEL 0 or 1:
// core d7aaee3 always lists `$15` and `$18`, and Ortur's ESP32-S2 firmware
// (level 1, greeting "Grbl 1.1f") lists all five. A stock-GRBL fork may list
// settings of its own, as Ortur's STM32 firmware (Grbl 1.1h) lists `$33`, so
// only these five are taken as grblHAL's (ADR-375 Amendment 5).
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/settings.c#L2368-L2372
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/system.c#L300-L317
// https://github.com/Ortur-Tech/Ortur_Laser_Firmware_17X-18X/blob/4849ac85fc1f1a15c47d0dbbfc3e69450922ad32/ESPLaserMasterGrbl/main/grbl/report.c#L482-L490
// https://github.com/Ortur-Tech/Ortur_Laser_Firmware_14X/blob/19e68f0eb6b6043a034ce36eec40151270be53dd/grbl/report.c#L233-L242
function grblHalSignalSettingsField(
  map: ReadonlyMap<number, string>,
): Pick<ControllerSettingsSnapshot, 'listsGrblHalSignalSettings'> {
  return [14, 15, 16, 17, 18].some((id) => map.has(id)) ? { listsGrblHalSignalSettings: true } : {};
}

// `$10`, and whether this dump shows it whole. grblHAL at COMPATIBILITY_LEVEL 0
// (its default) or 1 stores the whole `$10` and prints it; above level 1 it
// keeps the upper bits from its build and prints only bits 0 and 1
// (settings.c). Such a level's `$$` lists only grblHAL's legacy settings
// (system.c, report.c), so a `$10` above 3, or any other setting in the dump,
// shows the whole mask. Stock GRBL lists only legacy settings too.
// https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/settings.c#L862-L872
// https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/settings.c#L1739-L1745
// https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/system.c#L300-L318
// https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/report.c#L503-L507
function statusReportMaskFields(
  map: ReadonlyMap<number, string>,
): Pick<ControllerSettingsSnapshot, 'statusReportMask' | 'statusReportMaskIsFull'> {
  const statusReportMask = parseNonNegativeInteger(map.get(10));
  if (statusReportMask === undefined) return {};
  const isFull = statusReportMask > 3 || [...map.keys()].some((id) => !isStockGrblSetting(id));
  return isFull ? { statusReportMask, statusReportMaskIsFull: true } : { statusReportMask };
}

// $0-$7, $10-$13, $19, $20-$27, $30-$32 and the per-axis steps, rate,
// acceleration and travel ($100-$139): grblHAL's legacy settings, a superset of
// stock GRBL's. `$19` (probe pull-up disable) is legacy in grblHAL, so a level 2
// build with a probe input lists it beside a `$10` cut to bits 0 and 1.
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/settings.c#L2373
function isStockGrblSetting(id: number): boolean {
  return (
    (id >= 0 && id <= 7) ||
    (id >= 10 && id <= 13) ||
    id === 19 ||
    (id >= 20 && id <= 27) ||
    (id >= 30 && id <= 32) ||
    (id >= 100 && id <= 139)
  );
}

function stepsPerMmFields(
  map: ReadonlyMap<number, string>,
): Pick<
  ControllerSettingsSnapshot,
  'stepsPerMmX' | 'stepsPerMmY' | 'stepsPerMmZ' | 'stepsPerUnitA' | 'maxRateZ' | 'maxRateA'
> {
  const stepsPerMmX = parsePositiveNumber(map.get(100));
  const stepsPerMmY = parsePositiveNumber(map.get(101));
  const stepsPerMmZ = parsePositiveNumber(map.get(102));
  const stepsPerUnitA = parsePositiveNumber(map.get(103));
  const maxRateZ = parsePositiveNumber(map.get(112));
  const maxRateA = parsePositiveNumber(map.get(113));
  return {
    ...(maxRateZ === undefined ? {} : { maxRateZ }),
    ...(maxRateA === undefined ? {} : { maxRateA }),
    ...(stepsPerMmX === undefined ? {} : { stepsPerMmX }),
    ...(stepsPerMmY === undefined ? {} : { stepsPerMmY }),
    ...(stepsPerMmZ === undefined ? {} : { stepsPerMmZ }),
    ...(stepsPerUnitA === undefined ? {} : { stepsPerUnitA }),
  };
}

/**
 * The "Enable" bit of a GRBL-family `$21` (hard limits) or `$22` (homing)
 * value, or `undefined` when the value is not a non-negative integer.
 *
 * grblHAL reports both as bitfields whose bit 0 is "Enable" (`$21` "Enable,
 * Strict mode"; `$22` "Enable,Enable single axis commands,Homing on startup
 * required,...") and prints the whole flags value, so `$22=5` is homing
 * enabled (ADR-375):
 * https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/settings.c#L2377-L2385
 * https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/settings.c#L473
 * https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/settings.c#L1765-L1780
 * Stock GRBL and FluidNC print 0 or 1, which is the same bit:
 * https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/report.c#L197-L198
 * https://github.com/bdring/FluidNC/blob/fdc17a2c9c0367b07345c16da3937ff0739d4702/FluidNC/src/SettingsDefinitions.cpp#L151-L152
 */
export function grblEnableBit(value: number | null): boolean | undefined {
  if (value === null || !Number.isInteger(value) || value < 0) return undefined;
  return value % 2 === 1;
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

function parseNonNegativeNumber(value: string | undefined): number | undefined {
  const parsed = parseFiniteNumber(value);
  return parsed !== null && parsed >= 0 ? parsed : undefined;
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
  const mode = parseGrblMachineMode(map.get(32));
  if (mode === undefined) return;
  // A mode we cannot map leaves laser mode unproven rather than guessing.
  const laserModeEnabled = isLaserModeEnabled(mode);
  if (laserModeEnabled !== undefined) fields.push({ laserModeEnabled });
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
  return maxOf(candidates);
}

function pickLesserPositive(a: number | null, b: number | null): number | null {
  const candidates = [a, b].filter((n): n is number => n !== null && n > 0);
  if (candidates.length === 0) return null;
  return minOf(candidates);
}
