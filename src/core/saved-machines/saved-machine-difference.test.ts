import { describe, expect, it } from 'vitest';
import { everyFieldProfile } from '../../__fixtures__/saved-machines';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import { sameValue, savedMachineDifferences } from './saved-machine-difference';

const LABEL_FIELDS = new Set<string>([
  'name',
  'vendor',
  'model',
  'profileSource',
  'catalogVersion',
  'evidence',
  'savedMachineId',
]);

function without(profile: DeviceProfile, field: string): DeviceProfile {
  return Object.fromEntries(
    Object.entries(profile).filter(([key]) => key !== field),
  ) as DeviceProfile;
}

describe('saved machine differences', () => {
  it('finds none between a copy and itself or when only labels differ', () => {
    const saved = everyFieldProfile();
    const relabelled = {
      ...saved,
      name: 'Project name',
      vendor: 'Other',
      savedMachineId: 'other-id',
      evidence: [],
    };

    expect(savedMachineDifferences(saved, everyFieldProfile())).toEqual([]);
    expect(savedMachineDifferences(relabelled, saved)).toEqual([]);
  });

  it('puts every machine field in exactly one group', () => {
    const saved = everyFieldProfile();
    for (const field of Object.keys(saved)) {
      const differences = savedMachineDifferences(without(saved, field), saved);
      expect(differences, field).toHaveLength(LABEL_FIELDS.has(field) ? 0 : 1);
    }
  });

  it('lists the changed groups in display order', () => {
    const saved = everyFieldProfile();
    const projectCopy: DeviceProfile = {
      ...saved,
      autofocusCommand: '$HZ2',
      bedWidth: 400,
      noGoZones: [],
      scanOffsetCalibrationStatus: 'pending',
      origin: 'front-left',
      cncSubProfile: { ...saved.cncSubProfile, spindleMaxRpm: 12000 },
    };

    expect(savedMachineDifferences(projectCopy, saved)).toEqual([
      'Work area',
      'Origin and homing',
      'Scan offsets',
      'No-go zones',
      'CNC settings',
      'Auto-focus',
    ]);
  });

  it('reports every group between two unrelated machines', () => {
    expect(savedMachineDifferences(DEFAULT_DEVICE_PROFILE, everyFieldProfile())).toEqual([
      'Machine type',
      'Work area',
      'Origin and homing',
      'Controller and connection',
      'Power and laser mode',
      'Speeds and motion',
      'Air assist',
      'Scan offsets',
      'Camera',
      'No-go zones',
      'Rotary',
      'Laser head',
      'CNC settings',
      'Z axis',
      'Auto-focus',
    ]);
  });
});

describe('same value', () => {
  it('compares nested values and treats an undefined property as absent', () => {
    expect(sameValue({ a: [1, { b: 2 }], c: undefined }, { a: [1, { b: 2 }] })).toBe(true);
    expect(sameValue({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(sameValue([1], { 0: 1 })).toBe(false);
    expect(sameValue(null, {})).toBe(false);
    expect(sameValue(Number.NaN, Number.NaN)).toBe(true);
  });
});
