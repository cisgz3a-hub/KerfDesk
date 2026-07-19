import { describe, expect, it } from 'vitest';
import {
  CNC_MACHINE_STARTER_CATALOG,
  findCncMachineStarter,
  findCncMachineStarterById,
} from './cnc-machine-starter-catalog';

describe('CNC_MACHINE_STARTER_CATALOG', () => {
  it('contains unique starter ids', () => {
    const ids = CNC_MACHINE_STARTER_CATALOG.map((starter) => starter.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('describes the conservative Neotronics 4040 starter', () => {
    const match = findCncMachineStarter({
      profileId: 'neotronics-4040-max-lt4lds-v2-20w',
      machineFamily: 'different-family',
    });

    expect(match).toMatchObject({
      matchedBy: 'profile-id',
      matchedValue: 'neotronics-4040-max-lt4lds-v2-20w',
      starter: {
        confidence: 'engineering-starter',
        operatorNotice:
          'Engineering starter — assumes a 3.175 mm 2-flute cutter; verify on this machine.',
        tool: { toolId: 'em-3175', diameterMm: 3.175, fluteCount: 2 },
        material: { key: 'plywood-mdf', label: 'Wood / MDF' },
        values: {
          feedMmPerMin: 600,
          plungeMmPerMin: 120,
          spindleRpm: 12000,
          depthPerPassMm: 0.75,
        },
      },
    });
  });

  it('falls back to machine family for a derived profile', () => {
    expect(
      findCncMachineStarter({
        profileId: 'custom-derived-profile',
        machineFamily: 'neotronics-4040-max',
      }),
    ).toMatchObject({
      matchedBy: 'machine-family',
      matchedValue: 'neotronics-4040-max',
    });
  });

  it('returns null when neither profile identity matches', () => {
    expect(
      findCncMachineStarter({ profileId: 'unrelated', machineFamily: 'unrelated-family' }),
    ).toBeNull();
  });

  it('looks up persisted starter provenance by id', () => {
    expect(findCncMachineStarterById('neotronics-4040-shallow-wood-mdf')).toMatchObject({
      label: 'Neotronics 4040 shallow wood / MDF starter',
      revision: 1,
    });
    expect(findCncMachineStarterById('unknown-starter')).toBeNull();
  });
});
