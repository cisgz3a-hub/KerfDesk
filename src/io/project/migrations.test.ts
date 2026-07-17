import { describe, expect, it } from 'vitest';
import { PROJECT_SCHEMA_VERSION } from '../../core/scene';
import { migrateToCurrent, type Migrator } from './migrations';

describe('migrateToCurrent', () => {
  it('returns ok with no steps when sawVersion equals current', () => {
    const result = migrateToCurrent(
      { schemaVersion: PROJECT_SCHEMA_VERSION },
      PROJECT_SCHEMA_VERSION,
    );
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.steps).toEqual([]);
  });

  it('reports no-path when no migrator covers the first gap', () => {
    expect(migrateToCurrent({}, 0).kind).toBe('no-path');
  });

  it('walks the registry from sawVersion upward', () => {
    const registry: Readonly<Record<number, Migrator>> = {
      0: (raw) => ({ ...raw, addedAtV0: true }),
      1: (raw) => ({ ...raw, addedAtV1: true }),
      2: (raw) => ({ ...raw, addedAtV2: true }),
    };
    const result = migrateToCurrent({ schemaVersion: 0 }, 0, registry);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.steps).toEqual([0, 1, 2]);
      expect(result.raw['addedAtV0']).toBe(true);
      expect(result.raw['addedAtV1']).toBe(true);
      expect(result.raw['addedAtV2']).toBe(true);
      expect(result.raw['schemaVersion']).toBe(PROJECT_SCHEMA_VERSION);
    }
  });

  it('migrates every v1 polyline into deterministic line segments', () => {
    const result = migrateToCurrent(
      {
        schemaVersion: 1,
        scene: {
          objects: [
            {
              paths: [
                {
                  color: '#000000',
                  polylines: [
                    {
                      closed: false,
                      points: [
                        { x: 1, y: 2 },
                        { x: 3, y: 4 },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      1,
    );
    expect(result).toMatchObject({
      kind: 'ok',
      steps: [1, 2],
      raw: {
        schemaVersion: 3,
        scene: {
          objects: [
            {
              paths: [
                {
                  curves: [
                    {
                      start: { x: 1, y: 2 },
                      segments: [{ kind: 'line', to: { x: 3, y: 4 } }],
                      closed: false,
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    });
  });

  it('drops an empty v1 polyline instead of inventing a {0,0} curve start', () => {
    // Audit 2026-07-17-0550 P3-3: a zero-point legacy polyline used to become
    // { start: {0,0}, segments: [] } — a phantom origin point the source file
    // never contained. It must vanish from BOTH channels so they stay paired.
    const result = migrateToCurrent(
      {
        schemaVersion: 1,
        scene: {
          objects: [
            {
              paths: [
                {
                  color: '#000000',
                  polylines: [
                    { closed: false, points: [] },
                    {
                      closed: false,
                      points: [
                        { x: 1, y: 2 },
                        { x: 3, y: 4 },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      1,
    );
    if (result.kind !== 'ok') throw new Error('expected ok migration');
    const scene = result.raw['scene'] as {
      objects: Array<{ paths: Array<{ polylines: unknown[]; curves: unknown[] }> }>;
    };
    const path = scene.objects[0]?.paths[0];
    expect(path?.polylines).toHaveLength(1);
    expect(path?.curves).toEqual([
      {
        start: { x: 1, y: 2 },
        segments: [{ kind: 'line', to: { x: 3, y: 4 } }],
        closed: false,
      },
    ]);
  });

  it('migrates v2 colors, object overrides, and sub-layers to explicit operations', () => {
    const result = migrateToCurrent(
      {
        schemaVersion: 2,
        scene: {
          layers: [
            {
              id: 'black',
              color: '#000000',
              mode: 'line',
              visible: true,
              output: true,
              subLayers: [
                {
                  id: 'sub-1',
                  label: 'Outline after fill',
                  enabled: true,
                  settings: { mode: 'fill', power: 20 },
                },
              ],
            },
          ],
          objects: [
            {
              kind: 'imported-svg',
              id: 'johann',
              source: 'Johann.svg',
              operationOverride: { power: 55 },
              paths: [{ color: '#000000', polylines: [] }],
            },
          ],
        },
      },
      2,
    );
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const scene = result.raw['scene'] as {
      layers: Array<Record<string, unknown>>;
      objects: Array<Record<string, unknown>>;
    };
    expect(scene.layers.map((layer) => layer['name'])).toEqual([
      'Operation 1',
      'Johann - Operation 1',
      'Outline after fill',
      'Johann - Outline after fill',
    ]);
    expect(scene.layers.filter((layer) => layer['power'] === 55)).toHaveLength(2);
    expect(scene.layers.every((layer) => Array.isArray(layer['subLayers']))).toBe(true);
    expect(scene.objects[0]?.['operationOverride']).toBeUndefined();
    const paths = scene.objects[0]?.['paths'] as Array<Record<string, unknown>>;
    expect(paths[0]?.['operationIds']).toEqual([
      'black:artwork-johann',
      'black:sub-1:artwork-johann',
    ]);
  });
});
