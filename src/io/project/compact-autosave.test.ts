import { describe, expect, it } from 'vitest';
import { createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import type { MeshReliefObject } from '../../core/scene/relief';
import { deserializeProject } from './deserialize-project';
import { prepareProjectForAutosave } from './prepare-project-autosave';
import { prepareProjectForPersistence } from './prepare-project-persistence';
import { serializeProject } from './serialize-project';
import { stringifyProjectJson } from './stringify-project-json';

describe('compact autosave JSON', () => {
  it('preserves both geometry representations and escaped text while manual files stay indented', () => {
    const project = vectorProject();
    const pretty = serializeProject(project);
    const autosave = prepareProjectForAutosave(project);
    const manual = prepareProjectForPersistence(project);
    expect(autosave.kind).toBe('ok');
    expect(manual.kind).toBe('ok');
    if (autosave.kind !== 'ok' || manual.kind !== 'ok') return;

    expect(autosave.json).toBe(`${JSON.stringify(JSON.parse(pretty))}\n`);
    expect(pretty).toBe(`${JSON.stringify(JSON.parse(pretty), null, 2)}\n`);
    expect(manual.json).toBe(`${JSON.stringify(JSON.parse(manual.json), null, 2)}\n`);
    expect(autosave.json.length).toBeLessThan(pretty.length);
    expect(deserializeProject(autosave.json)).toEqual(deserializeProject(pretty));
    const restored = deserializeProject(autosave.json);
    if (restored.kind !== 'ok') throw new Error('autosave must recover');
    expect(restored.project.scene.objects).toEqual(project.scene.objects);
    expect(restored.project.notes).toBe(project.notes);
  });

  it.each([Float32Array, Float64Array])(
    'preserves %s relief values without expanding a typed mesh through its iterator',
    (ArrayType) => {
      const positions = new ArrayType([0, -0, 1 / 3, 2, 0, 1e20, 0, 1.5, 1e-12]);
      const project = meshProject(positions);
      const plain = meshProject(Array.from(positions));
      const pretty = serializeProject(plain);
      Object.defineProperty(positions, Symbol.iterator, {
        value: (): never => {
          throw new Error('typed mesh must not expand through its iterator');
        },
      });
      const autosave = prepareProjectForAutosave(project);
      expect(autosave.kind).toBe('ok');
      if (autosave.kind !== 'ok') return;

      expect(autosave.json).toBe(`${JSON.stringify(JSON.parse(pretty))}\n`);
      expect(serializeProject(project)).toBe(pretty);
      expect(deserializeProject(autosave.json)).toEqual(deserializeProject(pretty));
      expect(positions.byteLength).toBe(9 * ArrayType.BYTES_PER_ELEMENT);
    },
  );

  it('keeps Float64 precision outside the Float32 range in compact relief recovery', () => {
    const project = meshProject(new Float64Array([0, 0, 0, 2, 0, 1e39, 0, 1.5, 0]));
    const autosave = prepareProjectForAutosave(project);
    expect(autosave.kind).toBe('ok');
    if (autosave.kind !== 'ok') return;
    const restored = deserializeProject(autosave.json);
    if (restored.kind !== 'ok') throw new Error('autosave must recover');
    const object = restored.project.scene.objects[0];
    expect(
      object?.kind === 'relief' && object.reliefSource.kind === 'legacy-mesh'
        ? object.reliefSource.meshPositions
        : null,
    ).toEqual([0, 0, 0, 2, 0, 1e39, 0, 1.5, 0]);
  });

  it('keeps write-time rejection for invalid coordinates and cyclic projects', () => {
    const invalid = meshProject(new Float32Array([0, 0, 0, 2, 0, Number.NaN, 0, 1.5, 0]));
    expect(prepareProjectForAutosave(invalid)).toMatchObject({ kind: 'invalid' });
    const cyclic = createProject() as unknown as Record<string, unknown>;
    cyclic['self'] = cyclic;
    expect(prepareProjectForAutosave(cyclic as unknown as Project)).toMatchObject({
      kind: 'invalid',
    });
  });

  it('changes only whitespace in the typed-array JSON writer, including its slow nonfinite path', () => {
    const value = {
      text: 'line\n"quoted"\\tab\t雪',
      typed: new Float64Array([0, -0, 1 / 3, Number.NaN, Number.POSITIVE_INFINITY]),
      omitted: undefined,
      ignored: Symbol('ignored'),
      array: [undefined, () => 1, Symbol('array'), { toJSON: () => ({ key: 'value' }) }],
      nested: { emptyArray: [], emptyObject: {} },
    };
    const plain = { ...value, typed: Array.from(value.typed) };
    expect(stringifyProjectJson(value, { compact: true })).toBe(JSON.stringify(plain));
    expect(stringifyProjectJson(value)).toBe(JSON.stringify(plain, null, 2));
  });
});

function vectorProject(): Project {
  const base = createProject();
  return {
    ...base,
    notes: 'Keep spaces  and tabs\tand\nnewlines, quotes " and slash \\ exactly. 雪',
    scene: {
      ...base.scene,
      objects: [
        {
          kind: 'traced-image',
          id: 'trace',
          source: 'original.png',
          traceMode: 'filled-contours',
          tracePixelWidth: 64,
          tracePixelHeight: 64,
          bounds: { minX: 0, minY: 0, maxX: 60, maxY: 30 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color: '#000000',
              polylines: [
                {
                  points: [
                    { x: 0.25, y: 2.5 },
                    { x: 30, y: 20 },
                  ],
                  closed: false,
                },
              ],
              curves: [
                {
                  start: { x: 0.25, y: 2.5 },
                  closed: false,
                  segments: [
                    {
                      kind: 'cubic',
                      control1: { x: 1 / 3, y: 15 },
                      control2: { x: 22, y: 1.25 },
                      to: { x: 30, y: 20 },
                    },
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

function meshProject(meshPositions: MeshReliefObject['reliefSource']['meshPositions']): Project {
  const base = createProject();
  return {
    ...base,
    scene: {
      ...base.scene,
      objects: [
        {
          kind: 'relief',
          id: 'mesh',
          source: 'relief.stl',
          targetWidthMm: 2,
          reliefDepthMm: 1,
          reliefSource: { kind: 'legacy-mesh', meshPositions, emptyCells: 'floor' },
          color: '#a0522d',
          bounds: { minX: 0, minY: 0, maxX: 2, maxY: 1.5 },
          transform: IDENTITY_TRANSFORM,
        },
      ],
    },
  };
}
