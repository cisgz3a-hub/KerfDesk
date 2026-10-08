import { describe, expect, it } from 'vitest';
import { DEFAULT_CNC_LAYER_SETTINGS, createLayer, createProject } from '../../core/scene';
import { DEFAULT_CNC_TAPERED_INLAY } from '../../core/scene/cnc-tapered-inlay';
import { prepareProjectForPersistence } from './prepare-project-persistence';
import { deserializeProject } from './deserialize-project';

function project() {
  const base = createProject();
  return {
    ...base,
    scene: {
      ...base.scene,
      layers: [
        {
          ...createLayer({ id: 'pair', color: '#000000' }),
          cnc: {
            ...DEFAULT_CNC_LAYER_SETTINGS,
            cutType: 'inlay-pair' as const,
            taperedInlay: { ...DEFAULT_CNC_TAPERED_INLAY, pocketStartDepthMm: 0.4 },
            pocketRestStock: {
              kind: 'rough-stage-stock' as const,
              previousToolId: 'em-6350',
              previousToolDiameterMm: 6.35,
              toleranceMm: 0.01,
            },
            stageRecipes: {
              'relief-rest-finish': {
                toolId: 'fine',
                feedMmPerMin: 500,
                plungeMmPerMin: 100,
                spindleRpm: 10000,
                depthPerPassMm: 0.2,
              },
            },
            feedMmPerMin: 723,
          },
        },
      ],
    },
  };
}

describe('retained tapered inlay and previous-stock intent persistence', () => {
  it('roundtrips independent planes, gaps, cutter source and rest recipe without changing explicit feeds', () => {
    const source = project();
    const prepared = prepareProjectForPersistence(source);
    if (prepared.kind !== 'ok') throw new Error(prepared.reason);
    const loaded = deserializeProject(prepared.json);
    if (loaded.kind !== 'ok') throw new Error('Load failed');
    const settings = loaded.project.scene.layers[0]?.cnc;
    expect(settings?.taperedInlay).toEqual(source.scene.layers[0]?.cnc.taperedInlay);
    expect(settings?.pocketRestStock).toEqual(source.scene.layers[0]?.cnc.pocketRestStock);
    expect(settings?.stageRecipes?.['relief-rest-finish']).toEqual(
      source.scene.layers[0]?.cnc.stageRecipes['relief-rest-finish'],
    );
    expect(settings?.feedMmPerMin).toBe(723);
  });

  it('does not invent tapered or stock intent for legacy operations', () => {
    const source = project();
    const legacy = {
      ...source,
      scene: {
        ...source.scene,
        layers: [
          {
            ...createLayer({ id: 'old', color: '#000000' }),
            cnc: {
              ...DEFAULT_CNC_LAYER_SETTINGS,
              cutType: 'inlay-pair' as const,
              inlayPocketDepthMm: 2,
              depthMm: 6,
            },
          },
        ],
      },
    };
    const loaded = deserializeProject(JSON.stringify(legacy));
    if (loaded.kind !== 'ok') throw new Error('Load failed');
    expect(loaded.project.scene.layers[0]?.cnc?.taperedInlay).toBeUndefined();
    expect(loaded.project.scene.layers[0]?.cnc?.pocketRestStock).toBeUndefined();
    expect(loaded.project.scene.layers[0]?.cnc?.inlayPocketDepthMm).toBe(2);
  });
});
