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
    };
    const result = migrateToCurrent({ schemaVersion: 0 }, 0, registry);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.steps).toEqual([0, 1]);
      expect(result.raw['addedAtV0']).toBe(true);
      expect(result.raw['addedAtV1']).toBe(true);
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
      steps: [1],
      raw: {
        schemaVersion: 2,
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
});
