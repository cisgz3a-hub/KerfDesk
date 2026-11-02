// Rolling audit v9 R3-P2-2 (ADR-494 Amendment 4): Shear, Warp and Deform change
// each edge's share of its contour, so a tab that keeps its fraction moves along
// the part and can change edge. Each tab now goes through the same map as its
// outline. The expected places come from the same map applied to the old place.
import { beforeEach, describe, expect, it } from 'vitest';
import { warpDeformMap } from '../../core/geometry/warp-deform-map';
import {
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import {
  TAB_COLOR,
  cncTabRises,
  expectSamePoints,
  expectSpansAt,
  expectTabsAt,
  p,
  tabPlaces,
  tabbedProject,
  withPlacedTabs,
} from './placed-tabs.test-support';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';
import { warpDeformRequestForSelection } from './warp-deform-plan';
import type { WarpDeformRequest } from './warp-deform-session';

// Mid-edge, and 4 mm from a corner of the bottom edge: the audit's worst tab,
// which changed edge from 30°.
const TABS = [p(200, 125), p(150, 150), p(100, 125), p(150, 100), p(196, 100)];

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

// A 100 × 50 imported part at (100, 100), drawn from its corner.
function part(id: string, x = 100, tabs: ReadonlyArray<Vec2> = TABS): ImportedSvg {
  const w = 100;
  const h = 50;
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: w, maxY: h },
    transform: { ...IDENTITY_TRANSFORM, x, y: 100 },
    operationIds: ['cut'],
    paths: [
      {
        color: TAB_COLOR,
        operationIds: ['cut'],
        polylines: [
          {
            closed: true,
            points: [p(0, 0), p(w, 0), p(w, h), p(0, h), p(0, 0)],
          },
        ],
      },
    ],
  };
  return withPlacedTabs(object, tabs);
}

function load(objects: ReadonlyArray<SceneObject>): void {
  useStore.setState({
    project: tabbedProject(objects),
    selectedObjectId: objects[0]?.id ?? null,
    additionalSelectedIds: new Set(objects.slice(1).map((object) => object.id)),
    dirty: false,
  });
}

function object(id: string): SceneObject {
  const found = useStore.getState().project.scene.objects.find((item) => item.id === id);
  if (found === undefined) throw new Error('the part is gone');
  return found;
}

function shearedX(point: Vec2, degrees: number, centreY: number): Vec2 {
  return p(point.x + Math.tan((degrees * Math.PI) / 180) * (point.y - centreY), point.y);
}

