import { describe, expect, it } from 'vitest';
import type { RotarySetup } from '../../core/devices';
import {
  DEFAULT_ROLLER_DIAMETER_MM,
  displayObjectCircumferenceMm,
  displayRotaryMm,
  editObjectCircumference,
  editRollerDiameter,
  editRollerScaling,
  editRotaryFields,
  editRotaryType,
  startRotaryEdit,
} from './rotary-setup-edit';

const LEGACY_ROLLER: RotarySetup = {
  enabled: true,
  type: 'roller',
  mmPerRotation: 360,
  objectDiameterMm: 60,
};

describe('rotary setup edits', () => {
  it('starts a surface-calibrated roller unscaled with a default roller size parked', () => {
    const edit = startRotaryEdit(LEGACY_ROLLER);
    expect(edit.setup).toBe(LEGACY_ROLLER);
    expect(edit.parkedRoller).toEqual({ diameterMm: DEFAULT_ROLLER_DIAMETER_MM, scaled: false });
  });

  it('adds the roller diameter only while roller scaling is on, and remembers it', () => {
    let edit = editRollerScaling(startRotaryEdit(LEGACY_ROLLER), true);
    expect(edit.setup.rollerDiameterMm).toBe(DEFAULT_ROLLER_DIAMETER_MM);
    edit = editRollerDiameter(edit, 31.5);
    edit = editRollerScaling(edit, false);
    expect(edit.setup).toEqual(LEGACY_ROLLER);
    expect(edit.setup).not.toHaveProperty('rollerDiameterMm');
    edit = editRollerScaling(edit, true);
    expect(edit.setup.rollerDiameterMm).toBe(31.5);
  });

  it('never gives a chuck a roller diameter, and restores the roller on the way back', () => {
    const measured = editRollerDiameter(
      editRollerScaling(startRotaryEdit(LEGACY_ROLLER), true),
      28,
    );
    const chuck = editRotaryType(measured, 'chuck');
    expect(chuck.setup).toEqual({ ...LEGACY_ROLLER, type: 'chuck' });
    expect(editRollerScaling(chuck, true)).toBe(chuck);
    expect(editRollerDiameter(chuck, 40)).toBe(chuck);
    expect(editRotaryType(chuck, 'roller').setup).toEqual({
      ...LEGACY_ROLLER,
      rollerDiameterMm: 28,
    });
    const unscaled = editRotaryType(
      editRotaryType(startRotaryEdit(LEGACY_ROLLER), 'chuck'),
      'roller',
    );
    expect(unscaled.setup).toEqual(LEGACY_ROLLER);
  });

  it('parks a roller diameter found on a loaded chuck instead of keeping it', () => {
    const edit = startRotaryEdit({ ...LEGACY_ROLLER, type: 'chuck', rollerDiameterMm: 22 });
    expect(edit.setup).not.toHaveProperty('rollerDiameterMm');
    expect(editRotaryType(edit, 'roller').setup.rollerDiameterMm).toBe(22);
  });

  it('links the circumference to the stored diameter without rounding it', () => {
    const edit = editObjectCircumference(startRotaryEdit(LEGACY_ROLLER), 188.5);
    expect(edit.setup.objectDiameterMm).toBe(188.5 / Math.PI);
    expect(displayObjectCircumferenceMm(edit.setup)).toBe(188.5);
    expect(displayRotaryMm(edit.setup.objectDiameterMm)).toBe(60.001);
    expect(editRotaryFields(edit, { reverseAxis: true }).setup.reverseAxis).toBe(true);
  });
});
