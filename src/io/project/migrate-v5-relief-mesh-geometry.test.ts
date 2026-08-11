import { describe, expect, it } from 'vitest';
import { testLegacyMeshGeometry } from '../../__fixtures__/legacy-relief';
import {
  createLayer,
  createProject,
  DEFAULT_RELIEF_LAYER_COLOR,
  IDENTITY_TRANSFORM,
} from '../../core/scene';
import type { MeshReliefObject } from '../../core/scene/relief';
import { deserializeProject } from './deserialize-project';
import { migrateV4ReliefMeshGeometry } from './migrate-v5-relief-mesh-geometry';
import { prepareProjectForPersistence } from './prepare-project-persistence';
import { serializeProject } from './serialize-project';

describe('migrateV4ReliefMeshGeometry', () => {
  it('persists exact Float32 intrinsic bounds and the legacy CAM target height', () => {
    const raw = projectWithMesh([0.1, 0.2, 0.3, 2.0000001, 0, 1, 0, 1.5000001, 0]);

    const migrated = migrateV4ReliefMeshGeometry(raw);

    expect(migrated).toMatchObject({ schemaVersion: 5 });
    expect(sourceOf(migrated)).toEqual({
      kind: 'legacy-mesh',
      meshPositions: [0.1, 0.2, 0.3, 2.0000001, 0, 1, 0, 1.5000001, 0],
      emptyCells: 'floor',
      intrinsicBounds: {
        kind: 'finite-float32-v1',
        minX: Math.fround(0),
        minY: Math.fround(0),
        minZ: Math.fround(0),
        maxX: Math.fround(2.0000001),
        maxY: Math.fround(1.5000001),
        maxZ: Math.fround(1),
      },
    });
    expect(reliefOf(migrated)).toMatchObject({
      targetHeightMm: (Math.fround(1.5000001) / Math.fround(2.0000001)) * 100,
      widthAspect: 'preserve',
    });
  });

  it('preserves a v4 Float32-overflow source as an openable non-finite intrinsic source', () => {
    const raw = projectWithMesh([0, 0, 0, 2, 0, Number.MAX_VALUE, 0, 1.5, 0]);

    const migrated = migrateV4ReliefMeshGeometry(raw);

    expect(sourceOf(migrated)).toMatchObject({
      intrinsicBounds: { kind: 'non-finite-float32-v1' },
    });
    expect(reliefOf(migrated)).toMatchObject({
      targetHeightMm: 75,
      widthAspect: 'stretch',
    });
  });

  it('leaves non-relief objects and canonical heightfields byte-authority neutral', () => {
    const raw = projectWithMesh([0, 0, 0, 2, 0, 1, 0, 1.5, 0]);
    const scene = raw['scene'] as { objects: unknown[] };
    const legacy = scene.objects[0];
    const heightfield = { kind: 'relief', reliefSource: { kind: 'heightfield-v1' } };
    const shape = { kind: 'shape', id: 'shape' };
    scene.objects = [legacy, heightfield, shape];

    const migrated = migrateV4ReliefMeshGeometry(raw);
    const objects = (migrated['scene'] as { objects: unknown[] }).objects;

    expect(objects[1]).toBe(heightfield);
    expect(objects[2]).toBe(shape);
  });

  it('opens a real v4 mesh project, persists v5 geometry, and saves it again', () => {
    const positions = [0, 0, 0, 2, 0, 1, 0, 1.5, 0];
    const relief: MeshReliefObject = {
      kind: 'relief',
      id: 'legacy-v4',
      source: 'legacy-v4.stl',
      targetWidthMm: 100,
      reliefDepthMm: 5,
      ...testLegacyMeshGeometry({ positions, targetWidthMm: 100 }),
      color: DEFAULT_RELIEF_LAYER_COLOR,
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 75 },
      transform: IDENTITY_TRANSFORM,
    };
    const project = createProject();
    const raw = JSON.parse(
      serializeProject({
        ...project,
        scene: {
          objects: [relief],
          layers: [
            createLayer({ id: DEFAULT_RELIEF_LAYER_COLOR, color: DEFAULT_RELIEF_LAYER_COLOR }),
          ],
        },
      }),
    ) as Record<string, unknown>;
    raw['schemaVersion'] = 4;
    const object = reliefOf(raw);
    delete object['targetHeightMm'];
    delete object['widthAspect'];
    delete sourceOf(raw)['intrinsicBounds'];

    const opened = deserializeProject(JSON.stringify(raw));

    expect(opened.kind).toBe('ok');
    if (opened.kind !== 'ok') return;
    expect(opened.migratedFrom).toBe(4);
    expect(opened.project.scene.objects[0]).toMatchObject({
      targetHeightMm: 75,
      widthAspect: 'preserve',
      reliefSource: { intrinsicBounds: { kind: 'finite-float32-v1' } },
    });
    expect(prepareProjectForPersistence(opened.project).kind).toBe('ok');
  });
});

function projectWithMesh(meshPositions: ReadonlyArray<number>): Record<string, unknown> {
  return {
    schemaVersion: 4,
    scene: {
      objects: [
        {
          kind: 'relief',
          targetWidthMm: 100,
          bounds: { minX: 0, minY: 0, maxX: 100, maxY: 75 },
          reliefSource: { kind: 'legacy-mesh', meshPositions, emptyCells: 'floor' },
        },
      ],
    },
  };
}

function sourceOf(raw: Record<string, unknown>): Record<string, unknown> {
  const scene = raw['scene'] as { objects: Array<{ reliefSource: Record<string, unknown> }> };
  return scene.objects[0]?.reliefSource ?? {};
}

function reliefOf(raw: Record<string, unknown>): Record<string, unknown> {
  const scene = raw['scene'] as { objects: Array<Record<string, unknown>> };
  return scene.objects[0] ?? {};
}
