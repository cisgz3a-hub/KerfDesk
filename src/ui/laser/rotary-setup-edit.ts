// rotary-setup-edit — pure edits shared by Rotary Setup and the Machine Setup
// rotary fields (ADR-373). A setup carries a roller diameter only while it is
// a roller scaled from that diameter; a chuck never carries one. Turning the
// scaling off, or switching to Chuck, parks the last diameter so turning it
// back on restores the operator's value instead of a default.

import {
  rotaryCircumferenceMm,
  rotaryDiameterFromCircumferenceMm,
  type RotarySetup,
  type RotaryType,
} from '../../core/devices/rotary';

// Only the field's starting value; nothing scales until the operator turns
// roller scaling on and measures the driven roller.
export const DEFAULT_ROLLER_DIAMETER_MM = 25;

export type ParkedRoller = { readonly diameterMm: number; readonly scaled: boolean };

export type RotaryEdit = {
  readonly setup: RotarySetup;
  readonly parkedRoller: ParkedRoller;
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
      scaled: diameterMm !== undefined,
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

// Field values are shown to three decimals (a micrometre). Rounding here keeps
// a linked field from rewriting what the operator is typing with float noise.
export function displayRotaryMm(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function displayObjectCircumferenceMm(setup: RotarySetup): number {
  return displayRotaryMm(rotaryCircumferenceMm(setup));
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
