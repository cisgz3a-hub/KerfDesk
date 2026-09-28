import { describe, expect, it } from 'vitest';
import {
  captureLayerOperationSettings,
  createLayer,
  createLayerSubLayer,
  createProject,
  IDENTITY_TRANSFORM,
  LAYER_DEFAULTS,
  type Layer,
  type Project,
} from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

const TAB_SETTINGS = {
  tabLayout: 'spacing',
  tabSpacingMm: 35,
  tabMaxPerShape: 6,
  tabCutPowerPercent: 20,
} as const;

const ANCHOR = { layerColor: '#ff0000', pathIndex: 0, polylineIndex: 0, pathT: 0.25 };

function projectWith(settings: Partial<Layer>): Project {
  const base = createLayer({ id: 'L1', color: '#ff0000' });
  const layer: Layer = {
    ...base,
    ...settings,
    subLayers: [
      createLayerSubLayer(base, {
        id: 'S1',
        label: 'Tabs',
        settings: { ...captureLayerOperationSettings(base), tabCutPowerPercent: 40 },
      }),
    ],
  };
  return {
    ...createProject(),
    scene: {
      layers: [layer],
      objects: [
        {
          kind: 'imported-svg',
          id: 'O1',
          source: 'o1.svg',
          bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
          transform: IDENTITY_TRANSFORM,
          operationIds: ['L1'],
          operationOverride: { byOperation: { L1: { tabLayout: 'count', tabMaxPerShape: 0 } } },
          laserTabAnchors: [ANCHOR],
          paths: [
            {
              color: '#ff0000',
              polylines: [
                {
                  closed: true,
                  points: [
                    { x: 0, y: 0 },
                    { x: 10, y: 0 },
                    { x: 10, y: 10 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

function rawProject(): {
  scene: {
    layers: Array<Record<string, unknown>>;
    objects: Array<Record<string, unknown>>;
  };
} {
  return JSON.parse(serializeProject(projectWith({}))) as ReturnType<typeof rawProject>;
}

describe('ADR-494 laser tab settings in project files', () => {
  it('round-trips the tab settings, overrides, sub-operations and placed tabs', () => {
    const project = projectWith(TAB_SETTINGS);
    const loaded = deserializeProject(serializeProject(project));
    if (loaded.kind !== 'ok') throw new Error(`Expected load, got ${loaded.kind}`);
    const [layer] = loaded.project.scene.layers;
    expect(layer).toMatchObject(TAB_SETTINGS);
    expect(layer?.subLayers[0]?.settings.tabCutPowerPercent).toBe(40);
    const [object] = loaded.project.scene.objects;
    expect(object?.operationOverride).toEqual({
      byOperation: { L1: { tabLayout: 'count', tabMaxPerShape: 0 } },
    });
    expect(object?.laserTabAnchors).toEqual([ANCHOR]);
    expect(loaded.project.schemaVersion).toBe(project.schemaVersion);
  });

  it.each([
    { tabLayout: 'even' },
    { tabSpacingMm: 0 },
    { tabSpacingMm: -5 },
    { tabMaxPerShape: -1 },
    { tabMaxPerShape: 2.5 },
    { tabCutPowerPercent: -1 },
    { tabCutPowerPercent: 101 },
    { tabCutPowerPercent: 'half' },
  ])('rejects an invalid stored value (%o)', (bad) => {
    const raw = rawProject();
    raw.scene.layers[0] = { ...raw.scene.layers[0], ...bad };
    expect(deserializeProject(JSON.stringify(raw)).kind).toBe('invalid');
  });

  it.each([
    [{ ...ANCHOR, pathT: 1.5 }],
    [{ ...ANCHOR, pathIndex: -1 }],
    [{ ...ANCHOR, layerColor: 7 }],
    'not-a-list',
  ])('rejects invalid placed tabs (%o)', (anchors) => {
    const raw = rawProject();
    raw.scene.objects[0] = { ...raw.scene.objects[0], laserTabAnchors: anchors };
    expect(deserializeProject(JSON.stringify(raw)).kind).toBe('invalid');
  });

  it('accepts the limits of each range', () => {
    const raw = rawProject();
    raw.scene.layers[0] = {
      ...raw.scene.layers[0],
      tabSpacingMm: 0.01,
      tabMaxPerShape: 0,
      tabCutPowerPercent: 100,
    };
    expect(deserializeProject(JSON.stringify(raw)).kind).toBe('ok');
  });

  it('captures the settings only when an operation sets them, so older recipes still match', () => {
    const plain = captureLayerOperationSettings({ ...LAYER_DEFAULTS, mode: 'line' });
    for (const key of Object.keys(TAB_SETTINGS)) expect(Object.keys(plain)).not.toContain(key);
    expect(captureLayerOperationSettings({ ...LAYER_DEFAULTS, ...TAB_SETTINGS })).toMatchObject(
      TAB_SETTINGS,
    );
  });
});
