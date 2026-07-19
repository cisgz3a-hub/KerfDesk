import { describe, expect, it } from 'vitest';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../devices';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../scene';
import {
  resolveCncAutoLayerSettings,
  resolveCncMaterialFeedPatch,
} from './resolve-cnc-auto-settings';

describe('resolveCncAutoLayerSettings', () => {
  it('returns the exact Neotronics 4040 starter for a fresh operation', () => {
    expect(
      resolveCncAutoLayerSettings({
        profile: NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
        machine: DEFAULT_CNC_MACHINE_CONFIG,
      }),
    ).toMatchObject({
      toolId: 'em-3175',
      feedMmPerMin: 600,
      plungeMmPerMin: 120,
      spindleRpm: 12000,
      depthPerPassMm: 0.75,
      feedSource: {
        kind: 'machine-starter',
        starterId: 'neotronics-4040-shallow-wood-mdf',
        revision: 1,
      },
    });
  });

  it('derates the generic MDF recipe to the 4040 starter limits', () => {
    const machine = {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      stock: {
        ...DEFAULT_CNC_MACHINE_CONFIG.stock,
        materialKey: 'plywood-mdf',
      },
    };

    expect(
      resolveCncAutoLayerSettings({
        profile: NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
        machine,
      }),
    ).toMatchObject({
      materialKey: 'plywood-mdf',
      feedMmPerMin: 600,
      plungeMmPerMin: 120,
      spindleRpm: 12000,
      depthPerPassMm: 0.75,
      feedSource: {
        kind: 'material-recipe',
        materialKey: 'plywood-mdf',
        fluteCount: 2,
      },
    });
  });

  it('lowers future starter values to the slower live XY rate and live Z rate', () => {
    expect(
      resolveCncAutoLayerSettings({
        profile: NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
        machine: DEFAULT_CNC_MACHINE_CONFIG,
        liveCaps: {
          xMaxFeedMmPerMin: 500,
          yMaxFeedMmPerMin: 450,
          zMaxFeedMmPerMin: 90,
        },
      }),
    ).toMatchObject({
      feedMmPerMin: 450,
      plungeMmPerMin: 90,
      spindleRpm: 12000,
      depthPerPassMm: 0.75,
    });
  });

  it('never suggests spindle RPM above the compile-authoritative CNC machine ceiling', () => {
    const machine = {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      params: { ...DEFAULT_CNC_MACHINE_CONFIG.params, spindleMaxRpm: 8_000 },
    };

    expect(
      resolveCncAutoLayerSettings({
        profile: NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
        machine,
      }),
    ).toMatchObject({ spindleRpm: 8_000 });
  });

  it('does not stamp a starter tool id that is absent from the machine tool library', () => {
    const machine = {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      tools: [{ id: 'custom-6mm', name: 'Custom 6 mm', kind: 'end-mill' as const, diameterMm: 6 }],
      toolId: 'custom-6mm',
    };

    expect(
      resolveCncAutoLayerSettings({
        profile: NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
        machine,
      }),
    ).toBeNull();
  });

  it('rejects a reused starter id whose cutter geometry does not match the catalog', () => {
    const machine = {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      tools: [{ id: 'em-3175', name: 'Tiny impostor', kind: 'end-mill' as const, diameterMm: 0.5 }],
      toolId: 'em-3175',
    };

    expect(
      resolveCncAutoLayerSettings({
        profile: NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
        machine,
      }),
    ).toBeNull();
  });
});

describe('resolveCncMaterialFeedPatch', () => {
  it('applies live XY and Z caps after material calculation', () => {
    expect(
      resolveCncMaterialFeedPatch({
        profile: NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
        tool: DEFAULT_CNC_MACHINE_CONFIG.tools[0]!,
        materialKey: 'plywood-mdf',
        spindleRpm: 12000,
        machineSpindleMaxRpm: 12000,
        fluteCount: 2,
        liveCaps: {
          xMaxFeedMmPerMin: 500,
          yMaxFeedMmPerMin: 450,
          zMaxFeedMmPerMin: 90,
        },
      }),
    ).toMatchObject({
      feedMmPerMin: 450,
      plungeMmPerMin: 90,
      spindleRpm: 12000,
      depthPerPassMm: 0.75,
    });
  });
});
