import { describe, expect, it } from 'vitest';
import {
  createProject,
  IDENTITY_TRANSFORM,
  PROJECT_SCHEMA_VERSION,
  type ImportedSvg,
} from '../../core/scene';
import { serializeProject } from './serialize-project';
import { deserializeProject, deserializeProjectValue } from './deserialize-project';

function projectWithPath(fields: Record<string, unknown> = {}) {
  return {
    ...createProject(),
    scene: {
      objects: [
        {
          kind: 'imported-svg',
          id: 'converted',
          source: 'converted paths',
          transform: IDENTITY_TRANSFORM,
          bounds: { minX: 0, minY: 0, maxX: 8, maxY: 4 },
          paths: [
            {
              color: '#000000',
              polylines: [
                {
                  closed: false,
                  points: [
                    { x: 0, y: 0 },
                    { x: 8, y: 4 },
                  ],
                },
              ],
              ...fields,
            },
          ],
        },
      ],
      layers: [],
    },
  };
}

describe('version 7 converted path semantics', () => {
  it('round trips explicit winding and anisotropic stroke pens without normalization', () => {
    const raw = projectWithPath({
      fillRule: 'nonzero',
      strokeWidthMm: 0.5,
      strokeTransform: { a: 2, b: 0.25, c: -0.1, d: 0.5 },
    });
    const parsed = deserializeProjectValue(raw);
    if (parsed.kind !== 'ok') throw new Error(JSON.stringify(parsed));
    const written = serializeProject(parsed.project);
    expect(JSON.parse(written).schemaVersion).toBe(7);
    const loaded = deserializeProject(written);
    if (loaded.kind !== 'ok') throw new Error(JSON.stringify(loaded));
    expect((loaded.project.scene.objects[0] as ImportedSvg).paths[0]).toMatchObject(
      raw.scene.objects[0]!.paths[0]!,
    );
  });

  it.each([
    { fillRule: 'winding' },
    { strokeTransform: { a: 2, b: 0, c: 0, d: 0.5 } },
    { strokeWidthMm: 0.5, strokeTransform: { a: 2, b: 0, d: 0.5 } },
    { strokeWidthMm: 0.5, strokeTransform: { a: Infinity, b: 0, c: 0, d: 0.5 } },
    { strokeWidthMm: 0.5, strokeTransform: { a: 1e300, b: 0, c: 0, d: 1e300 } },
  ])('rejects malformed cutter-relevant metadata %j', (fields) => {
    expect(deserializeProjectValue(projectWithPath(fields)).kind).toBe('invalid');
  });

  it('migrates version 6 without inventing fill or pen metadata', () => {
    const legacy = { ...projectWithPath(), schemaVersion: 6 };
    const loaded = deserializeProjectValue(legacy);
    if (loaded.kind !== 'ok') throw new Error(JSON.stringify(loaded));
    expect(loaded.migratedFrom).toBe(6);
    expect(loaded.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect((loaded.project.scene.objects[0] as ImportedSvg).paths).toEqual(
      legacy.scene.objects[0]!.paths,
    );
  });
});
