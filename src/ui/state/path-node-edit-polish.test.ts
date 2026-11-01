// Rolling audit v7 L6 polish: M halves a segment by length (P3-4), a node
// moved with its own handle moves that handle once (P3-5), and Delete, Smooth
// and Corner say why when they change nothing (P3-3).
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  flattenCurveSubpath,
  IDENTITY_TRANSFORM,
  type CurveSubpath,
  type ImportedSvg,
  type PathSegment,
  type Vec2,
} from '../../core/scene';
import type { PathNodeRef } from './path-node-edit-actions';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

// One curve that turns hard near its start: (0,0) (0,30) (5,30) (40,0).
const HOOK: CurveSubpath = {
  start: { x: 0, y: 0 },
  closed: false,
  segments: [
    { kind: 'cubic', control1: { x: 0, y: 30 }, control2: { x: 5, y: 30 }, to: { x: 40, y: 0 } },
  ],
};

const TRIANGLE: CurveSubpath = {
  start: { x: 0, y: 0 },
  closed: true,
  segments: [
    { kind: 'line', to: { x: 10, y: 0 } },
    { kind: 'line', to: { x: 0, y: 10 } },
    { kind: 'line', to: { x: 0, y: 0 } },
  ],
};

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

describe('M inserts a node halfway along the segment', () => {
  it('splits a curve at half its length, not at t = 0.5', () => {
    load(art([HOOK]));

    useStore
      .getState()
      .insertPathNode(
        { objectId: 'art', pathIndex: 0, curveIndex: 0, segmentIndex: 0, t: 0.9 },
        'midpoint',
      );

    const [first, second] = curves()[0]?.segments ?? [];
    if (first === undefined || second === undefined) throw new Error('no node was inserted');
    const before = length(HOOK.start, first);
    const after = length(first.to, second);
    // At t = 0.5 the node landed at (6.875, 22.5), 38.7% of the way along.
    expect(before / (before + after)).toBeCloseTo(0.5, 4);
  });
});

describe('a node moved with its own handle moves the handle once', () => {
  it('nudges both by the same distance', () => {
    load(art([HOOK]));
    select(anchor(0), { ...anchor(0), handle: 'outgoing' });

    useStore.getState().nudgeSelectedPathNode(1, 0);

    const segment = curves()[0]?.segments[0];
    if (segment?.kind !== 'cubic') throw new Error('expected a cubic');
    expect(curves()[0]?.start).toEqual({ x: 1, y: 0 });
    // Moved 2 before: once with its node and once more as a selected handle.
    expect(segment.control1).toEqual({ x: 1, y: 30 });
  });

  it('puts a typed handle position exactly where it was typed', () => {
    load(art([HOOK]));
    select(anchor(0), { ...anchor(0), handle: 'outgoing' });

    // The handle at (0, 30) is the primary node: type X = -10 for it.
    useStore.getState().setSelectedPathNodeCoordinate('x', -10);

    const segment = curves()[0]?.segments[0];
    if (segment?.kind !== 'cubic') throw new Error('expected a cubic');
    // It landed one move past the typed value, at X = -20, before.
    expect(segment.control1).toEqual({ x: -10, y: 30 });
    expect(curves()[0]?.start).toEqual({ x: -10, y: 0 });
  });

  it('keeps a dragged handle under the pointer', () => {
    load(art([HOOK]));
    select(anchor(0), { ...anchor(0), handle: 'outgoing' });

    // Two pointer events at the same place; the handle alternated before.
    for (let event = 0; event < 2; event += 1) {
      useStore.getState().setSelectedPathNodePositionDuringInteraction({ x: 4, y: 33 });
      const segment = curves()[0]?.segments[0];
      if (segment?.kind !== 'cubic') throw new Error('expected a cubic');
      expect(segment.control1).toEqual({ x: 4, y: 33 });
      expect(curves()[0]?.start).toEqual({ x: 4, y: 3 });
    }
  });
});

describe('node commands say why they change nothing', () => {
  it('names the node floor when Delete would leave too few nodes', () => {
    load(art([TRIANGLE]));
    select(anchor(1));

    useStore.getState().deleteSelectedPathNodes();

    expect(curves()[0]).toEqual(TRIANGLE);
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe(
      'Node not deleted: a closed path keeps at least 3 nodes, an open path 2.',
    );
  });

  it('says Smooth and Corner need curves on both sides of the node', () => {
    load(art([TRIANGLE]));
    select(anchor(1));

    useStore.getState().smoothSelectedCurveNode();
    useStore.getState().cornerSelectedCurveNode();

    expect(curves()[0]).toEqual(TRIANGLE);
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([
      'Smooth needs a curve on both sides of the node. Press S over a straight segment to make it a curve first.',
      'Corner needs a curve on both sides of the node. Press S over a straight segment to make it a curve first.',
    ]);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });
});

function anchor(pointIndex: number): PathNodeRef {
  return { objectId: 'art', pathIndex: 0, polylineIndex: 0, pointIndex, geometry: 'curve' };
}

function select(...refs: ReadonlyArray<PathNodeRef>): void {
  useStore.setState({
    selectedObjectId: 'art',
    selectedPathNode: refs.at(-1) ?? null,
    selectedPathNodes: refs,
  });
}

function art(contours: ReadonlyArray<CurveSubpath>): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'art',
    source: 'art.svg',
    bounds: { minX: 0, minY: 0, maxX: 40, maxY: 30 },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['cut'],
    paths: [
      {
        color: '#000000',
        curves: contours,
        polylines: contours.map((curve) => {
          const flattened = flattenCurveSubpath(curve, { toleranceMm: 0.05 });
          if (flattened.kind !== 'ok') throw new Error('the outline did not flatten');
          return flattened.polyline;
        }),
      },
    ],
  };
}

function load(object: ImportedSvg): void {
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects: [object],
        layers: [createLayer({ id: 'cut', color: '#000000' })],
        groups: [],
      },
    },
    undoStack: [],
  });
}

function curves(): ReadonlyArray<CurveSubpath> {
  const object = useStore.getState().project.scene.objects[0];
  return object !== undefined && 'paths' in object ? (object.paths[0]?.curves ?? []) : [];
}

function length(from: Vec2, segment: PathSegment): number {
  if (segment.kind !== 'cubic') throw new Error('expected a cubic');
  let total = 0;
  let previous = from;
  for (let step = 1; step <= 2000; step += 1) {
    const t = step / 2000;
    const m = 1 - t;
    const point = {
      x:
        m * m * m * from.x +
        3 * m * m * t * segment.control1.x +
        3 * m * t * t * segment.control2.x +
        t * t * t * segment.to.x,
      y:
        m * m * m * from.y +
        3 * m * m * t * segment.control1.y +
        3 * m * t * t * segment.control2.y +
        t * t * t * segment.to.y,
    };
    total += Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
  }
  return total;
}
