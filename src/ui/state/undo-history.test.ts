import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Project } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import {
  UNDO_LIST_LENGTH,
  redoHistoryEntries,
  redoSteps,
  undoHistoryEntries,
  undoSteps,
} from './undo-history';
import { withUndoStepName } from './undo-step-names';

function draw(id: string): void {
  const spec = { widthMm: 5, heightMm: 5, cornerRadiusMm: 0 };
  useStore.getState().drawShape(createRectangle({ id, color: '#000000', spec }));
}

function moveRight(id: string, name: string | null = null): void {
  const object = useStore.getState().project.scene.objects.find((o) => o.id === id);
  if (object === undefined) throw new Error(`missing ${id}`);
  withUndoStepName(name, () =>
    useStore
      .getState()
      .applyObjectTransform(id, { ...object.transform, x: object.transform.x + 5 }),
  );
}

function names(entries: ReadonlyArray<{ readonly name: string }>): ReadonlyArray<string> {
  return entries.map((entry) => entry.name);
}

beforeEach(resetStore);
afterEach(resetStore);

describe('undo history jump', () => {
  it('lists steps newest first and jumps back N steps, then redoes one at a time', () => {
    const projects: Project[] = [useStore.getState().project];
    draw('a');
    projects.push(useStore.getState().project);
    moveRight('a', 'Align Left');
    projects.push(useStore.getState().project);
    draw('b');
    projects.push(useStore.getState().project);
    moveRight('b');
    projects.push(useStore.getState().project);

    const undoList = undoHistoryEntries(useStore.getState());
    expect(names(undoList)).toEqual([
      'Move rectangle',
      'Add rectangle',
      'Align Left',
      'Add rectangle',
    ]);
    expect(undoList.map((entry) => entry.steps)).toEqual([1, 2, 3, 4]);

    // Click "Align Left" (third from the top): back to just before it.
    undoSteps(3);
    let state = useStore.getState();
    expect(state.project).toBe(projects[1]);
    expect(state.undoStack).toHaveLength(1);
    expect(state.redoStack).toHaveLength(3);
    expect(names(redoHistoryEntries(state))).toEqual([
      'Align Left',
      'Add rectangle',
      'Move rectangle',
    ]);
    expect(names(undoHistoryEntries(state))).toEqual(['Add rectangle']);

    // Redo still works step by step, then as a jump.
    state.redo();
    expect(useStore.getState().project).toBe(projects[2]);
    redoSteps(2);
    state = useStore.getState();
    expect(state.project).toBe(projects[4]);
    expect(state.redoStack).toHaveLength(0);
    expect(names(undoHistoryEntries(state))).toEqual(names(undoList));
  });

  it('stops at the end of either stack instead of failing', () => {
    draw('a');
    draw('b');
    undoSteps(99);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(useStore.getState().project.scene.objects).toHaveLength(0);
    redoSteps(99);
    expect(useStore.getState().redoStack).toHaveLength(0);
    expect(useStore.getState().project.scene.objects).toHaveLength(2);
  });

  it('a new step after a jump clears the redo side, as a single Undo does', () => {
    draw('a');
    draw('b');
    draw('c');
    undoSteps(2);
    draw('d');
    const state = useStore.getState();
    expect(state.redoStack).toHaveLength(0);
    expect(names(undoHistoryEntries(state))).toEqual(['Add rectangle', 'Add rectangle']);
  });

  it('limits the list to the newest steps', () => {
    for (let index = 0; index < UNDO_LIST_LENGTH + 3; index += 1) draw(`r${index}`);
    const entries = undoHistoryEntries(useStore.getState(), UNDO_LIST_LENGTH);
    expect(entries).toHaveLength(UNDO_LIST_LENGTH);
    expect(entries[0]?.steps).toBe(1);
    expect(entries.at(-1)?.steps).toBe(UNDO_LIST_LENGTH);
  });
});
