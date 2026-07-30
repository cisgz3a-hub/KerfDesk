import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type ReliefObject,
} from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { prepareProjectForPersistence } from './prepare-project-persistence';
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

// ADR-268 follow-up: import demoted the RELIEF_EMBED_TRIANGLE_LIMIT refusal to an
// advisory but the project validator kept refusing, so a dense STL imported and
// then could neither be saved nor reloaded — worse than the consistent refusal it
// replaced. Both ceilings are policy; the shape and finiteness checks are not.
describe('dense relief round-trips (no embed ceiling)', () => {
  it('serializes and reloads a relief far past the old 200k-triangle limit', () => {
    const triangles = 200_001;
    const meshPositions = new Array<number>(triangles * 9).fill(1);
    const base = createProject();
    const denseRelief = { ...relief(), meshPositions };
    const project: Project = {
      ...base,
      scene: { ...base.scene, objects: [denseRelief] },
    };

    const prepared = prepareProjectForPersistence(project);

    expect(prepared.kind).toBe('ok');
    if (prepared.kind !== 'ok') return;
    const reloaded = deserializeProject(prepared.json);
    expect(reloaded.kind).toBe('ok');
    if (reloaded.kind !== 'ok') return;
    const restored = reloaded.project.scene.objects[0];
    expect(restored?.kind).toBe('relief');
    if (restored?.kind !== 'relief') return;
    expect(restored.meshPositions).toHaveLength(triangles * 9);
  });
});
