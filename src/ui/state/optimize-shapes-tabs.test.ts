// Rolling audit v8 N3-P1-2 (ADR-494 Amendment 3): Optimize Shapes starts a
// closed contour again at its first corner. Tabs placed by hand are fractions
// of the contour from its start (ADR-156), so on a part drawn from the middle
// of an edge they burned and cut 14.42 mm round the part while the notice said
// "the outlines did not move". They now stay where they were.
import { beforeEach, describe, expect, it } from 'vitest';
import { burnedTabSpans } from '../../__fixtures__/burned-tab-spans';
import { cncTabAnchorPosition } from '../../core/cnc/cnc-tab-anchors';
import { DEFAULT_SHAPE_OPTIMIZE_OPTIONS } from '../../core/geometry/shape-optimize/shape-optimize-options';
import { laserTabAnchorPosition } from '../../core/job/laser-tab-anchors';
import {
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type CncTabAnchor,
  type ImportedSvg,
  type Project,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

const COLOR = '#000000';
const GCODE_MM = 0.003;

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

describe('Optimize Shapes keeps tabs placed by hand where they were', () => {
  it('burns and cuts them in place on a part drawn from the middle of an edge', () => {
    // L6-P1-1's part: the laser tab 12 mm along at (32, 0), the CNC tab at (8, 20).
    const before = part([p(20, 0), p(40, 0), p(40, 20), p(0, 20), p(0, 0)], [0.1], [0.6]);
    const spansBefore = load(before);

    expect(useStore.getState().optimizeSelectedShapes(DEFAULT_SHAPE_OPTIMIZE_OPTIONS)).toBe(true);

    const after = current();
    expect(after.paths[0]?.polylines[0]?.points[0]).toEqual(p(40, 0));
    // Before the fix: (140, 288) and the CNC tab at (100, 108), 14.42 mm away.
    expectSamePoints(burnedTabSpans(useStore.getState().project), spansBefore, GCODE_MM);
    expectTabsWithin(before, after, 1e-9);
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe(
      'Optimized 1 object: 5 points became 4 segments; the outlines did not move.',
    );
    useStore.getState().undo();
    expect(current()).toEqual(before);
  });

  it('keeps every tab of an L-shaped part in place', () => {
    const before = part(
      [p(10, 0), p(20, 0), p(20, 10), p(40, 10), p(40, 20), p(0, 20), p(0, 0)],
      [0.2, 0.7],
      [0.45],
    );
    const spansBefore = load(before);

    useStore.getState().optimizeSelectedShapes(DEFAULT_SHAPE_OPTIMIZE_OPTIONS);

    // Before the fix: 15.23 and 15.81 mm.
    expectSamePoints(burnedTabSpans(useStore.getState().project), spansBefore, GCODE_MM);
    expectTabsWithin(before, current(), 1e-9);
  });
});

function p(x: number, y: number): Vec2 {
  return { x, y };
}

function anchors(pathTs: ReadonlyArray<number>): ReadonlyArray<CncTabAnchor> {
  return pathTs.map((pathT) => ({ layerColor: COLOR, pathIndex: 0, polylineIndex: 0, pathT }));
}

function part(
  points: ReadonlyArray<Vec2>,
  laserTs: ReadonlyArray<number>,
  cncTs: ReadonlyArray<number>,
): ImportedSvg {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    kind: 'imported-svg',
    id: 'part',
    source: 'part.svg',
    bounds: {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    },
    transform: { ...IDENTITY_TRANSFORM, x: 100, y: 100 },
    operationIds: ['cut'],
    paths: [{ color: COLOR, polylines: [{ closed: true, points }] }],
    laserTabAnchors: anchors(laserTs),
    cncTabAnchors: anchors(cncTs),
  };
}

// Loads the part on a line layer that burns its tabs at a fifth of the power,
// and returns the tab spans it burns.
function load(object: SceneObject): ReadonlyArray<Vec2> {
  const layer = {
    ...createLayer({ id: 'cut', name: 'cut', color: COLOR }),
    mode: 'line' as const,
    power: 50,
    tabsEnabled: true,
    tabSizeMm: 2,
    tabsPerShape: 4,
    tabCutPowerPercent: 20,
  };
  const project: Project = {
    ...createProject(),
    scene: { objects: [object], layers: [layer], groups: [] },
  };
  useStore.setState({
    project,
    selectedObjectId: object.id,
    additionalSelectedIds: new Set(),
    dirty: false,
  });
  return burnedTabSpans(project);
}

function current(): ImportedSvg {
  const object = useStore.getState().project.scene.objects[0];
  if (object?.kind !== 'imported-svg') throw new Error('the part is gone');
  return object;
}

function expectTabsWithin(before: SceneObject, after: SceneObject, limit: number): void {
  const places = (object: SceneObject) => [
    ...(object.laserTabAnchors ?? []).map((anchor) => laserTabAnchorPosition(object, anchor)),
    ...(object.cncTabAnchors ?? []).map((anchor) => cncTabAnchorPosition(object, anchor)),
  ];
  const want = places(before);
  const got = places(after);
  expect(got).toHaveLength(want.length);
  got.forEach((point, index) => {
    const target = want[index];
    if (point === null || target === null || target === undefined) {
      throw new Error(`tab ${index} is not on its contour`);
    }
    expect(Math.hypot(point.x - target.x, point.y - target.y)).toBeLessThan(limit);
  });
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
