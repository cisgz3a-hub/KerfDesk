// rotary-setup-edit — pure edits shared by Rotary Setup and the Machine Setup
// rotary fields (ADR-373). A setup carries a roller diameter only while it is
// a roller scaled from that diameter; a chuck never carries one. Turning the
// scaling off, or switching to Chuck, parks the last diameter so turning it
// back on restores the operator's value instead of a default.
//
// A new roller scales from its roller diameter, as LightBurn's roller always
// does. A saved roller opens in the mode it was saved with, so earlier
// projects keep their output (ADR-373 Amendment 1).

import {
  DEFAULT_ROTARY_SETUP,
  rotaryCircumferenceMm,
  rotaryDiameterFromCircumferenceMm,
  type DedicatedRotaryAxis,
  type RotaryAxis,
  type RotarySetup,
  type RotaryType,
} from '../../core/devices/rotary';
import {
  ROTARY_A_UNITS_PER_TURN,
  rotaryAxisOf,
  rotaryAxisUnit,
} from '../../core/devices/rotary-axis';
import type { DeviceProfile } from '../../core/devices/device-profile';
import { rotaryConnectorAxisFor, type RotaryPreset } from '../../core/devices/rotary-presets';
import { roundToThousandth } from '../../core/util/rounding';

// Only the field's starting value, for the operator to replace with the
// driven roller's measured diameter.
export const DEFAULT_ROLLER_DIAMETER_MM = 25;

// What Rotary Setup and Machine Setup start from when a profile has no rotary.
// A stock roller on an unchanged Y port turns a fixed angle per machine mm, so
// the part's surface moves by that angle times the roller's radius. Scale 1
// suits only a controller whose Y steps/mm were set to the surface.
export const NEW_ROTARY_SETUP: RotarySetup = {
  ...DEFAULT_ROTARY_SETUP,
  rollerDiameterMm: DEFAULT_ROLLER_DIAMETER_MM,
};

export type ParkedRoller = { readonly diameterMm: number; readonly scaled: boolean };

export type RotaryEdit = {
  readonly setup: RotarySetup;
  readonly parkedRoller: ParkedRoller;
  // Motion per turn in the units the axis is not using now, so switching
  // between a millimetre axis (Y, Z) and degrees (A) and back restores it.
  readonly parkedMotion?: { readonly mm?: number; readonly deg?: number };
};

export type RotaryFieldPatch = Partial<
  Pick<RotarySetup, 'enabled' | 'objectDiameterMm' | 'mmPerRotation' | 'reverseAxis'>
>;

export function startRotaryEdit(setup: RotarySetup): RotaryEdit {
  const diameterMm = setup.rollerDiameterMm;
  return {
    setup: setup.type === 'chuck' ? withoutRollerDiameter(setup) : setup,
    parkedRoller: {
      diameterMm: diameterMm ?? DEFAULT_ROLLER_DIAMETER_MM,
      // A chuck switched to Roller becomes a new roller, which scales.
      scaled: setup.type === 'chuck' || diameterMm !== undefined,
    },
  };
}

export function editRotaryFields(edit: RotaryEdit, patch: RotaryFieldPatch): RotaryEdit {
  return { ...edit, setup: { ...edit.setup, ...patch } };
}

export function editRotaryType(edit: RotaryEdit, type: RotaryType): RotaryEdit {
  if (edit.setup.type === type) return edit;
  if (type === 'chuck') {
    return {
      setup: { ...withoutRollerDiameter(edit.setup), type },
      parkedRoller: parkedFrom(edit),
    };
  }
  const { diameterMm, scaled } = edit.parkedRoller;
  return {
    ...edit,
    setup: scaled ? { ...edit.setup, type, rollerDiameterMm: diameterMm } : { ...edit.setup, type },
  };
}

/** A published rotary's type, axis and motion per turn; the work and the
 * toggles stay (ADR-503, ADR-695). A preset that names no axis keeps the
 * operator's choice. */
export function editRotaryPreset(
  edit: RotaryEdit,
  preset: Pick<RotaryPreset, 'setup'>,
): RotaryEdit {
  const typed = editRotaryType(edit, preset.setup.type);
  const axis = preset.setup.axis;
  const routed = axis === undefined ? typed : editRotaryAxis(typed, axis);
  const { roller } = preset.setup;
  const rolled =
    roller === undefined || routed.setup.type !== 'roller'
      ? routed
      : editRollerDiameter(editRollerScaling(routed, true), roller.diameterMm);
  return editRotaryFields(rolled, { mmPerRotation: preset.setup.mmPerRotation });
}

