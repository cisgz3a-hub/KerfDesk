import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Polyline,
} from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';

const square = (x: number, y: number, size: number): Polyline => ({
  closed: true,
  points: [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ],
});

function art(id: string, polyline: Polyline): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 30, maxY: 30 },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['cut'],
    paths: [{ color: '#000000', polylines: [polyline] }],
  };
}

beforeEach(() => {
  resetStore();
  // Two 20 mm squares overlapping in the 10 mm square from (10, 10) to (20, 20).
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects: [art('a', square(0, 0, 20)), art('b', square(10, 10, 20))],
        layers: [
          createLayer({ id: 'cut', color: '#000000' }),
          createLayer({ id: 'score', color: '#ff0000' }),
        ],
        groups: [],
      },
    },
  });
});

const objects = () => useStore.getState().project.scene.objects;

describe('Trim Shapes options', () => {
  it('preserves a whole removed outline on the drawing layer and restores it with undo', () => {
    const state = useStore.getState();
    const original = art('only', square(0, 0, 20));
    useStore.setState({
      project: { ...state.project, scene: { ...state.project.scene, objects: [original] } },
    });
    expect(
      useStore.getState().trimShapeAt({ x: 20, y: 10 }, 0.5, {
        keepRemoved: { color: '#ff0000' },
      }),
    ).toBe(true);
    expect(objects()).toHaveLength(1);
    const kept = objects()[0] as ImportedSvg;
    expect(kept.source).toBe('Trimmed segment');
    expect(kept.operationIds).toEqual(['score']);
    expect(kept.paths[0]?.curves?.[0]?.closed).toBe(true);
    expect(useStore.getState().project.scene.layers.some((layer) => layer.id === 'score')).toBe(
      true,
    );
    useStore.getState().undo();
    expect(objects()).toEqual([original]);
  });

  it('auto-joins the two outlines into one closed outline after both inner stretches go', () => {
    const trim = useStore.getState().trimShapeAt;
    // First A's corner inside B goes, then B's corner inside A; the open ends meet.
    expect(trim({ x: 20, y: 15 }, 0.5, { autoJoin: true })).toBe(true);
    expect(trim({ x: 15, y: 10 }, 0.5, { autoJoin: true })).toBe(true);
    const remaining = objects();
    expect(remaining).toHaveLength(1);
    const contours = (remaining[0] as ImportedSvg).paths.flatMap((path) => path.curves ?? []);
    expect(contours).toHaveLength(1);
    expect(contours[0]?.closed).toBe(true);
    expect(useStore.getState().undoStack).toHaveLength(2);
  });

  it('keeps the deleted stretch on the drawing layer when asked, and leaves outlines apart without auto-join', () => {
    const trim = useStore.getState().trimShapeAt;
    trim({ x: 20, y: 15 }, 0.5, { keepRemoved: { color: '#ff0000' } });
    trim({ x: 15, y: 10 }, 0.5);
    const all = objects();
    expect(all.map((object) => object.id).slice(0, 2)).toEqual(['a', 'b']);
    const kept = all.find(
      (object) => object.kind === 'imported-svg' && object.source === 'Trimmed segment',
    );
    expect(kept?.operationIds).toEqual(['score']);
    const piece = (kept as ImportedSvg).paths[0]?.curves?.[0];
    expect(piece?.start).toEqual({ x: 20, y: 10 });
    // The stretch inside B runs from one crossing round A's corner to the other.
    expect(piece?.segments.map((segment) => segment.to)).toEqual([
      { x: 20, y: 20 },
      { x: 10, y: 20 },
    ]);
  });
});
