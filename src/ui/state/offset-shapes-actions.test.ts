import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  operationIdsForObject,
  type ShapeObject,
} from '../../core/scene';
import type { OffsetShapesRequest } from './offset-shapes-actions';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

function request(patch: Partial<OffsetShapesRequest>): OffsetShapesRequest {
  return {
    distanceMm: 2,
    direction: 'outward',
    cornerStyle: 'corner',
    outerShapesOnly: false,
    deleteOriginals: false,
    ...patch,
  };
}

function square(id: string, size: number, locked = false): ShapeObject {
  return {
    kind: 'shape',
    id,
    spec: { kind: 'rect', widthMm: size, heightMm: size, cornerRadiusMm: 0 },
    color: '#222222',
    bounds: { minX: 0, minY: 0, maxX: size, maxY: size },
    transform: IDENTITY_TRANSFORM,
    ...(locked ? { locked: true } : {}),
    paths: [
      {
        color: '#222222',
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: size, y: 0 },
              { x: size, y: size },
              { x: 0, y: size },
              { x: 0, y: 0 },
            ],
          },
        ],
      },
    ],
  };
}

function load(objects: ReadonlyArray<ShapeObject>, selected: ReadonlyArray<string>): void {
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects: objects.map((object) => ({ ...object, operationIds: ['#222222'] })),
        layers: [createLayer({ id: '#222222', color: '#222222' })],
        groups: [],
      },
    },
    selectedObjectId: selected[0] ?? null,
    additionalSelectedIds: new Set(selected.slice(1)),
    dirty: false,
  });
}

describe('offsetShapesSelection', () => {
  beforeEach(() => {
    resetStore();
    useToastStore.setState({ toasts: [] });
  });

  it('adds the outward offset as a new selected object on its own operation', () => {
    load([square('src', 10)], ['src']);

    expect(useStore.getState().offsetShapesSelection(request({}))).toBe(true);

    const state = useStore.getState();
    const offset = state.project.scene.objects.find((object) => object.id !== 'src');
    expect(offset).toMatchObject({ kind: 'imported-svg', source: 'Offset outward (2 mm)' });
    expect(offset?.bounds).toMatchObject({ minX: -2, minY: -2, maxX: 12, maxY: 12 });
    expect(state.selectedObjectId).toBe(offset?.id);
    expect(offset && operationIdsForObject(offset, state.project.scene.layers)).not.toEqual([
      '#222222',
    ]);
    expect(state.undoStack).toHaveLength(1);
    expect(state.dirty).toBe(true);
  });

  it('adds two objects for Both and selects them together', () => {
    load([square('src', 10)], ['src']);

    useStore.getState().offsetShapesSelection(request({ direction: 'both' }));

    const state = useStore.getState();
    const sources = state.project.scene.objects.map((object) =>
      object.kind === 'imported-svg' ? object.source : object.id,
    );
    expect(sources).toEqual(['src', 'Offset outward (2 mm)', 'Offset inward (2 mm)']);
    expect([state.selectedObjectId, ...state.additionalSelectedIds]).toEqual([
      state.project.scene.objects[1]?.id,
      state.project.scene.objects[2]?.id,
    ]);
  });

  it('deletes the originals in the same undo step when asked', () => {
    load([square('src', 10)], ['src']);
    const before = useStore.getState().project;

    useStore.getState().offsetShapesSelection(request({ deleteOriginals: true }));

    const state = useStore.getState();
    expect(state.project.scene.objects.map((object) => object.id)).not.toContain('src');
    expect(state.project.scene.objects).toHaveLength(1);
    expect(state.undoStack).toEqual([before]);
    state.undo();
    expect(useStore.getState().project).toBe(before);
  });

  it('leaves locked shapes out of the offset and keeps them when deleting originals', () => {
    load([square('free', 10), square('held', 30, true)], ['free', 'held']);

    useStore.getState().offsetShapesSelection(request({ deleteOriginals: true }));

    const state = useStore.getState();
    expect(state.project.scene.objects.map((object) => object.id)).toContain('held');
    const offset = state.project.scene.objects.find((object) => object.id !== 'held');
    expect(offset?.bounds.maxX).toBeCloseTo(12, 3);
  });

  it('notes when the inward half of Both collapsed', () => {
    load([square('src', 4)], ['src']);

    useStore.getState().offsetShapesSelection(request({ direction: 'both', distanceMm: 3 }));

    expect(useStore.getState().project.scene.objects).toHaveLength(2);
    expect(useToastStore.getState().toasts.at(-1)?.variant).toBe('info');
  });

  it('warns and changes nothing when the offset cannot be made', () => {
    load([square('src', 4)], ['src']);
    const before = useStore.getState().project;

    const applied = useStore
      .getState()
      .offsetShapesSelection(request({ direction: 'inward', distanceMm: 3 }));

    expect(applied).toBe(false);
    expect(useStore.getState().project).toBe(before);
    expect(useToastStore.getState().toasts.at(-1)?.variant).toBe('warning');
  });
});
