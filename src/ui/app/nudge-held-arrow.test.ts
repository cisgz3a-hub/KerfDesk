// Audit 08-P3-2: every auto-repeat of a held arrow key pushed its own undo step,
// so about 2 s of holding pushed the whole 50-step history out.
import { beforeEach, describe, expect, it } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { undoStepName } from '../state/undo-step-names';
import { transformShortcutContext } from './shortcut-contexts';
import { handleTransformShortcut } from './shortcuts';

beforeEach(() => {
  resetStore();
  const rectangle = (id: string, x: number) =>
    createRectangle({
      id,
      color: '#000000',
      spec: { widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
      transform: { ...IDENTITY_TRANSFORM, x, y: 40 },
    });
  useStore.getState().setProject({
    ...createProject(),
    scene: {
      objects: [rectangle('a', 0), rectangle('b', 100)],
      layers: [createLayer({ id: '#000000', color: '#000000' })],
      groups: [],
    },
  });
});

describe('holding an arrow key', () => {
  it('moves the selection as one undo step and keeps older history', () => {
    useStore.getState().selectObject('b');
    useStore.getState().removeSceneObjects(['b']);
    useStore.getState().selectObject('a');

    hold('ArrowRight', 60);

    const state = useStore.getState();
    expect(xOf('a')).toBe(60);
    expect(state.undoStack).toHaveLength(2);
    expect(undoStepName(state.undoStack[1]!, state.project)).toBe('Move rectangle');
    state.undo();
    expect(xOf('a')).toBe(0);
    useStore.getState().undo();
    expect(useStore.getState().project.scene.objects.map((object) => object.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('starts a new step on each press, and after anything else changed the project', () => {
    useStore.getState().selectObject('a');

    hold('ArrowRight', 3);
    hold('ArrowRight', 2);
    expect(useStore.getState().undoStack).toHaveLength(2);

    useStore.getState().flipSelection('horizontal');
    press('ArrowRight', true);
    expect(useStore.getState().undoStack).toHaveLength(4);
  });
});

// One press and `count - 1` auto-repeats, as the browser sends a held key.
function hold(key: string, count: number): void {
  for (let index = 0; index < count; index += 1) press(key, index > 0);
}

function press(key: string, repeat: boolean): void {
  const event = new KeyboardEvent('keydown', { key, repeat, cancelable: true });
  expect(handleTransformShortcut(event, transformShortcutContext())).toBe(true);
}

function xOf(id: string): number | undefined {
  return useStore.getState().project.scene.objects.find((object) => object.id === id)?.transform.x;
}
