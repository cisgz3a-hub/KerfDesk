import { describe, expect, it } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG, type CncMachineConfig } from '../../core/scene';
import { parseCncLibrary } from './cnc-library-persistence';

function parseStoredMachine(machine: unknown): CncMachineConfig {
  const parsed = parseCncLibrary(
    JSON.stringify({
      customTools: [],
      feedPresets: [],
      machineProfiles: [{ id: 'profile', name: 'Profile', machine }],
    }),
  );
  const stored = parsed?.machineProfiles[0]?.machine;
  if (stored === undefined) throw new Error('Stored CNC machine profile missing');
  return stored;
}

describe('CNC machine profile persistence', () => {
  it('repairs a persisted profile whose tool list contains only nulls', () => {
    const machine = parseStoredMachine({ kind: 'cnc', tools: [null], toolId: 'missing-tool' });

    expect(machine.tools).toEqual(DEFAULT_CNC_MACHINE_CONFIG.tools);
    expect(machine.toolId).toBe(DEFAULT_CNC_MACHINE_CONFIG.toolId);
  });

  it('selects the first valid custom tool when a persisted active id is stale', () => {
    const customTool = {
      id: 'custom-only-tool',
      name: 'Custom-only tool',
      kind: 'end-mill' as const,
      diameterMm: 4,
    };
    const machine = parseStoredMachine({
      kind: 'cnc',
      tools: [customTool],
      toolId: 'missing-tool',
    });

    expect(machine.tools).toEqual([customTool]);
    expect(machine.toolId).toBe(customTool.id);
  });

  it('normalizes profile metadata and parameters before apply', () => {
    const machine = parseStoredMachine({
      kind: 'cnc',
      stock: {
        thicknessMm: -1,
        widthMm: 420,
        heightMm: 'invalid',
        originOffset: { x: null, y: 4 },
        materialKey: 'unknown-material',
      },
      tools: [
        null,
        {
          id: 'catalog-tool',
          name: 'Catalog tool',
          kind: 'ball-nose',
          diameterMm: 3,
          family: 'ball-nose',
          shankDiameterMm: 6,
          fluteCount: 2,
          catalogId: 'ball-m300',
        },
        {
          id: 'bounded-tool',
          name: 'Bounded tool',
          kind: 'unknown-kind',
          diameterMm: 2,
          tipAngleDeg: 180,
          family: 'x'.repeat(121),
          shankDiameterMm: -6,
          fluteCount: 17,
          catalogId: 'x'.repeat(121),
        },
        { id: 'invalid-tool', name: 'Invalid tool', kind: 'end-mill', diameterMm: null },
      ],
      toolId: 'catalog-tool',
      params: {
        safeZMm: -1,
        spindleMaxRpm: 'fast',
        spindleSpinupSec: -1,
        coolant: 'invalid',
        parkXMm: 'invalid',
        parkYMm: 42,
      },
    });

    expect(machine.stock).toEqual({ ...DEFAULT_CNC_MACHINE_CONFIG.stock, widthMm: 420 });
    expect(machine.tools).toEqual([
      {
        id: 'catalog-tool',
        name: 'Catalog tool',
        kind: 'ball-nose',
        diameterMm: 3,
        family: 'ball-nose',
        shankDiameterMm: 6,
        fluteCount: 2,
        catalogId: 'ball-m300',
      },
      { id: 'bounded-tool', name: 'Bounded tool', kind: 'end-mill', diameterMm: 2 },
    ]);
    expect(machine.toolId).toBe('catalog-tool');
    expect(machine.params).toEqual({ ...DEFAULT_CNC_MACHINE_CONFIG.params, parkYMm: 42 });
  });
});
