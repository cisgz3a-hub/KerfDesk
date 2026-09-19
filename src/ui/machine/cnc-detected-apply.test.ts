import { describe, expect, it } from 'vitest';
import type { ControllerSettingsSnapshot } from '../../core/controllers/grbl';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { computeCncDetectedApply } from './cnc-detected-apply';

const MACHINE = DEFAULT_CNC_MACHINE_CONFIG; // spindleMaxRpm 12000
const DEVICE = { bedWidth: 400, bedHeight: 400 };

describe('computeCncDetectedApply (ADR-111)', () => {
  it('returns null when nothing the machine cares about differs', () => {
    const detected: ControllerSettingsSnapshot = {
      maxPowerS: 12000,
      bedWidth: 400,
      bedHeight: 400,
    };
    expect(computeCncDetectedApply(detected, MACHINE, DEVICE)).toBeNull();
  });

  it('returns null for an empty snapshot', () => {
    expect(computeCncDetectedApply({}, MACHINE, DEVICE)).toBeNull();
  });

  it('offers spindle max from $30 only with an explicit numerical RPM mapping', () => {
    const apply = computeCncDetectedApply(
      { maxPowerS: 24000, laserModeEnabled: false },
      MACHINE,
      DEVICE,
      true,
    );
    expect(apply?.paramsPatch).toEqual({ spindleMaxRpm: 24000 });
    expect(apply?.devicePatch).toEqual({});
    expect(apply?.summary).toBe('spindle maximum 24000 RPM from selected S mapping');
  });

  it('does not equate CNC-mode S1000 with a 1000 RPM spindle', () => {
    expect(
      computeCncDetectedApply({ maxPowerS: 1000, laserModeEnabled: false }, MACHINE, DEVICE),
    ).toBeNull();
    expect(
      computeCncDetectedApply({ maxPowerS: 1000, laserModeEnabled: true }, MACHINE, DEVICE, true),
    ).toBeNull();
  });

  it('offers bed size from $130/$131 into the device, never the stock', () => {
    const apply = computeCncDetectedApply({ bedWidth: 750, bedHeight: 750 }, MACHINE, DEVICE);
    expect(apply?.devicePatch).toEqual({ bedWidth: 750, bedHeight: 750 });
    expect(apply?.paramsPatch).toEqual({});
    expect(apply?.summary).toBe('configured travel 750×750 mm');
  });

  it('combines spindle + bed and names a single differing bed dimension', () => {
    const apply = computeCncDetectedApply(
      { maxPowerS: 30000, laserModeEnabled: false, bedWidth: 400, bedHeight: 610 },
      MACHINE,
      DEVICE,
      true,
    );
    expect(apply?.paramsPatch).toEqual({ spindleMaxRpm: 30000 });
    expect(apply?.devicePatch).toEqual({ bedHeight: 610 });
    expect(apply?.summary).toBe(
      'spindle maximum 30000 RPM from selected S mapping, configured Y travel 610 mm',
    );
  });

  it('ignores detected values equal to the current ones', () => {
    // maxPowerS matches; only bedWidth differs → bed-width-only offer.
    const apply = computeCncDetectedApply({ maxPowerS: 12000, bedWidth: 300 }, MACHINE, DEVICE);
    expect(apply?.paramsPatch).toEqual({});
    expect(apply?.devicePatch).toEqual({ bedWidth: 300 });
    expect(apply?.summary).toBe('configured X travel 300 mm');
  });
});
