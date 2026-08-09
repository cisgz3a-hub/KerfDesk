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

type MeshReliefObject = Exclude<ReliefObject, { readonly depthMap: unknown }>;
type DepthMapReliefObject = Extract<ReliefObject, { readonly depthMap: unknown }>;

function relief(): MeshReliefObject {
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

function depthMapRelief(): DepthMapReliefObject {
  return {
    kind: 'relief',
    id: 'D1',
    source: 'portrait-depth.png',
    depthMap: {
      schemaVersion: 1,
      width: 2,
      height: 2,
      bitDepth: 8,
      samplesBase64: Buffer.from([0, 64, 128, 255]).toString('base64'),
      polarity: 'light-is-high',
    },
    targetWidthMm: 100,
    reliefDepthMm: 5,
    color: '#a0522d',
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
  };
}

describe('.lf2 relief round-trip (H.4)', () => {
  it('round-trips a relief object exactly', () => {
    const result = deserializeProject(serializeProject(reliefProject()));
    if (result.kind !== 'ok') throw new Error(`expected ok, got ${result.kind}`);
    expect(result.project.scene.objects[0]).toEqual(relief());
  });

  it('serializes a worker-owned Float32Array mesh and reopens it as project JSON', () => {
    const typedRelief = {
      ...relief(),
      meshPositions: Float32Array.from(relief().meshPositions),
    };
    const project = reliefProject();
    const result = deserializeProject(
      serializeProject({
        ...project,
        scene: { ...project.scene, objects: [typedRelief] },
      }),
    );

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.project.scene.objects[0]).toEqual(relief());
  });

  it('serializes a typed mesh without iterating it into a boxed array', () => {
    const meshPositions = Float32Array.from([
      0,
      -0,
      1 / 3,
      1e-7,
      1e20,
      -1.25,
      3.402_823_5e38,
      1.175_494e-38,
      42,
    ]);
    const base = reliefProject();
    const plainProject: Project = {
      ...base,
      scene: {
        ...base.scene,
        objects: [{ ...relief(), meshPositions: Array.from(meshPositions) }],
      },
    };
    const expected = serializeProject(plainProject);
    Object.defineProperty(meshPositions, Symbol.iterator, {
      value: (): never => {
        throw new Error('typed mesh iterator must not be used during persistence');
      },
    });
    const typedProject: Project = {
      ...plainProject,
      scene: {
        ...plainProject.scene,
        objects: [{ ...relief(), meshPositions }],
      },
    };

    expect(serializeProject(typedProject)).toBe(expected);
  });

  it('still rejects non-finite typed mesh coordinates without using their iterator', () => {
    const meshPositions = Float32Array.from([0, 0, 0, 10, 0, 0, 0, 10, Number.NaN]);
    Object.defineProperty(meshPositions, Symbol.iterator, {
      value: (): never => {
        throw new Error('invalid typed mesh iterator must not be used during persistence');
      },
    });
    const base = reliefProject();
    const project: Project = {
      ...base,
      scene: { ...base.scene, objects: [{ ...relief(), meshPositions }] },
    };

    expect(prepareProjectForPersistence(project)).toMatchObject({ kind: 'invalid' });
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

describe('.lf2 depth-map relief round-trip (ADR-290)', () => {
  it('round-trips the exact source payload, precision, and polarity', () => {
    const base = reliefProject();
    const project: Project = {
      ...base,
      scene: { ...base.scene, objects: [depthMapRelief()] },
    };

    const result = deserializeProject(serializeProject(project));

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.project.scene.objects[0]).toEqual(depthMapRelief());
  });

  it('preserves an existing authored-width and transform pair byte-for-byte', () => {
    const base = reliefProject();
    const transformed = {
      ...depthMapRelief(),
      transform: { ...IDENTITY_TRANSFORM, scaleX: -0.36, scaleY: 2 },
    };
    const serialized = serializeProject({
      ...base,
      scene: { ...base.scene, objects: [transformed], groups: [] },
    });

    const result = deserializeProject(serialized);

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.project.scene.objects[0]).toEqual(transformed);
    expect(serializeProject(result.project)).toBe(serialized);
  });

  it('rejects a payload whose byte length disagrees with its dimensions', () => {
    const base = reliefProject();
    const broken = {
      ...depthMapRelief(),
      depthMap: { ...depthMapRelief().depthMap, samplesBase64: 'AA==' },
    };
    const raw = JSON.parse(
      serializeProject({ ...base, scene: { ...base.scene, objects: [broken] } }),
    ) as { scene: { objects: Array<Record<string, unknown>> } };

    expect(deserializeProject(JSON.stringify(raw)).kind).not.toBe('ok');
  });

  it('rejects ambiguous objects that carry both mesh and depth-map sources', () => {
    const base = reliefProject();
    const raw = JSON.parse(
      serializeProject({ ...base, scene: { ...base.scene, objects: [depthMapRelief()] } }),
    ) as { scene: { objects: Array<Record<string, unknown>> } };
    const object = raw.scene.objects[0];
    if (object === undefined) throw new Error('fixture relief missing');
    const ambiguous = {
      ...raw,
      scene: {
        ...raw.scene,
        objects: [
          {
            ...object,
            meshPositions: [0, 0, 0, 1, 0, 0, 0, 1, 1],
            emptyCells: 'floor',
          },
        ],
      },
    };

    expect(deserializeProject(JSON.stringify(ambiguous)).kind).not.toBe('ok');
  });

  it('rejects depth-map bounds that disagree with source aspect and target width', () => {
    const base = reliefProject();
    const raw = JSON.parse(
      serializeProject({ ...base, scene: { ...base.scene, objects: [depthMapRelief()] } }),
    ) as { scene: { objects: Array<Record<string, unknown>> } };
    const object = raw.scene.objects[0];
    if (object === undefined) throw new Error('fixture relief missing');
    const mismatched = {
      ...raw,
      scene: {
        ...raw.scene,
        objects: [{ ...object, bounds: { minX: 0, minY: 0, maxX: 100, maxY: 75 } }],
      },
    };

    expect(deserializeProject(JSON.stringify(mismatched))).toMatchObject({ kind: 'invalid' });
  });
});

// ADR-268 follow-up: import demoted the RELIEF_EMBED_TRIANGLE_LIMIT refusal to an
// advisory but the project validator kept refusing, so a dense STL imported and
// then could neither be saved nor reloaded — worse than the consistent refusal it
// replaced. Both ceilings are policy; the shape and finiteness checks are not.
describe('dense relief round-trips (no embed ceiling)', () => {
  it('serializes and reloads a relief far past the old 200k-triangle limit', () => {
    const triangles = 200_001;
    const meshPositions = new Float32Array(triangles * 9).fill(1);
    Object.defineProperty(meshPositions, Symbol.iterator, {
      value: (): never => {
        throw new Error('dense typed mesh iterator must not be used during persistence');
      },
    });
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
