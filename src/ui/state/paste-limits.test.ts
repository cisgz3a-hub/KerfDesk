// Paste and the project's limits (ADR-307 amendment 1). A project past
// PROJECT_SCENE_LIMITS saves but cannot be opened again, so a Paste that would
// take it past one is refused with a notice and changes nothing, and a Paste
// that fits is made exactly as before.

import { beforeEach, describe, expect, it } from 'vitest';
import { createLayer, type Layer, type SceneObject } from '../../core/scene';
import { deserializeProject } from '../../io/project/deserialize-project';
import {
  PROJECT_SCENE_LIMITS,
  validateSceneBudgets,
} from '../../io/project/project-scene-integrity-validator';
import { serializeProject } from '../../io/project/serialize-project';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import {
  currentProject,
  expectUnchanged,
  lastToast,
  loadScene,
  OBJECT_LIMIT,
  pastTheLimit,
  rect,
  rects,
} from './testing/scene-limit-fixtures';
import { useToastStore } from './toast-store';

const ASK = 'Copy fewer objects to paste, or delete some objects first.';
const OPERATION_LIMIT = PROJECT_SCENE_LIMITS.layers;

function ids(objects: ReadonlyArray<SceneObject>): string[] {
  return objects.map((object) => object.id);
}

// `count` operations, each with one object bound to it by id.
function boundArtwork(
  count: number,
  prefix: string,
  firstColour: number,
): { readonly layers: Layer[]; readonly objects: SceneObject[] } {
  const layers = Array.from({ length: count }, (_, index) =>
    createLayer({
      id: `${prefix}-operation-${index}`,
      color: `#${(firstColour + index).toString(16).padStart(6, '0')}`,
    }),
  );
  const objects = layers.map((layer, index) => ({
    ...rect(`${prefix}-${index}`),
    color: layer.color,
    operationIds: [layer.id],
  }));
  return { layers, objects };
}

// Copies all of `count` bound objects in one project, then opens another
// project of `targetOperations` operations, as File > Open would.
function copyFromAnotherProject(count: number, targetOperations: number): void {
  const source = boundArtwork(count, 'source', 1);
  loadScene(source.objects, ids(source.objects), [], source.layers);
  useStore.getState().copySelection();
  const target = boundArtwork(targetOperations, 'target', 0x100000);
  loadScene(target.objects, [], [], target.layers);
  useStore.setState({ projectDocumentEpoch: useStore.getState().projectDocumentEpoch + 1 });
}

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

describe('Paste and the project limits', () => {
  it.each([
    ['Paste', () => useStore.getState().pasteClipboard()],
    ['Paste in Place', () => useStore.getState().pasteClipboardInPlace()],
  ])('%s refuses to make 6,000 objects into 12,000', (_name, paste) => {
    const objects = rects(6_000);
    const before = loadScene(objects, ids(objects));
    useStore.getState().copySelection();
    const clipboard = useStore.getState().sceneClipboard;

    paste();

    expectUnchanged(before);
    expect(useStore.getState().selectedObjectId).toBe('filler-0');
    // The clipboard is kept, to paste once there is room.
    expect(useStore.getState().sceneClipboard).toBe(clipboard);
    expect(lastToast()).toEqual({
      message: pastTheLimit('objects', OBJECT_LIMIT, ASK),
      variant: 'warning',
    });
  });

  it('pastes everything that fits, up to the limit, in one undo step', () => {
    const objects = rects(OBJECT_LIMIT / 2);
    const before = loadScene(objects, ids(objects));
    useStore.getState().copySelection();

    useStore.getState().pasteClipboard();

    expect(currentProject().scene.objects).toHaveLength(OBJECT_LIMIT);
    expect(useStore.getState().undoStack).toEqual([before]);
    expect(useStore.getState().additionalSelectedIds.size).toBe(OBJECT_LIMIT / 2 - 1);
    expect(lastToast()).toBeUndefined();
    expect(deserializeProject(serializeProject(currentProject())).kind).toBe('ok');
  });

  it('refuses one object past the limit', () => {
    const before = loadScene([rect('a'), ...rects(OBJECT_LIMIT - 1)], ['a']);
    useStore.getState().copySelection();

    useStore.getState().pasteClipboard();

    expectUnchanged(before);
    expect(lastToast()?.message).toBe(pastTheLimit('objects', OBJECT_LIMIT, ASK));
  });

  it('refuses operations from another project past their limit, and pastes them up to it', () => {
    // 200 operations copied into a project of 100 would make 300.
    copyFromAnotherProject(200, 100);
    const before = currentProject();
    useStore.getState().pasteClipboard();
    expectUnchanged(before);
    expect(lastToast()).toEqual({
      message: pastTheLimit('operations', OPERATION_LIMIT, ASK),
      variant: 'warning',
    });

    copyFromAnotherProject(200, OPERATION_LIMIT - 200);
    useStore.getState().pasteClipboard();
    expect(currentProject().scene.layers).toHaveLength(OPERATION_LIMIT);
    expect(currentProject().scene.objects).toHaveLength(OPERATION_LIMIT);
    expect(validateSceneBudgets(currentProject().scene)).toBeNull();
  });
});
