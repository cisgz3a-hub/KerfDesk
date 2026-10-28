// Edit nodes Delete and Radius / Fillet can restart a closed contour: deleting
// its start node starts it at the next kept node, and rounding its start
// corner starts it where the arc ends. Tabs placed by hand, laser and CNC, stay
// where they were on the part, so the burn and the cut leave their gaps in the
// same places; a tab on a part of the outline the edit changed moves to the
// nearest point of the new outline, and the toast says so (ADR-494 Amendment 2).
import { beforeEach, describe, expect, it } from 'vitest';
import { cncTabAnchorPosition } from '../../core/cnc/cnc-tab-anchors';
import { compileCncJob } from '../../core/cnc/compile-cnc-job';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { compileJob } from '../../core/job/compile-job';
import { laserTabAnchorPosition } from '../../core/job/laser-tab-anchors';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  flattenCurveSubpath,
  type CncTabAnchor,
  type ColoredPath,
  type CubicPathSegment,
  type CurveSubpath,
  type ImportedSvg,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import type { LaserTabAnchor } from '../../core/scene/scene-object';
import type { PathNodeRef } from './path-node-edit-actions';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

const COLOR = '#000000';

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

describe('Delete node keeps tabs placed by hand where they were', () => {
  it('moves no tab, in the burn or the cut, when the redundant start node goes', () => {
    // A 40 x 20 part drawn from the middle of its bottom edge, the audit's
    // case: the laser tab 12 mm along at (32, 0), the CNC tab at (8, 20).
    const before = part(
      [{ color: COLOR, polylines: [closed([p(20, 0), p(40, 0), p(40, 20), p(0, 20), p(0, 0)])] }],
      tabs(0.1, 0.35),
      tabs(0.6),
    );
    load(before, { pathIndex: 0, polylineIndex: 0, pointIndex: 0 });

    useStore.getState().deleteSelectedPathNodes();

    const after = current();
    expect(after.paths[0]?.polylines[0]?.points[0]).toEqual(p(40, 0));
    expectTabsWithin(before, after, 1e-9);
    // Before the fix the laser tab burned on the right edge and the CNC tab
    // cut on the left one, both 14.42 mm away.
    expectSamePoints(laserTabSpans(after), laserTabSpans(before), 1e-9);
    expectSamePoints(cncTabRises(after), cncTabRises(before), 1e-6);
    expect(useToastStore.getState().toasts).toEqual([]);
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it('keeps tabs on the untouched curves exactly and the others on the refitted one', () => {
    const curve = circle(25);
    // Tabs on the first and last quarters sit on the curve refitted across the
    // deleted start node; the middle two quarters are untouched.
    const before = curvedPart(curve, tabs(0.1, 0.375, 0.625, 0.9), tabs(0.2, 0.4));
    load(before, { pathIndex: 0, polylineIndex: 0, pointIndex: 0, geometry: 'curve' });

    useStore.getState().deleteSelectedPathNodes();

    const after = current();
    expect(after.paths[0]?.curves?.[0]?.start).toEqual(curve.segments[0]?.to);
    const moved = (object: SceneObject) =>
      (object.laserTabAnchors ?? []).map((anchor) => laserTabAnchorPosition(object, anchor));
    const [first, second, third, last] = distances(moved(before), moved(after));
    expect(second).toBeLessThan(1e-9);
    expect(third).toBeLessThan(1e-9);
    // The single cubic stays within 0.3 mm of the circle; before the fix these
    // tabs moved about 35 mm round the part.
    expect(first).toBeLessThan(0.3);
    expect(last).toBeLessThan(0.3);
    expectTabsWithin(before, after, 0.3);
  });
});

describe('Radius / Fillet keeps tabs placed by hand where they were', () => {
  it('moves no tab on a straight side when the start corner is rounded', () => {
    const before = part(
      [{ color: COLOR, polylines: [closed([p(0, 0), p(40, 0), p(40, 20), p(0, 20)])] }],
      tabs(0.1),
      tabs(0.6),
    );
    load(before, null);

    useStore.getState().filletSelection(5, 'round');

    const after = current();
    const start = after.paths[0]?.curves?.[0]?.start;
    expect(start?.x).toBeCloseTo(5, 12);
    expect(start?.y).toBe(0);
    // Before the fix both tabs moved 4.14 mm along their edges.
    expectTabsWithin(before, after, 1e-9);
    expectSamePoints(laserTabSpans(after), laserTabSpans(before), 1e-9);
    // The rounded profile is offset afresh; its tab rises agree within 0.4 µm,
    // under the G-code's 0.001 mm resolution.
    expectSamePoints(cncTabRises(after), cncTabRises(before), 1e-3);
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe('Rounded 4 corners.');
  });

  it('moves a tab in a rounded-off corner onto the arc and says so', () => {
    // 1.2 mm along the bottom edge, inside the r 5 corner the fillet cuts off.
    const before = part(
      [{ color: COLOR, polylines: [closed([p(0, 0), p(40, 0), p(40, 20), p(0, 20)])] }],
      tabs(0.01, 0.1),
      [],
    );
    load(before, null);

    useStore.getState().filletSelection(5, 'round');

    const after = current();
    const local = laserTabLocal(after, 0);
    // On the arc about (5, 5), to within the flattening of the arc.
    expect(Math.abs(Math.hypot(local.x - 5, local.y - 5) - 5)).toBeLessThan(0.03);
    expectTabsWithin(before, after, [1.3, 1e-9]);
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe(
      'Rounded 4 corners. 1 placed tab sat on the changed outline and moved to the nearest point of it. Undo restores them.',
    );
    useStore.getState().undo();
    expect(current().laserTabAnchors).toEqual(before.laserTabAnchors);
  });
});

function p(x: number, y: number): Vec2 {
  return { x, y };
}

function closed(points: ReadonlyArray<Vec2>) {
  return { closed: true, points };
}

function tabs(...pathTs: ReadonlyArray<number>): ReadonlyArray<CncTabAnchor> {
  return pathTs.map((pathT) => ({ layerColor: COLOR, pathIndex: 0, polylineIndex: 0, pathT }));
}

// Four quarter cubics ending exactly on the start.
function circle(radius: number): CurveSubpath {
  const quarter = (a0: number): CubicPathSegment => {
    const a1 = a0 + Math.PI / 2;
    const arm = (4 / 3) * Math.tan(Math.PI / 8) * radius;
    return {
      kind: 'cubic',
      control1: {
        x: radius * Math.cos(a0) - arm * Math.sin(a0),
        y: radius * Math.sin(a0) + arm * Math.cos(a0),
      },
      control2: {
        x: radius * Math.cos(a1) + arm * Math.sin(a1),
        y: radius * Math.sin(a1) - arm * Math.cos(a1),
      },
      to: a1 >= 2 * Math.PI - 1e-9 ? p(radius, 0) : p(radius * Math.cos(a1), radius * Math.sin(a1)),
    };
  };
  return {
    start: p(radius, 0),
    closed: true,
    segments: [0, 1, 2, 3].map((q) => quarter((q * Math.PI) / 2)),
  };
}

function curvedPart(
  curve: CurveSubpath,
  laserTabAnchors: ReadonlyArray<LaserTabAnchor>,
  cncTabAnchors: ReadonlyArray<CncTabAnchor>,
): ImportedSvg {
  const flattened = flattenCurveSubpath(curve, { toleranceMm: 0.05 });
  if (flattened.kind !== 'ok') throw new Error('the outline did not flatten');
  return part(
    [{ color: COLOR, curves: [curve], polylines: [flattened.polyline] }],
    laserTabAnchors,
    cncTabAnchors,
  );
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
    bounds: { minX: -25, minY: -25, maxX: 40, maxY: 25 },
    transform: { ...IDENTITY_TRANSFORM, x: 100, y: 100, rotationDeg: 30 },
    operationIds: ['cut'],
    paths,
    laserTabAnchors,
    cncTabAnchors,
  };
}

function load(object: SceneObject, node: Omit<PathNodeRef, 'objectId'> | null): void {
  const ref = node === null ? null : { objectId: object.id, ...node };
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
    selectedPathNodes: ref === null ? [] : [ref],
    dirty: false,
  });
}

