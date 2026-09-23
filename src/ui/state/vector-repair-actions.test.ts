import { beforeEach, describe, expect, it } from 'vitest';
import {
  repairArtwork,
  repairLine,
  repairRectangle,
} from '../../__fixtures__/vector-repair-fixtures';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { compileJob } from '../../core/job';
import {
  createLayer,
  createProject,
  type ImportedSvg,
  type Layer,
  type Project,
} from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

const cut = {
  ...createLayer({ id: 'cut', name: 'Cut outline', color: '#000000' }),
  power: 42,
  speed: 420,
};
const other = {
  ...createLayer({ id: 'other', name: 'Other cut', color: '#0000ff' }),
  power: 64,
  speed: 640,
};

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

function load(
  objects: ReadonlyArray<ImportedSvg>,
  layers: ReadonlyArray<Layer> = [cut, other],
): Project {
  const project = {
    ...createProject(),
    scene: {
      objects,
      layers,
      groups: [{ id: 'g', name: 'Group', objectIds: objects.map((object) => object.id) }],
      artworkOrder: objects.map((object) => object.id).reverse(),
    },
  };
  useStore.setState({
    project,
    selectedObjectId: objects[0]?.id ?? null,
    additionalSelectedIds: new Set(objects.slice(1).map((object) => object.id)),
    dirty: false,
  });
  return project;
}

describe('explicit geometry repair transactions', () => {
  it('unions across two roots using the chosen base settings, preserves an unselected shared user, and supports undo/redo/reopen', () => {
    const a = repairArtwork('a', [repairRectangle(40, 40, 60, 40)], {
      powerScale: 20,
      operationOverride: { speed: 100 },
    });
    const b = repairArtwork('b', [repairRectangle(70, 60, 60, 40)], {
      operationIds: ['other'],
      powerScale: 50,
    });
    const untouched = repairArtwork('untouched', [repairRectangle(150, 40, 10, 10)], {
      operationIds: ['other'],
    });
    const before = load([a, untouched, b]);
    useStore.setState({ additionalSelectedIds: new Set(['b']) });
    expect(useStore.getState().unionSilhouetteSelection('cut')).toBe(true);
    const state = useStore.getState();
    const result = state.project.scene.objects[0];
    expect(state.project.scene.objects).toEqual([result, untouched]);
    expect(state.project.scene.artworkOrder).toEqual([result?.id, 'untouched']);
    expect(state.project.scene.layers).toEqual([cut, other]);
    expect(state.project.scene.layers[0]).toBe(cut);
    expect(result).toMatchObject({ operationIds: ['cut'] });
    expect(result?.operationOverride).toBeUndefined();
    expect(result?.powerScale).toBeUndefined();
    expect(state.additionalSelectedIds.size).toBe(0);
    expect(state.undoStack).toEqual([before]);
    const groups = compiledGroups(state.project);
    expect(groups).toEqual([
      { id: 'cut', power: 42, speed: 420, length: 300 },
      { id: 'other', power: 64, speed: 640, length: 40 },
    ]);
    verifyHistoryAndReopen(before, state.project);
  });

  it('refuses a missing/unrelated operation and open/locked selection without touching history or dirty state', () => {
    const closed = repairArtwork('a', [repairRectangle(0, 0, 10, 10)]);
    const before = load([closed]);
    expect(useStore.getState().unionSilhouetteSelection('other')).toBe(false);
    expect(useStore.getState().unionSilhouetteSelection('gone')).toBe(false);
    expect(useStore.getState().project).toBe(before);
    load([{ ...closed, locked: true }]);
    expect(useStore.getState().unionSilhouetteSelection('cut')).toBe(false);
    const openProject = load([
      repairArtwork('open', [repairLine({ x: 0, y: 0 }, { x: 10, y: 0 })]),
    ]);
    expect(useStore.getState().unionSilhouetteSelection('cut')).toBe(false);
    expect(useStore.getState().project).toBe(openProject);
    expect(useStore.getState()).toMatchObject({ dirty: false, undoStack: [], redoStack: [] });
  });

  it('joins compatible cross-artwork paths in one undo step, keeps exact output settings, and round-trips canonical curves', () => {
    const a = repairArtwork('a', [repairLine({ x: 10, y: 10 }, { x: 20, y: 10 })], {
      powerScale: 50,
      operationOverride: { byOperation: { cut: { speed: 200 } } },
    });
    const b = repairArtwork('b', [repairLine({ x: 20.03, y: 10 }, { x: 30, y: 10 })], {
      powerScale: 50,
      operationOverride: { byOperation: { cut: { speed: 200 } } },
    });
    const before = load([a, b], [cut]);
    expect(useStore.getState().joinSelectedPaths(0.02)).toBe(false);
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().joinSelectedPaths(0.05)).toBe(true);
    const state = useStore.getState();
    expect(state.project.scene.layers).toBe(before.scene.layers);
    expect(state.project.scene.objects).toHaveLength(1);
    expect(state.project.scene.artworkOrder).toEqual(['a']);
    expect(state.project.scene.groups).toEqual([]);
    expect(state.selectedObjectId).toBe('a');
    expect(state.undoStack).toEqual([before]);
    expect(compiledGroups(state.project)).toEqual([
      { id: 'cut', power: 21, speed: 200, length: 20 },
    ]);
    verifyHistoryAndReopen(before, state.project);
  });

  it('does not merge coincident paths owned by different operations or different scoped settings', () => {
    const a = repairArtwork('a', [repairLine({ x: 0, y: 0 }, { x: 10, y: 0 })]);
    const b = repairArtwork('b', [repairLine({ x: 10, y: 0 }, { x: 20, y: 0 })], {
      operationIds: ['other'],
    });
    const before = load([a, b]);
    expect(useStore.getState().joinSelectedPaths(1)).toBe(false);
    expect(useStore.getState().project).toBe(before);
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain('same operations');
    expect(useStore.getState().undoStack).toEqual([]);
  });
});

function compiledGroups(project: Project) {
  return compileJob(project.scene, DEFAULT_DEVICE_PROFILE).groups.flatMap((group) => {
    if (group.kind !== 'cut') return [];
    let length = 0;
    for (const segment of group.segments)
      for (let index = 1; index < segment.polyline.length; index += 1) {
        const a = segment.polyline[index - 1]!;
        const b = segment.polyline[index]!;
        length += Math.hypot(b.x - a.x, b.y - a.y);
      }
    return [{ id: group.layerId, power: group.power, speed: group.speed, length }];
  });
}

function verifyHistoryAndReopen(before: Project, after: Project): void {
  useStore.getState().undo();
  expect(useStore.getState().project).toEqual(before);
  useStore.getState().redo();
  expect(useStore.getState().project).toEqual(after);
  const reopened = deserializeProject(serializeProject(after));
  if (reopened.kind !== 'ok') throw new Error('Could not reopen geometry fixture');
  expect(compiledGroups(reopened.project)).toEqual(compiledGroups(after));
}