/**
 * The rotary's axis (ADR-695). Motion per turn is in the axis's own units, so
 * moving between millimetres (Y, Z) and degrees (A) parks the old value and
 * brings back the last one used in the new units; a first switch to A starts
 * at 360°, one turn of a degree-counting axis. Y is stored as no field, so a
 * setup back on Y saves exactly as one that was never moved.
 */
export function editRotaryAxis(edit: RotaryEdit, axis: RotaryAxis): RotaryEdit {
  const from = rotaryAxisOf(edit.setup);
  if (from === axis) return edit;
  const { axis: _old, ...rest } = edit.setup;
  const setup: RotarySetup = axis === 'Y' ? rest : { ...rest, axis };
  const fromUnit = rotaryAxisUnit(from);
  const toUnit = rotaryAxisUnit(axis);
  if (fromUnit === toUnit) return { ...edit, setup };
  const parked = edit.parkedMotion ?? {};
  const restored = parked[toUnit] ?? (toUnit === 'deg' ? ROTARY_A_UNITS_PER_TURN : undefined);
  return {
    ...edit,
    setup: restored === undefined ? setup : { ...setup, mmPerRotation: restored },
    parkedMotion: { ...parked, [fromUnit]: edit.setup.mmPerRotation },
  };
}

/** The operator saw a Test rotation turn the rotary on this axis (ADR-695). */
export function editRotaryAxisConfirmed(edit: RotaryEdit, axis: DedicatedRotaryAxis): RotaryEdit {
  return { ...edit, setup: { ...edit.setup, axisConfirmed: axis } };
}

export function editRollerScaling(edit: RotaryEdit, scaled: boolean): RotaryEdit {
  if (edit.setup.type !== 'roller') return edit;
  if (scaled) {
    if (edit.setup.rollerDiameterMm !== undefined) return edit;
    return {
      setup: { ...edit.setup, rollerDiameterMm: edit.parkedRoller.diameterMm },
      parkedRoller: { ...edit.parkedRoller, scaled: true },
    };
  }
  return {
    setup: withoutRollerDiameter(edit.setup),
    parkedRoller: { diameterMm: parkedFrom(edit).diameterMm, scaled: false },
  };
}

export function editRollerDiameter(edit: RotaryEdit, diameterMm: number): RotaryEdit {
  if (edit.setup.type !== 'roller' || edit.setup.rollerDiameterMm === undefined) return edit;
  return {
    setup: { ...edit.setup, rollerDiameterMm: diameterMm },
    parkedRoller: { diameterMm, scaled: true },
  };
}

// Circumference and diameter are one measurement: the setup stores the
// diameter, unrounded, so the circumference the operator typed survives.
export function editObjectCircumference(edit: RotaryEdit, circumferenceMm: number): RotaryEdit {
  return editRotaryFields(edit, {
    objectDiameterMm: rotaryDiameterFromCircumferenceMm(circumferenceMm),
  });
}

export { roundToThousandth as displayRotaryMm } from '../../core/util/rounding';

export function displayObjectCircumferenceMm(setup: RotarySetup): number {
  return roundToThousandth(rotaryCircumferenceMm(setup));
}

function parkedFrom(edit: RotaryEdit): ParkedRoller {
  const diameterMm = edit.setup.rollerDiameterMm;
  return diameterMm === undefined
    ? { ...edit.parkedRoller, scaled: false }
    : { diameterMm, scaled: true };
}

function withoutRollerDiameter(setup: RotarySetup): RotarySetup {
  if (setup.rollerDiameterMm === undefined) return setup;
  const { rollerDiameterMm: _parked, ...rest } = setup;
  return rest;
}

/** A new rotary for this machine: on its rotary connector's axis when its
 * maker's presets name one (the Falcon A1 Pro's A), else the Y default. */
export function newRotarySetupFor(
  device: Pick<DeviceProfile, 'machineFamily' | 'controllerCommandSet'>,
): RotarySetup {
  const connector = rotaryConnectorAxisFor(device);
  if (connector === null) return NEW_ROTARY_SETUP;
  return editRotaryAxis(startRotaryEdit(NEW_ROTARY_SETUP), connector).setup;
}
