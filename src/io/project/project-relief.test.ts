import { describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import { decodeCanonicalBase64 } from '../../core/relief/depth-map-base64';
import { reliefHeightfieldDigest } from '../../core/relief/heightfield-digest';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import type { HeightfieldReliefObject, MeshReliefObject } from '../../core/scene/relief';
import { deserializeProject } from './deserialize-project';
import { prepareProjectForPersistence } from './prepare-project-persistence';
import {
  validateReliefHeightfield,
  type ReliefHeightfieldValidationRuntime,
} from './project-relief-heightfield-validator';
import { serializeProject } from './serialize-project';

function relief(): MeshReliefObject {
  return {
    kind: 'relief',
    id: 'R1',
    source: 'pyramid.stl',
    targetWidthMm: 100,
    reliefDepthMm: 5,
    reliefSource: {
      kind: 'legacy-mesh',
      // One triangle is enough to exercise the schema.
      meshPositions: [0, 0, 0, 10, 0, 0, 0, 10, 5],
      emptyCells: 'floor',
    },
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

function heightfieldRelief(): HeightfieldReliefObject {
  return {
    kind: 'relief',
    id: 'D1',
    source: 'portrait-depth.png',
    targetWidthMm: 100,
    reliefDepthMm: 5,
    reliefSource: testReliefHeightfield({
      width: 2,
      height: 2,
      physicalWidthMm: 100,
      physicalHeightMm: 100,
      maxDepthMm: 5,
      samplesU8: [0, 64, 128, 255],
      inclusionMask: [0, 127, 254, 255],
      mapping: {
        curve: { kind: 'gamma-v1', gamma: 3.25 },
        inclusionThreshold: 128,
        outsideMask: 'relief-floor',
      },
      provenance: { sourceName: 'portrait-depth.png' },
      revision: 3,
    }),
    color: '#a0522d',
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
  };
}

describe('.lf2 mesh relief round-trip', () => {
  it('round-trips a legacy mesh source exactly', () => {
    const result = deserializeProject(serializeProject(reliefProject()));
    if (result.kind !== 'ok') throw new Error(`expected ok, got ${result.kind}`);
    expect(result.project.scene.objects[0]).toEqual(relief());
  });

  it('serializes a worker-owned Float32Array mesh and reopens it as project JSON', () => {
    const typedRelief: MeshReliefObject = {
      ...relief(),
      reliefSource: {
        ...relief().reliefSource,
        meshPositions: Float32Array.from(relief().reliefSource.meshPositions),
      },
    };
    const project = reliefProject();
    const result = deserializeProject(
      serializeProject({ ...project, scene: { ...project.scene, objects: [typedRelief] } }),
    );

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.project.scene.objects[0]).toEqual(relief());
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
        objects: [withMeshPositions(Array.from(meshPositions))],
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
      scene: { ...plainProject.scene, objects: [withMeshPositions(meshPositions)] },
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
      scene: { ...base.scene, objects: [withMeshPositions(meshPositions)] },
    };

    expect(prepareProjectForPersistence(project)).toMatchObject({ kind: 'invalid' });
  });

  it('rejects malformed or non-finite mesh coordinates', () => {
    for (const meshPositions of [
      [0, 0, 0, 10],
      [0, 0, 0, 10, 0, 0, 0, 10, 'five'],
    ]) {
      const raw = rawProject(reliefProject());
      const source = rawReliefSource(raw);
      source['meshPositions'] = meshPositions;
      expect(deserializeProject(JSON.stringify(raw)).kind).not.toBe('ok');
    }
  });

  it('rejects a relief with a non-positive depth', () => {
    const raw = rawProject(reliefProject());
    rawRelief(raw)['reliefDepthMm'] = 0;
    expect(deserializeProject(JSON.stringify(raw)).kind).not.toBe('ok');
  });
});

describe('.lf2 canonical heightfield round-trip', () => {
  it('round-trips exact samples, mask, non-default gamma, provenance, revision, and digest', () => {
    const base = reliefProject();
    const project: Project = {
      ...base,
      scene: { ...base.scene, objects: [heightfieldRelief()] },
    };

    const result = deserializeProject(serializeProject(project));

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.project.scene.objects[0]).toEqual(heightfieldRelief());
  });

  it('preserves an existing authored-width and transform pair byte-for-byte', () => {
    const base = reliefProject();
    const transformed = {
      ...heightfieldRelief(),
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

  it('rejects a payload length that disagrees with declared dimensions', () => {
    const base = reliefProject();
    const project: Project = {
      ...base,
      scene: { ...base.scene, objects: [heightfieldRelief()] },
    };
    const raw = rawProject(project);
    rawReliefSource(raw)['samplesBase64'] = 'AA==';

    expect(deserializeProject(JSON.stringify(raw))).toMatchObject({ kind: 'invalid' });
  });

  it('reports a well-formed but wrong SHA-256 digest as a digest mismatch', () => {
    const base = reliefProject();
    const project: Project = {
      ...base,
      scene: { ...base.scene, objects: [heightfieldRelief()] },
    };
    const raw = rawProject(project);
    rawReliefSource(raw)['digest'] = `sha256:${'0'.repeat(64)}`;

    expect(deserializeProject(JSON.stringify(raw))).toEqual({
      kind: 'invalid',
      reason: 'digest mismatch in `scene.objects[0].reliefSource.digest`',
    });
  });

  it('reports sample, mask, and digest allocation failures without throwing', () => {
    const source = heightfieldRelief().reliefSource;
    const cases: ReadonlyArray<{
      readonly runtime: () => ReliefHeightfieldValidationRuntime;
      readonly field: string;
    }> = [
      {
        runtime: () => ({
          decodeBase64: () => ({
            kind: 'error',
            code: 'allocation',
            reason: 'controlled sample allocation failure',
          }),
          digest: reliefHeightfieldDigest,
        }),
        field: 'reliefSource.samplesBase64',
      },
      {
        runtime: () => {
          let decodeCount = 0;
          return {
            decodeBase64: (value) => {
              decodeCount += 1;
              return decodeCount === 1
                ? decodeCanonicalBase64(value)
                : {
                    kind: 'error',
                    code: 'allocation',
                    reason: 'controlled mask allocation failure',
                  };
            },
            digest: reliefHeightfieldDigest,
          };
        },
        field: 'reliefSource.inclusionMask.samplesBase64',
      },
      {
        runtime: () => ({
          decodeBase64: decodeCanonicalBase64,
          digest: () => {
            throw new RangeError('controlled digest allocation failure');
          },
        }),
        field: 'reliefSource.digest',
      },
    ];

    for (const { runtime, field } of cases) {
      let result: string | null | undefined;
      expect(() => {
        result = validateReliefHeightfield(source, 'reliefSource', runtime());
      }).not.toThrow();
      expect(result).toBe(`allocation failed for \`${field}\``);
    }
  });

  it('rejects legacy sibling fields and opposite source-arm fields', () => {
    const heightfieldBase = reliefProject();
    const heightfieldProject: Project = {
      ...heightfieldBase,
      scene: { ...heightfieldBase.scene, objects: [heightfieldRelief()] },
    };
    const cases: Array<ReturnType<typeof rawProject>> = [];
    for (const [field, value] of [
      ['depthMap', {}],
      ['meshPositions', [0, 0, 0, 1, 0, 0, 0, 1, 1]],
      ['emptyCells', 'floor'],
    ] as const) {
      const raw = rawProject(heightfieldProject);
      rawRelief(raw)[field] = value;
      cases.push(raw);
    }
    for (const [field, value] of [
      ['depthMap', {}],
      ['meshPositions', [0, 0, 0, 1, 0, 0, 0, 1, 1]],
      ['emptyCells', 'floor'],
    ] as const) {
      const raw = rawProject(heightfieldProject);
      rawReliefSource(raw)[field] = value;
      cases.push(raw);
    }
    for (const [field, value] of [
      ['depthMap', {}],
      ['samplesBase64', 'AA=='],
    ] as const) {
      const meshWithOppositeField = rawProject(reliefProject());
      rawReliefSource(meshWithOppositeField)[field] = value;
      cases.push(meshWithOppositeField);
    }

    for (const raw of cases) {
      expect(deserializeProject(JSON.stringify(raw))).toMatchObject({
        kind: 'invalid',
        reason: 'invalid `scene.objects[0]`: relief must contain exactly one source arm',
      });
    }
  });

  it('rejects a non-literal outside-mask value without invoking object coercion', () => {
    const base = reliefProject();
    const project: Project = {
      ...base,
      scene: { ...base.scene, objects: [heightfieldRelief()] },
    };
    const raw = rawProject(project);
    const source = rawReliefSource(raw);
    const mapping = source['mapping'];
    if (typeof mapping !== 'object' || mapping === null) throw new Error('mapping fixture missing');
    (mapping as Record<string, unknown>)['outsideMask'] = { toString: null };

    expect(() => deserializeProject(JSON.stringify(raw))).not.toThrow();
    expect(deserializeProject(JSON.stringify(raw))).toMatchObject({ kind: 'invalid' });
  });

  it('rejects an unsupported relief source discriminant', () => {
    const base = reliefProject();
    const project: Project = {
      ...base,
      scene: { ...base.scene, objects: [heightfieldRelief()] },
    };
    const raw = rawProject(project);
    rawReliefSource(raw)['kind'] = 'ambiguous-source';

    expect(deserializeProject(JSON.stringify(raw)).kind).not.toBe('ok');
  });

  it('rejects object dimensions or depth that disagree with the canonical source', () => {
    const base = reliefProject();
    const project: Project = {
      ...base,
      scene: { ...base.scene, objects: [heightfieldRelief()] },
    };
    const mutations = [
      (object: Record<string, unknown>) => {
        object['bounds'] = { minX: 0, minY: 0, maxX: 100, maxY: 75 };
      },
      (object: Record<string, unknown>) => {
        object['targetWidthMm'] = 75;
      },
      (object: Record<string, unknown>) => {
        object['reliefDepthMm'] = 4;
      },
    ];
    for (const mutation of mutations) {
      const raw = rawProject(project);
      mutation(rawRelief(raw));
      expect(deserializeProject(JSON.stringify(raw))).toMatchObject({ kind: 'invalid' });
    }
  });
});

describe('dense relief round-trips without an embed ceiling', () => {
  it('serializes and reloads a relief far past the former 200k-triangle policy limit', () => {
    const triangles = 200_001;
    const meshPositions = new Float32Array(triangles * 9).fill(1);
    Object.defineProperty(meshPositions, Symbol.iterator, {
      value: (): never => {
        throw new Error('dense typed mesh iterator must not be used during persistence');
      },
    });
    const base = createProject();
    const project: Project = {
      ...base,
      scene: { ...base.scene, objects: [withMeshPositions(meshPositions)] },
    };

    const prepared = prepareProjectForPersistence(project);

    expect(prepared.kind).toBe('ok');
    if (prepared.kind !== 'ok') return;
    const reloaded = deserializeProject(prepared.json);
    expect(reloaded.kind).toBe('ok');
    if (reloaded.kind !== 'ok') return;
    const restored = reloaded.project.scene.objects[0];
    expect(restored?.kind).toBe('relief');
    if (restored?.kind !== 'relief' || restored.reliefSource.kind !== 'legacy-mesh') return;
    expect(restored.reliefSource.meshPositions).toHaveLength(triangles * 9);
  });
});

function withMeshPositions(meshPositions: ReadonlyArray<number> | Float32Array): MeshReliefObject {
  return {
    ...relief(),
    reliefSource: { ...relief().reliefSource, meshPositions },
  };
}

function rawProject(project: Project): { scene: { objects: Array<Record<string, unknown>> } } {
  return JSON.parse(serializeProject(project)) as {
    scene: { objects: Array<Record<string, unknown>> };
  };
}

function rawRelief(raw: {
  scene: { objects: Array<Record<string, unknown>> };
}): Record<string, unknown> {
  const object = raw.scene.objects[0];
  if (object === undefined) throw new Error('fixture relief missing');
  return object;
}

function rawReliefSource(raw: {
  scene: { objects: Array<Record<string, unknown>> };
}): Record<string, unknown> {
  const source = rawRelief(raw)['reliefSource'];
  if (typeof source !== 'object' || source === null) throw new Error('fixture source missing');
  return source as Record<string, unknown>;
}
