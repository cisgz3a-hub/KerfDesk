// rotary-axis — which controller axis turns the rotary (ADR-695).
//
// LightBurn's Rotary Setup offers the same three: "Select Y Axis if you are
// unplugging your Y Axis stepper motor wire and plugging it into the rotary
// instead", and "Select Z Axis or A Axis if you are plugging your rotary into a
// dedicated rotary axis" (https://docs.lightburnsoftware.com/2.1/Reference/RotaryMode/RotaryModeGCode/).
// Its "MM Per Rotation" is "the distance of commanded movement" per turn, so
// the one number is in the axis's own units: millimetres on Y and Z, degrees
// on A, where grblHAL and FluidNC count a rotary axis.
//
// The mapping is the same on every axis: the job's Y slot carries the turn.
// On A or Z it is written under that letter, the head's Y is never commanded,
// and every Frame and job first declares the part's current turn as zero
// (`G92 A0`), because nothing reports where a dedicated rotary stands.

import type { ControllerKind, DeviceProfile } from './device-profile';
import type { DedicatedRotaryAxis, RotaryAxis, RotarySetup } from './rotary';

export const ROTARY_AXES: ReadonlyArray<RotaryAxis> = ['Y', 'A', 'Z'];

/** A degree-counting A axis turns 360 commanded units per revolution. */
export const ROTARY_A_UNITS_PER_TURN = 360;

export function isRotaryAxis(value: unknown): value is RotaryAxis {
  return value === 'Y' || value === 'A' || value === 'Z';
}

export function isDedicatedRotaryAxis(value: unknown): value is DedicatedRotaryAxis {
  return value === 'A' || value === 'Z';
}

/** The axis a setup turns; absent is Y, as every setup before ADR-695 was. */
export function rotaryAxisOf(setup: Pick<RotarySetup, 'axis'> | undefined): RotaryAxis {
  return setup?.axis ?? 'Y';
}

export function dedicatedRotaryAxisOf(
  setup: Pick<RotarySetup, 'axis'> | undefined,
): DedicatedRotaryAxis | null {
  const axis = rotaryAxisOf(setup);
  return axis === 'Y' ? null : axis;
}

/**
 * The axes KerfDesk can write a rotary to on this controller. Y works on every
 * controller. Z is a GRBL-family word every GRBL build accepts. A needs a
 * fourth axis, which grblHAL and FluidNC builds can have and stock GRBL 1.1
 * cannot. Marlin, Smoothieware and Ruida stay on Y: their extra-axis words and
 * rotary settings follow other contracts KerfDesk does not emit.
 */
export function rotaryAxesForController(
  device: Pick<DeviceProfile, 'controllerKind'>,
): ReadonlyArray<RotaryAxis> {
  return rotaryAxesForKind(device.controllerKind ?? 'grbl-v1.1');
}

function rotaryAxesForKind(kind: ControllerKind): ReadonlyArray<RotaryAxis> {
  switch (kind) {
    case 'grblhal':
    case 'fluidnc':
      return ROTARY_AXES;
    case 'grbl-v1.1':
      return ['Y', 'Z'];
    // ADR-704: the galvo encoder refuses a rotary job; Y keeps the editor's choice list.
    case 'marlin':
    case 'smoothieware':
    case 'ruida':
    case 'jcz-lmc':
      return ['Y'];
  }
}

export function rotaryAxisSupported(
  device: Pick<DeviceProfile, 'controllerKind'>,
  axis: RotaryAxis,
): boolean {
  return rotaryAxesForController(device).includes(axis);
}

/** The unit Motion per turn is entered in for this axis. */
export function rotaryAxisUnit(axis: RotaryAxis): 'mm' | 'deg' {
  return axis === 'A' ? 'deg' : 'mm';
}

/** "machine mm" or "°", as the Motion per turn field and its summaries show it. */
export function rotaryAxisUnitLabel(axis: RotaryAxis): string {
  return rotaryAxisUnit(axis) === 'deg' ? '°' : 'machine mm';
}

/** True while a dedicated axis has not been seen turning the rotary. */
export function rotaryAxisNeedsConfirmation(
  setup: Pick<RotarySetup, 'axis' | 'axisConfirmed'>,
): boolean {
  const axis = dedicatedRotaryAxisOf(setup);
  return axis !== null && setup.axisConfirmed !== axis;
}

/** What the connected controller says about its axes. */
export type ReportedControllerAxes = {
  /** Values in the status report's MPos/WPos: grblHAL and FluidNC report one
   * per configured axis, stock GRBL three. Null before a report arrives. */
  readonly statusAxisCount: number | null;
  /** grblHAL's `$I` `[AXS:<count>:<letters>]` letters, when read. */
  readonly axisLetters?: string | null;
};

export type RotaryAxisReportVerdict = 'present' | 'missing' | 'unknown';

/**
 * Whether the connected controller reports the rotary's axis. `$I` letters
 * settle it outright. Without them, a status report with three values has no
 * A; a fourth value is A on grblHAL and FluidNC, whose fourth axis is A unless
 * the build renames it, so it is only taken as present, never proven.
 */
export function rotaryAxisReportVerdict(
  axis: RotaryAxis,
  reported: ReportedControllerAxes,
): RotaryAxisReportVerdict {
  const letters = reported.axisLetters?.toUpperCase() ?? null;
  if (letters !== null && /^[XYZABCUVW]+$/.test(letters)) {
    return letters.includes(axis) ? 'present' : 'missing';
  }
  const count = reported.statusAxisCount;
  if (count === null || !Number.isInteger(count) || count < 1) return 'unknown';
  const needed = axis === 'A' ? 4 : axis === 'Z' ? 3 : 2;
  return count >= needed ? 'present' : 'missing';
}

/** The letters of a grblHAL `[AXS:4:XYZA]` value ("4:XYZA"), or null. */
export function axisLettersFromAxsField(value: string | undefined): string | null {
  if (value === undefined) return null;
  const match = /^\s*\d+\s*:\s*([A-Za-z]+)\s*$/.exec(value);
  return match?.[1]?.toUpperCase() ?? null;
}

/** grblHAL's `[AXS:4:XYZA]` letters from raw `$I` reply lines, or null. */
export function axisLettersFromBuildInfoLines(lines: ReadonlyArray<string>): string | null {
  for (const line of lines) {
    const match = /^\s*\[AXS:([^\]]*)\]\s*$/.exec(line);
    if (match !== null) return axisLettersFromAxsField(match[1]);
  }
  return null;
}

/** Why a rotary on `axis` cannot run on a controller that reports no such axis. */
export function rotaryAxisMissingMessage(
  axis: DedicatedRotaryAxis,
  reported: ReportedControllerAxes,
): string {
  const seen = reported.axisLetters ?? `${String(reported.statusAxisCount ?? '?')} axes`;
  return (
    `The rotary is set to the ${axis} axis, but the controller reports ${seen}, with no ${axis}, ` +
    'so it cannot turn the part. Nothing was sent. Choose the axis the rotary is plugged into in ' +
    'Rotary Setup.'
  );
}
