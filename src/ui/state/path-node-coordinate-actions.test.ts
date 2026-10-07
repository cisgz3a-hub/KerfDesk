import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyTransform,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  polylineToCurveSubpath,
  type ImportedSvg,
  type Transform,
} from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { nodeScenePoint } from './path-node-coordinate-actions';
import type { PathNodeRef } from './path-node-edit-actions';

beforeEach(resetStore);
const ref = (pointIndex: number): PathNodeRef => ({
  objectId: 'line',
  pathIndex: 0,
  polylineIndex: 0,
  pointIndex,
  geometry: 'curve',
});
function load(transform: Transform = IDENTITY_TRANSFORM, locked = false): ImportedSvg {
  const polyline = {
    closed: false,
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: 15 },
    ],
  };
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'line',
    source: 'line.svg',
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 15 },
    transform,
    locked,
    paths: [
      { color: '#000000', polylines: [polyline], curves: [polylineToCurveSubpath(polyline)] },
    ],
  };
  useStore.setState({
    project: {
      ...createProject(),
      scene: { objects: [object], layers: [createLayer({ id: 'cut', color: '#000000' })] },
    },
  });
  useStore.getState().selectPathNode(ref(0));
  return object;
}
function current(): ImportedSvg {
  return useStore.getState().project.scene.objects[0] as ImportedSvg;
}

describe('workspace node coordinate edits', () => {
  it('sets an absolute workspace coordinate through rotation, mirroring and nonuniform scaling', () => {
    const object = load({
      ...IDENTITY_TRANSFORM,
      x: 30,
      y: 50,
      rotationDeg: 37,
      scaleX: 2,
      scaleY: 3,
      mirrorX: true,
    });
    const before = applyTransform({ x: 0, y: 0 }, object.transform);
    useStore.getState().setSelectedPathNodeCoordinate('x', 25.4);
    const point = nodeScenePoint(current(), ref(0));
    expect(point?.x).toBeCloseTo(25.4, 10);
    expect(point?.y).toBeCloseTo(before.y, 10);
    expect(current().paths[0]?.curves).toHaveLength(1);
    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.getState().undo();
    expect(useStore.getState().project.scene.objects[0]).toBe(object);
  });
  it('moves every selected node by the same world delta for numeric input', () => {
    load();
    useStore.getState().selectPathNode(ref(1), { additive: true });
    useStore.getState().setSelectedPathNodeCoordinate('y', 12);
    expect(nodeScenePoint(current(), ref(0))).toEqual({ x: 0, y: 7 });
    expect(nodeScenePoint(current(), ref(1))).toEqual({ x: 10, y: 12 });
    expect(useStore.getState().undoStack).toHaveLength(1);
  });
  it.each(['min', 'center', 'max'] as const)(
    'aligns in world coordinates to %s without changing the perpendicular coordinates',
    (alignment) => {
      const object = load({
        ...IDENTITY_TRANSFORM,
        x: 13,
        y: -2,
        rotationDeg: 90,
        scaleX: 2,
        scaleY: 3,
      });
      useStore.getState().selectPathNode(ref(1), { additive: true });
      useStore.getState().selectPathNode(ref(2), { additive: true });
      const original = [0, 1, 2].map((index) => nodeScenePoint(object, ref(index))!);
      const xs = original.map((point) => point.x);
      const min = Math.min(...xs),
        max = Math.max(...xs);
      const expected = alignment === 'min' ? min : alignment === 'max' ? max : (min + max) / 2;
      useStore.getState().alignSelectedPathNodes('x', alignment);
      [0, 1, 2].forEach((index) => {
        const point = nodeScenePoint(current(), ref(index));
        expect(point?.x).toBeCloseTo(expected, 10);
        expect(point?.y).toBeCloseTo(original[index]!.y, 10);
      });
      expect(useStore.getState().undoStack).toHaveLength(1);
      useStore.getState().undo();
      expect(current()).toBe(object);
    },
  );
  it('does not record invalid, locked, singular or unchanged edits', () => {
    load();
    const before = useStore.getState().project;
    useStore.getState().setSelectedPathNodeCoordinate('x', 0);
    useStore.getState().setSelectedPathNodeCoordinate('x', Infinity);
    expect(useStore.getState().project).toBe(before);
    load(IDENTITY_TRANSFORM, true);
    useStore.getState().setSelectedPathNodeCoordinate('x', 1);
    load({ ...IDENTITY_TRANSFORM, scaleX: 0 });
    useStore.getState().setSelectedPathNodeCoordinate('x', 1);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });
});
