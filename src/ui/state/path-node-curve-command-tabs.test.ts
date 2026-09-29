// The node tool's Start and Break redraw a closed contour from the selected
// node. Tabs placed by hand, laser and CNC, stay where they were on the part
// (ADR-494 Amendment 1).
import { beforeEach, describe, expect, it } from 'vitest';
import { cncTabAnchorPosition } from '../../core/cnc/cnc-tab-anchors';
import { laserTabAnchorPosition } from '../../core/job/laser-tab-anchors';
import {
  createLayer,
  createProject,
  flattenCurveSubpath,
  IDENTITY_TRANSFORM,
  type CncTabAnchor,
  type ColoredPath,
  type CurveSubpath,
  type ImportedSvg,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import type { LaserTabAnchor } from '../../core/scene/scene-object';
import type { PathNodeRef } from './path-node-edit-actions';
import { useStore } from './store';
import { resetStore } from './test-helpers';

const COLOR = '#000000';
// A 40 x 20 part drawn from (0, 0), its start repeated at the end.
const PART = [p(0, 0), p(40, 0), p(40, 20), p(0, 20), p(0, 0)];
const HOLE = [p(5, 5), p(10, 5), p(10, 10), p(5, 10), p(5, 5)];

beforeEach(() => {
  resetStore();
});

describe('node tool Start keeps tabs placed by hand where they were', () => {
  it('moves no laser or CNC tab on a polyline part and leaves other contours alone', () => {
    const laser = [...tabs(0, 0, 0.1, 0.45, 0.8, 0), ...tabs(0, 1, 0.3)];
    const cnc = tabs(0, 0, 0.1, 0.6);
    const before = part([{ color: COLOR, polylines: [closed(PART), closed(HOLE)] }], laser, cnc);
    load(before, { pathIndex: 0, polylineIndex: 0, pointIndex: 2 });

    useStore.getState().setSelectedCurveStart();

    const after = current();
    expect(after.paths[0]?.polylines[0]?.points[0]).toEqual(p(40, 20));
    expectTabsInPlace(before, after);
    // The new start is 60 mm, half, along the 120 mm outline; the hole is untouched.
    const moved = after.laserTabAnchors?.map((anchor) => anchor.pathT) ?? [];
    [0.6, 0.95, 0.3, 0.5].forEach((pathT, index) => expect(moved[index]).toBeCloseTo(pathT, 12));
    expect(after.laserTabAnchors?.[4]).toEqual(laser[4]);
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it('moves no tab on a curved outline', () => {
    const curve = roundedPart();
    const flattened = flattenCurveSubpath(curve, { toleranceMm: 0.05 });
    if (flattened.kind !== 'ok') throw new Error('the outline did not flatten');
    const before = part(
      [{ color: COLOR, curves: [curve], polylines: [flattened.polyline] }],
      tabs(0, 0, 0.05, 0.3, 0.62, 0.9),
      tabs(0, 0, 0.2, 0.7),
    );
    load(before, { pathIndex: 0, polylineIndex: 0, pointIndex: 3, geometry: 'curve' });

    useStore.getState().setSelectedCurveStart();

    const after = current();
    expect(after.paths[0]?.curves?.[0]?.start).toEqual(curve.segments[2]?.to);
    expectTabsInPlace(before, after);
  });

  it('moves no tab on a part closed by an implied line', () => {
    const before = part(
      [{ color: COLOR, polylines: [closed(PART.slice(0, -1))] }],
      tabs(0, 0, 0.05, 0.4, 0.95),
      tabs(0, 0, 0.7),
    );
    load(before, { pathIndex: 0, polylineIndex: 0, pointIndex: 3 });

    useStore.getState().setSelectedCurveStart();

    const after = current();
    expect(after.paths[0]?.polylines[0]?.points).toEqual([
      p(0, 20),
      p(0, 0),
      p(40, 0),
      p(40, 20),
      p(0, 20),
    ]);
    expectTabsInPlace(before, after);
  });
});

describe('node tool Break re-measures tabs placed by hand from the break', () => {
  it('holds no tab while open and puts every tab back when the path is closed again', () => {
    const before = part(
      [{ color: COLOR, polylines: [closed(PART), closed(HOLE)] }],
      [...tabs(0, 0, 0.1, 0.6), ...tabs(0, 1, 0.3)],
      tabs(0, 0, 0.9),
    );
    load(before, { pathIndex: 0, polylineIndex: 0, pointIndex: 2 });

    useStore.getState().breakSelectedCurve();

    const open = current();
    expect(open.paths[0]?.polylines[0]?.closed).toBe(false);
    expect(laserTabAnchorPosition(open, open.laserTabAnchors![0]!)).toBeNull();
    expect(laserTabAnchorPosition(open, open.laserTabAnchors![2]!)).toEqual(
      laserTabAnchorPosition(before, before.laserTabAnchors![2]!),
    );

    useStore.getState().closeSelectedPaths();

    const reclosed = current();
    expect(reclosed.paths[0]?.polylines[0]?.points[0]).toEqual(p(40, 20));
    expectTabsInPlace(before, reclosed);
  });

  it('puts every tab back when the open path is reversed before it is closed again', () => {
    const before = part(
      [{ color: COLOR, polylines: [closed(PART), closed(HOLE)] }],
      [...tabs(0, 0, 0.1, 0.6, 0), ...tabs(0, 1, 0.3)],
      tabs(0, 0, 0.9, 0.45),
    );
    load(before, { pathIndex: 0, polylineIndex: 0, pointIndex: 2 });

    useStore.getState().breakSelectedCurve();
    useStore.getState().reverseSelectedPaths();
    useStore.getState().closeSelectedPaths();

    // Broken at (40, 20), reversed and closed, the outline now starts at (40, 0).
    const reclosed = current();
    expect(reclosed.paths[0]?.polylines[0]?.points[0]).toEqual(p(40, 0));
    expectTabsInPlace(before, reclosed);
  });

  it('puts every tab back on a curved part reversed and closed again after Break', () => {
    const curve = dPart();
    const flattened = flattenCurveSubpath(curve, { toleranceMm: 0.05 });
    if (flattened.kind !== 'ok') throw new Error('the outline did not flatten');
    const before = part(
      [{ color: COLOR, curves: [curve], polylines: [flattened.polyline] }],
      tabs(0, 0, 0.05, 0.3, 0.55, 0.8, 0.95),
      tabs(0, 0, 0.2, 0.7),
    );
    // Break at the start drops the last segment, the straight edge back to it.
    load(before, { pathIndex: 0, polylineIndex: 0, pointIndex: 0, geometry: 'curve' });

    useStore.getState().breakSelectedCurve();
    useStore.getState().reverseSelectedPaths();
    useStore.getState().closeSelectedPaths();

    const reclosed = current();
    expect(reclosed.paths[0]?.curves?.[0]?.start).toEqual(p(0, 40));
    expectTabsInPlace(before, reclosed);
  });
});

function p(x: number, y: number): Vec2 {
  return { x, y };
}

function closed(points: ReadonlyArray<Vec2>) {
  return { closed: true, points };
}

function tabs(
  pathIndex: number,
  polylineIndex: number,
  ...pathTs: ReadonlyArray<number>
): LaserTabAnchor[] {
  return pathTs.map((pathT) => ({ layerColor: COLOR, pathIndex, polylineIndex, pathT }));
}

// Four cubic quarters from (0, 0) round a 40 x 20 box: every node is a corner of the curve.
function roundedPart(): CurveSubpath {
  const quarter = (from: Vec2, to: Vec2, bulge: Vec2) => ({
    kind: 'cubic' as const,
    control1: { x: from.x + bulge.x, y: from.y + bulge.y },
    control2: { x: to.x + bulge.x, y: to.y + bulge.y },
    to,
  });
  const [a, b, c, d] = [p(0, 0), p(40, 0), p(40, 20), p(0, 20)] as const;
  return {
    start: a,
    closed: true,
    segments: [
      quarter(a, b, p(0, -6)),
      quarter(b, c, p(5, 0)),
      quarter(c, d, p(0, 6)),
      quarter(d, a, p(-5, 0)),
    ],
  };
}

// A "D": two cubic bulges from (0, 0) round to (0, 40), then a straight edge back.
function dPart(): CurveSubpath {
  return {
    start: p(0, 0),
    closed: true,
    segments: [
      { kind: 'cubic', control1: p(20, 0), control2: p(30, 10), to: p(30, 20) },
      { kind: 'cubic', control1: p(30, 30), control2: p(20, 40), to: p(0, 40) },
      { kind: 'line', to: p(0, 0) },
    ],
  };
}

function part(
  paths: ReadonlyArray<ColoredPath>,
  laserTabAnchors: ReadonlyArray<LaserTabAnchor>,
  cncTabAnchors: ReadonlyArray<CncTabAnchor>,
): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'part',
    source: 'part.svg',
    bounds: { minX: -5, minY: -6, maxX: 45, maxY: 26 },
    transform: { ...IDENTITY_TRANSFORM, x: 30, y: 12, rotationDeg: 30, scaleX: 1.5 },
    operationIds: ['cut'],
    paths,
    laserTabAnchors,
    cncTabAnchors,
  };
}

function load(object: SceneObject, node: Omit<PathNodeRef, 'objectId'>): void {
  const ref = { objectId: object.id, ...node };
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects: [object],
        layers: [{ ...createLayer({ id: 'cut', name: 'cut', color: COLOR }), mode: 'line' }],
        groups: [],
      },
    },
    selectedObjectId: object.id,
    additionalSelectedIds: new Set(),
    selectedPathNode: ref,
    selectedPathNodes: [ref],
    dirty: false,
  });
}

function current(): ImportedSvg {
  const object = useStore.getState().project.scene.objects[0];
  if (object?.kind !== 'imported-svg') throw new Error('the part is gone');
  return object;
}

// Every laser and CNC tab is on the part, at the place it had before.
function expectTabsInPlace(before: SceneObject, after: SceneObject): void {
  const laser = (object: SceneObject) =>
    (object.laserTabAnchors ?? []).map((anchor) => laserTabAnchorPosition(object, anchor));
  const cnc = (object: SceneObject) =>
    (object.cncTabAnchors ?? []).map((anchor) => cncTabAnchorPosition(object, anchor));
  for (const [moved, placed] of [
    [laser(after), laser(before)],
    [cnc(after), cnc(before)],
  ] as const) {
    expect(moved).toHaveLength(placed.length);
    moved.forEach((point, index) => {
      const want = placed[index];
      if (point === null || want === null || want === undefined) {
        throw new Error(`tab ${index} is not on its contour`);
      }
      expect(Math.hypot(point.x - want.x, point.y - want.y)).toBeLessThan(1e-9);
    });
  }
}
