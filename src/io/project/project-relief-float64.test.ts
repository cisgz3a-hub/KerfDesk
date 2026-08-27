import { expect, it } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import type { MeshReliefObject } from '../../core/scene/relief';
import { deserializeProject } from './deserialize-project';
import { prepareProjectForPersistence } from './prepare-project-persistence';

it('round-trips a finite Float64 mesh without using its iterator', () => {
  const meshPositions = Float64Array.from([0, 0, 0, 2, 0, 1e39, 0, 1.5, 0]);
  Object.defineProperty(meshPositions, Symbol.iterator, {
    value: (): never => {
      throw new Error('typed mesh iterator must not be used during persistence');
    },
  });
  const base = createProject();
  const relief: MeshReliefObject = {
    kind: 'relief',
    id: 'R1',
    source: 'finite-overflow.stl',
    targetWidthMm: 2,
    reliefDepthMm: 1,
    reliefSource: { kind: 'legacy-mesh', meshPositions, emptyCells: 'floor' },
    color: '#a0522d',
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 1.5 },
    transform: IDENTITY_TRANSFORM,
  };
  const project: Project = {
    ...base,
    scene: {
      objects: [relief],
      layers: [createLayer({ id: 'L1', color: '#a0522d' })],
    },
  };

  const prepared = prepareProjectForPersistence(project);

  expect(prepared.kind).toBe('ok');
  if (prepared.kind !== 'ok') return;
  const result = deserializeProject(prepared.json);
  expect(result.kind).toBe('ok');
  if (result.kind !== 'ok') return;
  const restored = result.project.scene.objects[0];
  expect(
    restored?.kind === 'relief' && restored.reliefSource.kind === 'legacy-mesh'
      ? restored.reliefSource.meshPositions
      : null,
  ).toEqual([0, 0, 0, 2, 0, 1e39, 0, 1.5, 0]);
});