function current(): ImportedSvg {
  const object = useStore.getState().project.scene.objects[0];
  if (object?.kind !== 'imported-svg') throw new Error('the part is gone');
  return object;
}

function laserTabLocal(object: ImportedSvg, index: number): Vec2 {
  const anchor = object.laserTabAnchors?.[index];
  const world = anchor === undefined ? null : laserTabAnchorPosition(object, anchor);
  if (world === null) throw new Error(`tab ${index} is not on its contour`);
  // The part is turned 30° about its origin at (100, 100), unscaled.
  const rad = (-30 * Math.PI) / 180;
  const dx = world.x - 100;
  const dy = world.y - 100;
  return { x: dx * Math.cos(rad) - dy * Math.sin(rad), y: dx * Math.sin(rad) + dy * Math.cos(rad) };
}

// Every laser and CNC tab is on the part, within `limit` of its old place;
// a list gives each tab its own limit.
function expectTabsWithin(
  before: SceneObject,
  after: SceneObject,
  limit: number | ReadonlyArray<number>,
): void {
  const laser = (object: SceneObject) =>
    (object.laserTabAnchors ?? []).map((anchor) => laserTabAnchorPosition(object, anchor));
  const cnc = (object: SceneObject) =>
    (object.cncTabAnchors ?? []).map((anchor) => cncTabAnchorPosition(object, anchor));
  const each = (index: number): number => (typeof limit === 'number' ? limit : (limit[index] ?? 0));
  distances(laser(before), laser(after)).forEach((moved, index) =>
    expect(moved).toBeLessThan(each(index)),
  );
  distances(cnc(before), cnc(after)).forEach((moved, index) =>
    expect(moved).toBeLessThan(each(index)),
  );
}

