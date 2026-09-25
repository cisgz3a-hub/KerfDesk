// rotary — rotary-attachment model + Y-axis mapping math (ADR-127 N1; roller
// diameter ADR-373).
//
// The rotary replaces the Y motor on GRBL diode machines: design-space Y is
// distance across the object's SURFACE, emitted Y is whatever machine motion
// produces that surface travel.
//
//   chuck:  one revolution = mmPerRotation machine mm, and one revolution
//           = π·objectDiameter surface mm → scale = mmPerRotation / (π·d).
//   roller: the object rides on the driven roller, so the object's surface
//           moves exactly as far as the roller's: one ROLLER revolution =
//           mmPerRotation machine mm = π·rollerDiameter surface mm → scale =
//           mmPerRotation / (π·rollerD), whatever the object's size. Without
//           a roller diameter the scale stays 1: the controller's Y steps/mm
//           must already be calibrated to roller-surface mm (ADR-127).
//
// All collapse to: emitted-Y limit for one object revolution = scale · π · d.

export type RotaryType = 'roller' | 'chuck';

export type RotarySetup = {
  readonly enabled: boolean;
  readonly type: RotaryType;
  // Machine-Y mm that turn the motor-driven element one full revolution: the
  // chuck (and so the object) for a chuck, the driven roller for a roller with
  // a roller diameter. A roller without one ignores it.
  readonly mmPerRotation: number;
  readonly objectDiameterMm: number;
  // Roller only: measured diameter of the motor-driven roller. Absent keeps
  // the surface-calibrated roller (scale 1, byte-identical output). A chuck
  // ignores it; Rotary Setup never saves one on a chuck, but a hand-edited
  // file may carry one.
  readonly rollerDiameterMm?: number;
  // Spin the object the opposite way (mount reversed / inverting gearing).
  // Mirrors the engraving around the cylinder so text isn't backwards.
  // Absent/false = normal direction, byte-identical output.
  readonly reverseAxis?: boolean;
};

// Which part the test rotation turns once: the object (the wrap a job uses)
// or the motor-driven element (chuck or roller, what mmPerRotation measures).
export type RotaryRevolutionTarget = 'object' | 'drive';

export const DEFAULT_ROTARY_SETUP: RotarySetup = {
  enabled: false,
  type: 'roller',
  mmPerRotation: 360,
  objectDiameterMm: 60,
};

export function rotaryCircumferenceMm(setup: RotarySetup): number {
  return Math.PI * setup.objectDiameterMm;
}

export function rotaryUsesRollerDiameter(setup: RotarySetup): boolean {
  return setup.type === 'roller' && setup.rollerDiameterMm !== undefined;
}

// Multiplier applied to emitted Y coordinates (design surface mm → machine mm).
export function rotaryYScale(setup: RotarySetup): number {
  if (setup.type === 'chuck') {
    return perRevolutionScale(setup.mmPerRotation, rotaryCircumferenceMm(setup));
  }
  // Exactly 1 without a roller diameter: applyRotaryYScale short-circuits on
  // it, which keeps every pre-ADR-373 roller project byte-identical.
  if (setup.rollerDiameterMm === undefined) return 1;
  return perRevolutionScale(setup.mmPerRotation, Math.PI * setup.rollerDiameterMm);
}

// Emitted-Y extent of exactly one object revolution — the wrap limit for
// bounds preflight (a taller job would burn onto its own start).
export function rotaryYLimitMm(setup: RotarySetup): number {
  return rotaryYScale(setup) * rotaryCircumferenceMm(setup);
}

// Machine-Y travel that turns the object, or the motor-driven element, one
// full revolution. Null when a surface-calibrated roller cannot know how far
// its roller turns.
export function rotaryRevolutionTravelMm(
  setup: RotarySetup,
  target: RotaryRevolutionTarget,
): number | null {
  if (target === 'object') return rotaryYLimitMm(setup);
  return setup.type === 'chuck' || rotaryUsesRollerDiameter(setup) ? setup.mmPerRotation : null;
}

// The measurements a rotary mapping needs, independent of `enabled`.
export function rotaryMeasurementsValid(setup: RotarySetup): boolean {
  return (
    isPositiveFinite(setup.objectDiameterMm) &&
    isPositiveFinite(setup.mmPerRotation) &&
    (!rotaryUsesRollerDiameter(setup) || isPositiveFinite(setup.rollerDiameterMm))
  );
}

export function isRotaryActive(setup: RotarySetup | undefined): setup is RotarySetup {
  return setup !== undefined && setup.enabled && rotaryMeasurementsValid(setup);
}

// A circumference measured on the object's surface → its diameter.
export function rotaryDiameterFromCircumferenceMm(circumferenceMm: number): number {
  return circumferenceMm / Math.PI;
}

// A strip wrapped once around the object measures along its own mid-thickness,
// half a thickness outside the surface all the way round: length = π·(d + t),
// so d = length/π − t. A zero thickness is the plain circumference.
export function rotaryDiameterFromWrapLengthMm(
  wrapLengthMm: number,
  stripThicknessMm: number,
): number {
  return wrapLengthMm / Math.PI - stripThicknessMm;
}

function perRevolutionScale(mmPerRotation: number, surfaceMmPerRevolution: number): number {
  return surfaceMmPerRevolution > 0 ? mmPerRotation / surfaceMmPerRevolution : 1;
}

function isPositiveFinite(value: number | undefined): boolean {
  return value !== undefined && Number.isFinite(value) && value > 0;
}
