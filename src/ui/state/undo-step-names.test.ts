import { describe, expect, it } from 'vitest';
import { createLayer, createProject, type Project, type SceneObject } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { describeProjectChange } from './describe-project-change';
import { pushUndo } from './scene-mutations';
import {
  namedUndoAction,
  recordUndoStepName,
  saveUndoStepName,
  undoStepName,
  withUndoStepName,
} from './undo-step-names';

function rect(id: string, x = 0): SceneObject {
  const shape = createRectangle({
    id,
    color: '#000000',
    spec: { widthMm: 5, heightMm: 5, cornerRadiusMm: 0 },
  });
  return { ...shape, transform: { ...shape.transform, x } };
}

function withObjects(base: Project, objects: ReadonlyArray<SceneObject>): Project {
  return { ...base, scene: { ...base.scene, objects } };
}

describe('undo step names', () => {
  it('uses the name the push site gives', () => {
    const before = createProject();
    const after = withObjects(before, [rect('a')]);
    pushUndo(before, [], 'Trim Shapes');
    expect(undoStepName(before, after)).toBe('Trim Shapes');
  });

  it('uses the innermost pending name when the push site gives none', () => {
    const before = createProject();
    const after = withObjects(before, [rect('a')]);
    withUndoStepName('Paste', () =>
      withUndoStepName('Paste in Place', () => {
        pushUndo(before, []);
      }),
    );
    expect(undoStepName(before, after)).toBe('Paste in Place');
  });

  it('namedUndoAction names the step and passes arguments and result through', () => {
    const before = createProject();
    const after = withObjects(before, [rect('a')]);
    const action = namedUndoAction('Duplicate', (value: number) => {
      pushUndo(before, []);
      return value * 2;
    });
    expect(action(21)).toBe(42);
    expect(undoStepName(before, after)).toBe('Duplicate');
  });

  it('forgets a name when a later unnamed step starts from the same snapshot', () => {
    // Undo a named step, then do something else: the new step must not
    // inherit the abandoned step's name.
    const before = createProject();
    recordUndoStepName(before, 'Warp');
    pushUndo(before, []);
    const after = withObjects(before, [rect('a')]);
    expect(undoStepName(before, after)).toBe('Add rectangle');
  });

  it('puts back the names a step took from its snapshot when the step is refused', () => {
    // A command that builds its step and then refuses it (ADR-307 amendment 1)
    // has already pushed undo from the snapshot, naming it.
    const named = createProject();
    const unnamed = createProject();
    recordUndoStepName(named, 'Warp');
    const restoreNamed = saveUndoStepName(named);
    const restoreUnnamed = saveUndoStepName(unnamed);
    withUndoStepName('Duplicate', () => {
      pushUndo(named, []);
      pushUndo(unnamed, []);
    });

    restoreNamed();
    restoreUnnamed();

    expect(undoStepName(named, withObjects(named, [rect('a')]))).toBe('Warp');
    expect(undoStepName(unnamed, withObjects(unnamed, [rect('a')]))).toBe('Add rectangle');
  });

  it('ignores a blank name and leaves nothing pending afterwards', () => {
    const before = createProject();
    const after = withObjects(before, [rect('a'), rect('b')]);
    withUndoStepName('  ', () => pushUndo(before, []));
    expect(undoStepName(before, after)).toBe('Add 2 objects');
    const later = createProject();
    pushUndo(later, []);
    expect(undoStepName(later, withObjects(later, [rect('c')]))).toBe('Add rectangle');
  });
});

describe('describeProjectChange', () => {
  const base = withObjects(createProject(), [rect('a'), rect('b')]);
  const objects = base.scene.objects;
  const [a, b] = objects as [SceneObject, SceneObject];

  const edit = (object: SceneObject): Project =>
    withObjects(base, [object, ...objects.filter((o) => o.id !== object.id)]);

  it('names added, deleted and replaced objects', () => {
    expect(describeProjectChange(base, withObjects(base, [...objects, rect('c')]))).toBe(
      'Add rectangle',
    );
    expect(describeProjectChange(base, withObjects(base, []))).toBe('Delete 2 objects');
    expect(describeProjectChange(base, withObjects(base, [rect('ab')]))).toBe('Combine 2 objects');
    expect(describeProjectChange(base, withObjects(base, [a, rect('b1'), rect('b2')]))).toBe(
      'Split rectangle',
    );
  });

  it('names moves, resizes, rotations, flips and locks from the changed field', () => {
    const t = a.transform;
    expect(describeProjectChange(base, edit({ ...a, transform: { ...t, x: 5 } }))).toBe(
      'Move rectangle',
    );
    expect(describeProjectChange(base, edit({ ...a, transform: { ...t, x: 5, scaleX: 2 } }))).toBe(
      'Resize rectangle',
    );
    expect(describeProjectChange(base, edit({ ...a, transform: { ...t, rotationDeg: 90 } }))).toBe(
      'Rotate rectangle',
    );
    expect(describeProjectChange(base, edit({ ...a, transform: { ...t, mirrorX: true } }))).toBe(
      'Flip rectangle',
    );
    expect(describeProjectChange(base, edit({ ...a, locked: true }))).toBe('Lock rectangle');
    const moved = withObjects(base, [
      { ...a, transform: { ...a.transform, x: 3 } },
      { ...b, transform: { ...b.transform, x: 3 } },
    ]);
    expect(describeProjectChange(base, moved)).toBe('Move 2 objects');
  });

  it('names a restack, operation changes and project settings', () => {
    expect(describeProjectChange(base, withObjects(base, [b, a]))).toBe('Change stacking order');
    const layer = createLayer({ id: 'extra', color: '#ff0000' });
    const withLayer = { ...base, scene: { ...base.scene, layers: [...base.scene.layers, layer] } };
    expect(describeProjectChange(base, withLayer)).toBe('Add operation');
    expect(describeProjectChange(base, { ...base, notes: 'hello' })).toBe('Edit project notes');
    expect(describeProjectChange(base, { ...base })).toBe('Edit project');
  });
});