describe('Shear', () => {
  it.each([5, 15, 30, 45, 60])('keeps each tab on its own edge at %d degrees', (degrees) => {
    load([part('a')]);
    const before = object('a');

    useStore.getState().shearSelection(degrees, 0);

    const expected = TABS.map((tab) => shearedX(tab, degrees, 125));
    // Before the fix: 2.579 mm at 30°, 16.667 at 60°, and 31.527 for the last
    // tab, which landed on the sloped side.
    expectTabsAt(object('a'), expected);
    expectSpansAt(useStore.getState().project, expected);
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe('Sheared 1 object.');
    useStore.getState().undo();
    expect(object('a')).toEqual(before);
    useStore.getState().redo();
    expectTabsAt(object('a'), expected);
  });

  it('rises the CNC cut where a part drawn sheared with its tabs placed there rises', () => {
    load([part('a')]);

    useStore.getState().shearSelection(45, 0);

    const expected = TABS.map((tab) => shearedX(tab, 45, 125));
    const twin = withPlacedTabs(sheared45Twin(), expected);
    expectSamePoints(cncTabRises(object('a')), cncTabRises(twin), 1e-6);
  });

  it('shears a multi-selection about the selection centre, each tab with its part', () => {
    const second = TABS.map((tab) => p(tab.x + 200, tab.y));
    load([part('a'), part('b', 300, second)]);

    useStore.getState().shearSelection(30, 0);

    expectTabsAt(
      object('a'),
      TABS.map((tab) => shearedX(tab, 30, 125)),
    );
    expectTabsAt(
      object('b'),
      second.map((tab) => shearedX(tab, 30, 125)),
    );
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it('follows a rotated, scaled and mirrored part', () => {
    const turned: ImportedSvg = {
      ...bare(part('a')),
      transform: {
        ...IDENTITY_TRANSFORM,
        x: 200,
        y: 200,
        rotationDeg: 30,
        scaleX: 2,
        scaleY: 0.5,
        mirrorX: true,
      },
    };
    const start = tabPlacesOnEdges(turned);
    load([withPlacedTabs(turned, start)]);
    const box = useStore.getState().project.scene.objects;
    expect(box).toHaveLength(1);

    useStore.getState().shearSelection(30, 0);

    // The shear is about the centre of the world box, which it leaves alone.
    const centreY = worldCentreY(turned);
    expectTabsAt(
      object('a'),
      start.map((tab) => shearedX(tab, 30, centreY)),
      1e-3,
    );
  });
});

describe('Warp and Deform', () => {
  it.each(['warp', 'deform'] as const)('carries each tab through the %s map', (grid) => {
    load([part('a')]);
    const before = object('a');
    const request = pulledCorner(grid);
    const map = warpDeformMap(request.grid, request.box, request.handles);

    useStore.getState().applyWarpDeform(request);

    // Before the fix: up to 45.327 mm off.
    const expected = TABS.map((tab) => map.apply(tab));
    const after = object('a');
    for (const [index, place] of tabPlaces(after).entries()) {
      const target = expected[index] as Vec2;
      // Deform bends straight lines, so the chord can stray by its tolerance.
      expect(Math.hypot(place.x - target.x, place.y - target.y)).toBeLessThan(0.06);
    }
    expect(useToastStore.getState().toasts.at(-1)?.message).not.toContain('placed tab');
    useStore.getState().undo();
    expect(object('a')).toEqual(before);
  });

  it('burns the tab spans at the warped places, and rises the CNC cut there', () => {
    load([part('a')]);
    const request = pulledCorner('warp');
    const map = warpDeformMap(request.grid, request.box, request.handles);

    useStore.getState().applyWarpDeform(request);

    const expected = TABS.map((tab) => map.apply(tab));
    expectSpansAt(useStore.getState().project, expected, 0.01);
    const twin = withPlacedTabs(warpedTwin(object('a')), expected);
    expectSamePoints(cncTabRises(object('a')), cncTabRises(twin), 1e-3);
  });

  it('carries a drawn shape converted to paths first, in world coordinates', () => {
    const rectangle = createRectangle({
      id: 'r',
      color: TAB_COLOR,
      spec: { widthMm: 100, heightMm: 50, cornerRadiusMm: 10 },
      transform: { ...IDENTITY_TRANSFORM, x: 100, y: 100 },
    });
    load([withPlacedTabs({ ...rectangle, operationIds: ['cut'] }, [p(200, 125), p(150, 150)])]);
    const request = pulledCorner('warp');
    const map = warpDeformMap(request.grid, request.box, request.handles);

    useStore.getState().applyWarpDeform(request);

    const after = object('r');
    expect(after.kind).toBe('imported-svg');
    expectTabsAt(after, [map.apply(p(200, 125)), map.apply(p(150, 150))], 1e-3);
  });

  it('carries each part of a multi-selection through the one map', () => {
    const second = TABS.map((tab) => p(tab.x + 200, tab.y));
    load([part('a'), part('b', 300, second)]);
    const request = pulledCorner('warp');
    const map = warpDeformMap(request.grid, request.box, request.handles);

    useStore.getState().applyWarpDeform(request);

    expectTabsAt(
      object('a'),
      TABS.map((tab) => map.apply(tab)),
      1e-3,
    );
    expectTabsAt(
      object('b'),
      second.map((tab) => map.apply(tab)),
      1e-3,
    );
    expect(useStore.getState().undoStack).toHaveLength(1);
  });
});

describe('controls', () => {
  it('a part with no placed tabs gets none from Shear or Warp', () => {
    load([bare(part('a'))]);

    useStore.getState().shearSelection(30, 0);
    useStore.getState().applyWarpDeform(pulledCorner('warp'));

    expect('laserTabAnchors' in object('a')).toBe(false);
    expect('cncTabAnchors' in object('a')).toBe(false);
  });
});

function bare(object: ImportedSvg): ImportedSvg {
  const { laserTabAnchors: _laser, cncTabAnchors: _cnc, ...rest } = object;
  return rest;
}

// One corner of the selection's box pulled (+60, +60).
function pulledCorner(grid: 'warp' | 'deform'): WarpDeformRequest {
  const state = useStore.getState();
  const ids = [
    ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
    ...state.additionalSelectedIds,
  ];
  const request = warpDeformRequestForSelection(state.project.scene, ids, grid);
  if (request === null) throw new Error('nothing to bend');
  const corner = request.handles.length - 1;
  return {
    ...request,
    handles: request.handles.map((handle, index) =>
      index === corner ? p(handle.x + 60, handle.y + 60) : handle,
    ),
  };
}

function sheared45Twin(): ImportedSvg {
  const corners = [p(100, 100), p(200, 100), p(200, 150), p(100, 150)].map((corner) =>
    shearedX(corner, 45, 125),
  );
  return polygonPart('twin', corners);
}

function warpedTwin(warped: SceneObject): ImportedSvg {
  if (!('paths' in warped)) throw new Error('the part has no paths');
  const points = warped.paths[0]?.polylines[0]?.points ?? [];
  const world = points.map((point) =>
    p(point.x + warped.transform.x, point.y + warped.transform.y),
  );
  return polygonPart('twin', world);
}

function polygonPart(id: string, corners: ReadonlyArray<Vec2>): ImportedSvg {
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const first = corners[0] as Vec2;
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['cut'],
    paths: [
      {
        color: TAB_COLOR,
        operationIds: ['cut'],
        polylines: [{ closed: true, points: [...corners, first] }],
      },
    ],
  };
}

function worldCorners(object: ImportedSvg): ReadonlyArray<Vec2> {
  const rad = (object.transform.rotationDeg * Math.PI) / 180;
  const sx = object.transform.scaleX * (object.transform.mirrorX === true ? -1 : 1);
  const sy = object.transform.scaleY * (object.transform.mirrorY === true ? -1 : 1);
  return [p(0, 0), p(100, 0), p(100, 50), p(0, 50)].map((corner) => ({
    x: object.transform.x + sx * corner.x * Math.cos(rad) - sy * corner.y * Math.sin(rad),
    y: object.transform.y + sx * corner.x * Math.sin(rad) + sy * corner.y * Math.cos(rad),
  }));
}

function tabPlacesOnEdges(object: ImportedSvg): ReadonlyArray<Vec2> {
  const corners = worldCorners(object);
  return corners.map((corner, index) => {
    const next = corners[(index + 1) % corners.length] as Vec2;
    return p((corner.x + next.x) / 2, (corner.y + next.y) / 2);
  });
}

function worldCentreY(object: ImportedSvg): number {
  const ys = worldCorners(object).map((corner) => corner.y);
  return (Math.min(...ys) + Math.max(...ys)) / 2;
}