function distances(
  before: ReadonlyArray<Vec2 | null>,
  after: ReadonlyArray<Vec2 | null>,
): ReadonlyArray<number> {
  expect(after).toHaveLength(before.length);
  return after.map((point, index) => {
    const want = before[index];
    if (point === null || want === null || want === undefined) {
      throw new Error(`tab ${index} is not on its contour`);
    }
    return Math.hypot(point.x - want.x, point.y - want.y);
  });
}

// The midpoints of the burned tab spans of a GRBL laser job.
function laserTabSpans(object: SceneObject): ReadonlyArray<Vec2> {
  const layer = {
    ...createLayer({ id: 'cut', color: COLOR }),
    tabsEnabled: true,
    tabSizeMm: 2,
    tabsPerShape: 4,
    power: 50,
    tabCutPowerPercent: 20,
  };
  const job = compileJob({ objects: [object], layers: [layer] }, DEFAULT_DEVICE_PROFILE);
  const spans = job.groups.flatMap((group) =>
    group.kind === 'cut' && group.tabSpanPowerPercent !== undefined ? group.segments : [],
  );
  expect(spans.length).toBeGreaterThan(0);
  return spans.map((span) => {
    const first = span.polyline[0] as Vec2;
    const last = span.polyline.at(-1) as Vec2;
    return p((first.x + last.x) / 2, (first.y + last.y) / 2);
  });
}

// Where the deepest pass of an outside profile rises over a tab.
function cncTabRises(object: SceneObject): ReadonlyArray<Vec2> {
  const layer = {
    ...createLayer({ id: 'cut', color: COLOR }),
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'profile-outside' as const,
      depthMm: 6,
      depthPerPassMm: 3,
      tabsEnabled: true,
      tabHeightMm: 2,
      tabWidthMm: 6,
      tabsPerShape: 4,
    },
  };
  const job = compileCncJob(
    { layers: [layer], objects: [object] },
    DEFAULT_DEVICE_PROFILE,
    DEFAULT_CNC_MACHINE_CONFIG,
  );
  const rises: Vec2[] = [];
  for (const group of job.groups) {
    if (group.kind !== 'cnc') continue;
    for (const pass of group.passes) {
      if (pass.kind !== 'path3d') continue;
      const deepest = Math.min(...pass.points.map((point) => point.z));
      if (Math.abs(deepest + 6) > 1e-9) continue;
      pass.points.forEach((point, index) => {
        const previous = pass.points[index - 1];
        if (previous !== undefined && point.z > previous.z + 1e-9) rises.push(p(point.x, point.y));
      });
    }
  }
  expect(rises.length).toBeGreaterThan(0);
  return rises;
}

function expectSamePoints(
  actual: ReadonlyArray<Vec2>,
  expected: ReadonlyArray<Vec2>,
  tolerance: number,
): void {
  const sorted = (points: ReadonlyArray<Vec2>) =>
    [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const got = sorted(actual);
  const want = sorted(expected);
  expect(got).toHaveLength(want.length);
  got.forEach((point, index) => {
    const target = want[index] as Vec2;
    expect(Math.hypot(point.x - target.x, point.y - target.y)).toBeLessThan(tolerance);
  });
}
