/* eslint-disable no-restricted-syntax -- test fixture scene data needs a stable operation colour. */

// Projects filled up to the limits the project file loader holds a scene to
// (PROJECT_SCENE_LIMITS), for the tests of the commands that add objects in one
// step (ADR-307 amendment 1).

import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Layer,
  type Project,
  type SceneGroup,
  type SceneObject,
} from '../../../core/scene';
import { expect } from 'vitest';
import { PROJECT_SCENE_LIMITS } from '../../../io/project/project-scene-integrity-validator';
import { useStore } from '../store';
import { useToastStore } from '../toast-store';

export const OBJECT_LIMIT = PROJECT_SCENE_LIMITS.objects;

export const BLACK = '#000000';

/** The lightest object a scene holds: a rectangle with no baked paths, on the black operation. */
export function rect(id: string, x = 0): SceneObject {
  return {
    kind: 'shape',
    id,
    spec: { kind: 'rect', widthMm: 10, heightMm: 5, cornerRadiusMm: 0 },
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
    transform: { ...IDENTITY_TRANSFORM, x },
    color: BLACK,
    paths: [],
  };
}

/** `count` rectangles, `${prefix}-0` onwards. */
export function rects(count: number, prefix = 'filler'): SceneObject[] {
  return Array.from({ length: count }, (_, index) => rect(`${prefix}-${index}`));
}

/**
 * Puts a project holding `objects` in the store with `selected` selected and
 * an empty history, and returns it.
 */
export function loadScene(
  objects: ReadonlyArray<SceneObject>,
  selected: ReadonlyArray<string>,
  groups: ReadonlyArray<SceneGroup> = [],
  layers: ReadonlyArray<Layer> = [createLayer({ id: BLACK, color: BLACK })],
): Project {
  const project = { ...createProject(), scene: { objects, layers, groups } };
  useStore.setState({
    project,
    selectedObjectId: selected[0] ?? null,
    additionalSelectedIds: new Set(selected.slice(1)),
    undoStack: [],
    redoStack: [],
    dirty: false,
  });
  return project;
}

export function currentProject(): Project {
  return useStore.getState().project;
}

/**
 * The store still holds `before`, with nothing to undo. Compares identity as a
 * boolean: a failing toBe on a scene of thousands of objects prints all of it.
 */
export function expectUnchanged(before: Project): void {
  const after = currentProject();
  expect(after.scene.objects.length, 'objects').toBe(before.scene.objects.length);
  expect(after.scene.groups?.length ?? 0, 'groups').toBe(before.scene.groups?.length ?? 0);
  expect(after.scene.layers.length, 'operations').toBe(before.scene.layers.length);
  expect(after === before, 'the project is the one from before the command').toBe(true);
  expect(useStore.getState().undoStack.length, 'undo steps').toBe(0);
  expect(useStore.getState().dirty, 'dirty').toBe(false);
}

export function lastToast(): { readonly message: string; readonly variant: string } | undefined {
  const toast = useToastStore.getState().toasts.at(-1);
  return toast === undefined ? undefined : { message: toast.message, variant: toast.variant };
}

/** The notice for a command that would take the project past one of its limits. */
export function pastTheLimit(what: string, limit: number, ask: string): string {
  return `This would take the project past its limit of ${limit} ${what}. ${ask}`;
}
