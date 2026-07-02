import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type ReliefObject,
} from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

function relief(): ReliefObject {
  return {
    kind: 'relief',
    id: 'R1',
    source: 'pyramid.stl',
    // One triangle is enough to exercise the schema.
    meshPositions: [0, 0, 0, 10, 0, 0, 0, 10, 5],
    targetWidthMm: 100,
    reliefDepthMm: 5,
    emptyCells: 'floor',
    color: '#a0522d',
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
  };
}

function reliefProject(): Project {
  const base = createProject();
  return {
    ...base,
    scene: {
      objects: [relief()],
      layers: [createLayer({ id: 'L1', color: '#a0522d' })],
    },
  };
}

describe('.lf2 relief round-trip (H.4)', () => {
  it('round-trips a relief object exactly', () => {
    const result = deserializeProject(serializeProject(reliefProject()));
    if (result.kind !== 'ok') throw new Error(`expected ok, got ${result.kind}`);
    expect(result.project.scene.objects[0]).toEqual(relief());
  });

  it('rejects a relief whose mesh is not a whole number of triangles', () => {
    const raw = JSON.parse(serializeProject(reliefProject())) as {
      scene: { objects: Array<Record<string, unknown>> };
    };
    const obj = raw.scene.objects[0] as Record<string, unknown>;
    obj['meshPositions'] = [0, 0, 0, 10]; // 4 numbers — not ×9
    const result = deserializeProject(`${JSON.stringify(raw)}\n`);
    expect(result.kind).not.toBe('ok');
  });

  it('rejects a relief with non-finite mesh numbers', () => {
    const raw = JSON.parse(serializeProject(reliefProject())) as {
      scene: { objects: Array<Record<string, unknown>> };
    };
    const obj = raw.scene.objects[0] as Record<string, unknown>;
    obj['meshPositions'] = [0, 0, 0, 10, 0, 0, 0, 10, 'five'];
    const result = deserializeProject(`${JSON.stringify(raw)}\n`);
    expect(result.kind).not.toBe('ok');
  });

  it('rejects a relief with a non-positive depth', () => {
    const raw = JSON.parse(serializeProject(reliefProject())) as {
      scene: { objects: Array<Record<string, unknown>> };
    };
    const obj = raw.scene.objects[0] as Record<string, unknown>;
    obj['reliefDepthMm'] = 0;
    const result = deserializeProject(`${JSON.stringify(raw)}\n`);
    expect(result.kind).not.toBe('ok');
  });
});
