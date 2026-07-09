// rotary — rotary-attachment model + Y-axis mapping math (ADR-127 N1).
//
// The rotary replaces the Y motor on GRBL diode machines: design-space Y is
// distance across the object's SURFACE, emitted Y is whatever machine motion
// produces that surface travel.
//
//   roller: friction transfers surface distance 1:1 → scale 1. The wrap
//           limit is the object circumference.
//   chuck:  one revolution = mmPerRotation machine mm, and one revolution
//           = π·objectDiameter surface mm → scale = mmPerRotation / (π·d).
//
// Both collapse to: emitted-Y limit for one revolution = scale · π · d.

export type RotaryType = 'roller' | 'chuck';

export type RotarySetup = {
  readonly enabled: boolean;
  readonly type: RotaryType;
  // Machine-Y mm that produce exactly one full revolution of the OBJECT.
  // Meaningful for chuck; roller ignores it (surface transfer is 1:1 once
  // $101 is calibrated to roller-surface mm).
  readonly mmPerRotation: number;
  readonly objectDiameterMm: number;
  // Spin the object the opposite way (mount reversed / inverting gearing).
  // Mirrors the engraving around the cylinder so text isn't backwards.
  // Absent/false = normal direction, byte-identical output.
  readonly reverseAxis?: boolean;
};

export const DEFAULT_ROTARY_SETUP: RotarySetup = {
  enabled: false,
  type: 'roller',
  mmPerRotation: 360,
  objectDiameterMm: 60,
};

export function rotaryCircumferenceMm(setup: RotarySetup): number {
  return Math.PI * setup.objectDiameterMm;
}

// Multiplier applied to emitted Y coordinates (design surface mm → machine mm).
export function rotaryYScale(setup: RotarySetup): number {
  if (setup.type === 'roller') return 1;
  const circumference = rotaryCircumferenceMm(setup);
  return circumference > 0 ? setup.mmPerRotation / circumference : 1;
}

// Emitted-Y extent of exactly one revolution — the wrap limit for bounds
// preflight (a taller job would burn onto its own start).
export function rotaryYLimitMm(setup: RotarySetup): number {
  return rotaryYScale(setup) * rotaryCircumferenceMm(setup);
}

export function isRotaryActive(setup: RotarySetup | undefined): setup is RotarySetup {
  return (
    setup !== undefined &&
    setup.enabled &&
    Number.isFinite(setup.objectDiameterMm) &&
    setup.objectDiameterMm > 0 &&
    Number.isFinite(setup.mmPerRotation) &&
    setup.mmPerRotation > 0
  );
}
