import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type CurveSubpath,
  type ImportedSvg,
} from '../../core/scene';
import { dropTarget } from './path-node-drag-join-actions';
import type { PathNodeRef } from './path-node-edit-actions';
import { useStore } from './store';
import { resetStore } from './test-helpers';

const A: CurveSubpath = {
  start: { x: 0, y: 0 },
  segments: [{ kind: 'line', to: { x: 10, y: 0 } }],
  closed: false,
};
const B: CurveSubpath = {
  start: { x: 12, y: 1 },
  segments: [
    { kind: 'cubic', control1: { x: 14, y: 4 }, control2: { x: 18, y: 4 }, to: { x: 20, y: 0 } },
  ],
  closed: false,
};

const art = (): ImportedSvg => useStore.getState().project.scene.objects[0] as ImportedSvg;
const END_OF_A: PathNodeRef = {
  objectId: 'art',
  pathIndex: 0,
  polylineIndex: 0,
  pointIndex: 1,
  geometry: 'curve',
};
const START_OF_B: PathNodeRef = {
  objectId: 'art',
  pathIndex: 0,
  polylineIndex: 1,
  pointIndex: 0,
  geometry: 'curve',
};

beforeEach(() => {
  resetStore();
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'art',
    source: 'art.svg',
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 4 },
    transform: { ...IDENTITY_TRANSFORM, scaleX: 3, scaleY: 3 },
    operationIds: ['cut'],
    paths: [
      {
        color: '#000000',
        curves: [A, B],
        polylines: [
          { points: [], closed: false },
          { points: [], closed: false },
        ],
      },
    ],
  };
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects: [object],
        layers: [createLayer({ id: 'cut', color: '#000000' })],
        groups: [],
      },
    },
    selectedObjectId: 'art',
  });
  useStore.getState().selectPathNode(END_OF_A);
});

describe('drag-to-join', () => {
  it('finds the endpoint the dragged node was dropped on, in world units', () => {
    useStore.getState().beginInteraction();
    useStore.getState().setSelectedPathNodePositionDuringInteraction({ x: 35.5, y: 3.4 });
    const project = useStore.getState().project;
    expect(dropTarget(project, END_OF_A, 1)).toEqual(START_OF_B);
    expect(dropTarget(project, END_OF_A, 0.1)).toBeNull();
  });

  it('merges the two endpoints exactly, in one undo step with the drag', () => {
    useStore.getState().beginInteraction();
    useStore.getState().setSelectedPathNodePositionDuringInteraction({ x: 35.5, y: 3.4 });
    expect(useStore.getState().joinDraggedPathNode(START_OF_B)).toBe(true);
    const curves = art().paths[0]?.curves ?? [];
    expect(curves).toHaveLength(1);
    expect(curves[0]?.segments.map((segment) => segment.kind)).toEqual(['line', 'cubic']);
    expect(curves[0]?.segments[0]?.to).toEqual({ x: 12, y: 1 });
    const state = useStore.getState();
    expect(state.pendingUndo).toBeNull();
    expect(state.undoStack).toHaveLength(1);
    state.undo();
    expect(art().paths[0]?.curves).toEqual([A, B]);
  });
});
