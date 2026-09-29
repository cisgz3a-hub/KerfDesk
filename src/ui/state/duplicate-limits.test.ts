// Duplicate and the project's limits (ADR-307 amendment 1). A project past
// PROJECT_SCENE_LIMITS saves but cannot be opened again, so a Duplicate that
// would take it past one is refused with a notice and changes nothing, and a
// Duplicate that fits is made exactly as before.

import { beforeEach, describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type SceneGroup, type SceneObject } from '../../core/scene';
import { deserializeProject } from '../../io/project/deserialize-project';
import {
  PROJECT_SCENE_LIMITS,
  validateSceneBudgets,
} from '../../io/project/project-scene-integrity-validator';
import { serializeProject } from '../../io/project/serialize-project';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import {
  BLACK,
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

const ASK = 'Duplicate fewer objects, or delete some objects first.';

const MASKED_IMAGE: SceneObject = {
  kind: 'raster-image',
  id: 'image',
  source: 'image.png',
  dataUrl: 'data:image/png;base64,AA==',
  pixelWidth: 1,
  pixelHeight: 1,
  bounds: { minX: 0, minY: 0, maxX: 8, maxY: 8 },
  transform: IDENTITY_TRANSFORM,
  color: BLACK,
  dither: 'grayscale',
  linesPerMm: 1,
  lumaBase64: 'AA==',
  imageMaskId: 'mask',
};

function ids(objects: ReadonlyArray<SceneObject>): string[] {
  return objects.map((object) => object.id);
}

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

describe('Duplicate and the project limits', () => {
  it('refuses to make 6,000 objects into 12,000, which could not be opened again', () => {
    const objects = rects(6_000);
    const before = loadScene(objects, ids(objects));

    useStore.getState().duplicateSelection();

    expectUnchanged(before);
    expect(useStore.getState().selectedObjectId).toBe('filler-0');
    expect(lastToast()).toEqual({
      message: pastTheLimit('objects', OBJECT_LIMIT, ASK),
      variant: 'warning',
    });
  });

  it('duplicates everything that fits, up to the limit, in one undo step', () => {
    const objects = rects(OBJECT_LIMIT / 2);
    const before = loadScene(objects, ids(objects));

    useStore.getState().duplicateSelection();

    expect(currentProject().scene.objects).toHaveLength(OBJECT_LIMIT);
    expect(validateSceneBudgets(currentProject().scene)).toBeNull();
    expect(useStore.getState().undoStack).toEqual([before]);
    expect(useStore.getState().additionalSelectedIds.size).toBe(OBJECT_LIMIT / 2 - 1);
    expect(lastToast()).toBeUndefined();
    expect(deserializeProject(serializeProject(currentProject())).kind).toBe('ok');
  });

  it('counts what a duplicate carries with it, to the last object', () => {
    // The image's mask is duplicated with it: two objects more.
    loadScene([MASKED_IMAGE, rect('mask'), ...rects(OBJECT_LIMIT - 4)], ['image']);
    useStore.getState().duplicateSelection();
    expect(currentProject().scene.objects).toHaveLength(OBJECT_LIMIT);

    const full = loadScene([MASKED_IMAGE, rect('mask'), ...rects(OBJECT_LIMIT - 3)], ['image']);
    useStore.getState().duplicateSelection();
    expectUnchanged(full);
    expect(lastToast()?.message).toBe(pastTheLimit('objects', OBJECT_LIMIT, ASK));
  });

  it('refuses groups whose members would pass their limit though the objects fit', () => {
    // 13 parts in 12 nested groups of 2, 3, ... 13 members: a duplicate adds
    // 90 group members. The filler groups hold the rest of the members.
    const parts = rects(13, 'part');
    const nested: SceneGroup[] = Array.from({ length: 12 }, (_, index) => ({
      id: `nest-${index}`,
      name: `Nest ${index}`,
      objectIds: ids(parts.slice(0, index + 2)),
    }));
    const filler = rects(997);
    const fillerGroups = (count: number): SceneGroup[] =>
      Array.from({ length: count }, (_, index) => ({
        id: `filler-group-${index}`,
        name: `Filler ${index}`,
        objectIds: ids(filler.slice(0, (PROJECT_SCENE_LIMITS.groupMembers - 180) / count)),
      }));

    // 49,820 filler members + 90: a duplicate reaches exactly 50,000.
    loadScene([...parts, ...filler], ids(parts), [...nested, ...fillerGroups(94)]);
    useStore.getState().duplicateSelection();
    expect(validateSceneBudgets(currentProject().scene)).toBeNull();
    expect(currentProject().scene.groups).toHaveLength(12 + 94 + 12);

    // Two members more before, and the duplicate would pass it.
    const extra: SceneGroup = { id: 'extra', name: 'Extra', objectIds: ['filler-0', 'filler-1'] };
    const before = loadScene([...parts, ...filler], ids(parts), [
      ...nested,
      ...fillerGroups(94),
      extra,
    ]);
    useStore.getState().duplicateSelection();
    expectUnchanged(before);
    expect(lastToast()).toEqual({
      message: pastTheLimit('group members', PROJECT_SCENE_LIMITS.groupMembers, ASK),
      variant: 'warning',
    });
  });

  it('refuses to grow a project that is already over the limit', () => {
    const before = loadScene([rect('a'), ...rects(OBJECT_LIMIT + 4)], ['a']);

    useStore.getState().duplicateSelection();

    expectUnchanged(before);
    expect(lastToast()?.message).toBe(pastTheLimit('objects', OBJECT_LIMIT, ASK));
  });
});
