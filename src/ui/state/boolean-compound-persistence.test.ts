import { beforeEach, describe, expect, it } from 'vitest';
import { prepareProjectForPersistence, deserializeProject } from '../../io/project';
import { compileJob } from '../../core/job';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  assignObjectToLayer,
  bindSceneObjectToOperations,
  type ImportedSvg,
} from '../../core/scene';
import { evaluateBooleanCompound } from '../../core/geometry/boolean-compound';
import { isBooleanCompoundObject } from '../../core/scene/boolean-compound';
import { loadCompound } from './boolean-compound-workflow.test-fixture';
import { useStore } from './store';
import { resetStore } from './test-helpers';

beforeEach(() => resetStore());
function saveAndReopen(): ImportedSvg {
  const project = useStore.getState().project;
  const output = compileJob(project.scene, DEFAULT_DEVICE_PROFILE);
  const prepared = prepareProjectForPersistence(project);
  expect(prepared).toMatchObject({ kind: 'ok' });
  if (prepared.kind !== 'ok') throw new Error(prepared.reason);
  const reopened = deserializeProject(prepared.json);
  expect(reopened.kind).toBe('ok');
  if (reopened.kind !== 'ok') throw new Error('Saved compound could not reopen');
  expect(compileJob(reopened.project.scene, DEFAULT_DEVICE_PROFILE)).toEqual(output);
  const object = reopened.project.scene.objects[0];
  if (object === undefined || !isBooleanCompoundObject(object))
    throw new Error('Compound intent lost');
  expect(prepareProjectForPersistence(reopened.project)).toMatchObject({
    kind: 'ok',
    json: prepared.json,
  });
  return object;
}

describe('live compound manual Save admission', () => {
  it.each(['weld', 'subtract', 'intersect', 'exclude'] as const)(
    'saves a newly created %s and canonically persists every retained source',
    (operation) => {
      const compound = loadCompound(operation);
      const reopened = saveAndReopen();
      expect(reopened.id).toBe(compound.id);
      if (!isBooleanCompoundObject(reopened)) throw new Error('Compound intent lost');
      expect(reopened.booleanCompound.operands.map((operand) => operand.sourceId)).toEqual([
        'subject',
        'clip',
      ]);
      expect(
        reopened.booleanCompound.operands.every((operand) =>
          operand.object.paths.every((path) => path.curves !== undefined),
        ),
      ).toBe(true);
      expect(reopened.booleanCompound.operands.map((operand) => operand.object.transform)).toEqual(
        compound.booleanCompound.operands.map((operand) => operand.object.transform),
      );
    },
  );
  it('saves edited cubic control geometry and reevaluates it without cache drift', () => {
    const result = loadCompound();
    const project = useStore.getState().project;
    const compound = {
      ...result.booleanCompound,
      operands: result.booleanCompound.operands.map((operand, index) =>
        index !== 0
          ? operand
          : {
              ...operand,
              object: {
                ...operand.object,
                paths: [
                  {
                    ...operand.object.paths[0]!,
                    curves: [
                      {
                        start: { x: 0, y: 0 },
                        closed: true,
                        segments: [
                          {
                            kind: 'cubic' as const,
                            control1: { x: 3, y: 0 },
                            control2: { x: 7, y: 3 },
                            to: { x: 10, y: 0 },
                          },
                          { kind: 'line' as const, to: { x: 10, y: 10 } },
                          { kind: 'line' as const, to: { x: 0, y: 10 } },
                          { kind: 'line' as const, to: { x: 0, y: 0 } },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
      ),
    };
    useStore.getState().editBooleanCompound(result.id, compound, project);
    const reopened = saveAndReopen();
    expect(
      reopened.booleanCompound?.operands[0]?.object.paths[0]?.curves?.[0]?.segments[0],
    ).toMatchObject({ kind: 'cubic', control2: { x: 7, y: 3 } });
  });
  it('saves retained Weld operation bindings, colour edits and outer placement without semantic drift', () => {
    const result = loadCompound('weld');
    const project = useStore.getState().project;
    const scene = assignObjectToLayer(project.scene, result.id, '#123456');
    const coloured = scene.objects[0];
    if (coloured === undefined || !isBooleanCompoundObject(coloured))
      throw new Error('Missing compound');
    const bound = bindSceneObjectToOperations(coloured, ['cut']) as ImportedSvg;
    const refreshed = evaluateBooleanCompound({
      ...bound,
      transform: { ...bound.transform, x: 7, rotationDeg: 12 },
    });
    expect(refreshed.kind).toBe('ok');
    if (refreshed.kind !== 'ok') return;
    useStore.setState({ project: { ...project, scene: { ...scene, objects: [refreshed.value] } } });
    const reopened = saveAndReopen();
    expect(reopened.transform).toEqual(refreshed.value.transform);
    expect(
      reopened.booleanCompound?.operands.every((operand) =>
        operand.object.operationIds?.includes('cut'),
      ),
    ).toBe(true);
    expect(reopened.paths.every((path) => path.color === '#123456')).toBe(true);
  });
  it('refuses malformed or over-budget live source edits without changing project or history', () => {
    const result = loadCompound('weld');
    const project = useStore.getState().project;
    const malformed = {
      ...result.booleanCompound,
      operands: result.booleanCompound.operands.map((operand) => ({
        ...operand,
        object: { ...operand.object, id: 'same' },
      })),
    };
    useStore.getState().editBooleanCompound(result.id, malformed, project);
    expect(useStore.getState().project).toBe(project);
    expect(useStore.getState().undoStack).toHaveLength(1);
    const atLimit = {
      ...project,
      scene: {
        ...project.scene,
        objects: [
          result,
          ...Array.from({ length: 9997 }, (_, index) => ({
            ...result.booleanCompound.operands[0]!.object,
            id: `other-${index}`,
          })),
        ],
      },
    };
    useStore.setState({ project: atLimit });
    const addedSource = {
      ...result.booleanCompound,
      operands: [
        ...result.booleanCompound.operands,
        {
          ...result.booleanCompound.operands[0]!,
          object: { ...result.booleanCompound.operands[0]!.object, id: 'added-source' },
        },
      ],
    };
    useStore.getState().editBooleanCompound(result.id, addedSource, atLimit);
    expect(useStore.getState().project).toBe(atLimit);
    expect(useStore.getState().undoStack).toHaveLength(1);
  });
  it('refuses manual Save when the result cache disagrees with its retained sources', () => {
    const result = loadCompound();
    const project = useStore.getState().project;
    const invalid = {
      ...project,
      scene: {
        ...project.scene,
        objects: [{ ...result, bounds: { minX: 0, minY: 0, maxX: 500, maxY: 500 } }],
      },
    };
    expect(prepareProjectForPersistence(invalid)).toMatchObject({
      kind: 'invalid',
      reason: expect.stringContaining('saving would change'),
    });
  });
});
