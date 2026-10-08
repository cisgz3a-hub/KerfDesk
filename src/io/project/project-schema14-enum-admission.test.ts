import { describe, expect, it } from 'vitest';
import { createLayer, createProject, type Project } from '../../core/scene';
import {
  captureBooleanCompound,
  evaluateBooleanCompound,
} from '../../core/geometry/boolean-compound';
import { compoundRectangle } from '../../core/geometry/boolean-compound.test-fixture';
import type { BooleanCompoundOperation } from '../../core/scene/boolean-compound';
import { deserializeProject, prepareProjectForPersistence, serializeProject } from './index';

function compoundProject(operation: BooleanCompoundOperation = 'subtract'): Project {
  const captured = captureBooleanCompound(operation, [
    compoundRectangle('subject'),
    compoundRectangle('clip', 5),
  ]);
  if (captured.kind !== 'ok') throw new Error('Capture failed');
  const evaluated = evaluateBooleanCompound({
    ...compoundRectangle('result'),
    booleanCompound: captured.value,
  });
  if (evaluated.kind !== 'ok') throw new Error('Evaluation failed');
  const project = createProject();
  return {
    ...project,
    scene: {
      ...project.scene,
      layers: [createLayer({ id: 'cut', color: '#000000' })],
      objects: [evaluated.value],
      designTreeOrder: [{ kind: 'object', id: 'result' }],
    },
  };
}
function withInvalidEnum(field: 'operation' | 'sourceKind' | 'treeKind', value: unknown): Project {
  const project = compoundProject();
  const object = project.scene.objects[0];
  if (object?.kind !== 'imported-svg' || object.booleanCompound === undefined)
    throw new Error('Missing compound');
  const compound = object.booleanCompound;
  const scene =
    field === 'treeKind'
      ? { ...project.scene, designTreeOrder: [{ kind: value, id: 'result' }] }
      : {
          ...project.scene,
          objects: [
            {
              ...object,
              booleanCompound:
                field === 'operation'
                  ? { ...compound, operation: value }
                  : {
                      ...compound,
                      operands: compound.operands.map((operand, index) =>
                        index === 0 ? { ...operand, sourceKind: value } : operand,
                      ),
                    },
            },
          ],
        };
  // Simulate malformed runtime state as well as the persisted JSON boundary.
  return { ...project, scene } as unknown as Project;
}

describe('schema14 strict enum admission', () => {
  it.each(['weld', 'subtract', 'intersect', 'exclude'] as const)(
    'still saves and opens the valid %s string enum',
    (operation) => {
      const project = compoundProject(operation);
      const saved = prepareProjectForPersistence(project);
      expect(saved.kind).toBe('ok');
      if (saved.kind !== 'ok') throw new Error(saved.reason);
      const reopened = deserializeProject(saved.json);
      expect(reopened.kind).toBe('ok');
      if (reopened.kind !== 'ok') throw new Error('Open failed');
      const object = reopened.project.scene.objects[0];
      if (object?.kind !== 'imported-svg') throw new Error('Missing compound');
      expect(object.booleanCompound?.operation).toBe(operation);
      expect(reopened.project.scene.designTreeOrder).toEqual(project.scene.designTreeOrder);
    },
  );
  it.each([
    ['operation', ['weld'], 'booleanCompound.operation'],
    ['operation', ['subtract'], 'booleanCompound.operation'],
    ['operation', ['intersect'], 'booleanCompound.operation'],
    ['operation', ['exclude'], 'booleanCompound.operation'],
    ['sourceKind', ['imported-svg'], 'sourceKind'],
    ['sourceKind', ['traced-image'], 'sourceKind'],
    ['sourceKind', ['shape'], 'sourceKind'],
    ['sourceKind', ['text'], 'sourceKind'],
    ['treeKind', ['object'], 'designTreeOrder entry'],
    ['treeKind', ['group'], 'designTreeOrder entry'],
  ] as const)(
    'rejects array-shaped %s %j before Open or Save normalization',
    (field, value, reason) => {
      const project = withInvalidEnum(field, value);
      expect(deserializeProject(serializeProject(project))).toMatchObject({
        kind: 'invalid',
        reason: expect.stringContaining(reason),
      });
      expect(prepareProjectForPersistence(project)).toMatchObject({
        kind: 'invalid',
        reason: expect.stringContaining(reason),
      });
    },
  );
});
