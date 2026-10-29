// Rolling audit v8 N3-P1-1 (ADR-494 Amendment 3) on the resize routes the
// toolbar test does not take: the canvas handle drag's frames, the
// registration jig editor's canvas, and the CNC cut. A resized rounded
// rectangle is rebuilt at its new size (ADR-144 Amendment 1); its tabs placed
// by hand go where the stretch puts them, and one on a rounded corner goes to
// the nearest point of the new corner.
import { beforeEach, describe, expect, it } from 'vitest';
import { burnedTabSpans } from '../../__fixtures__/burned-tab-spans';
import { cncTabAnchorPosition, projectCncTabAnchor } from '../../core/cnc/cnc-tab-anchors';
import { compileCncJob } from '../../core/cnc/compile-cnc-job';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords } from '../../core/devices';
import { laserTabAnchorPosition } from '../../core/job/laser-tab-anchors';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type Project,
  type SceneObject,
  type ShapeObject,
  type Vec2,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { withJigTransforms } from '../workspace/registration-jig/jig-canvas-selection';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

const COLOR = '#000000';
const GCODE_MM = 0.003;
// The audit's part: 100 × 50 r 10 at (100, 100), tabs at the middle of the
// right edge and of the far long edge.
const EDGE_TABS = [p(200, 125), p(150, 150)];
const STRETCHED_TABS = [p(300, 125), p(200, 150)];
// 30° round the r 10 corner about (190, 140).
const CORNER_TAB = p(190 + 10 * Math.cos(Math.PI / 6), 145);

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

describe('a resized rounded rectangle keeps its placed tabs on every route', () => {
  it('carries them through the frames of a canvas handle drag', () => {
    load(part(100, 50, 10, EDGE_TABS));

    // Each frame scales the current object to the pointer's width, as the
    // single-object handle drag does.
    useStore.getState().beginInteraction();
    for (const width of [130, 170, 200]) {
      const current = shape(useStore.getState().project);
      // Each frame leaves it rebuilt at scale 1, so its box is its width.
      const scaleX = width / (current.bounds.maxX - current.bounds.minX);
      useStore
        .getState()
        .setObjectTransforms([{ id: current.id, transform: { ...current.transform, scaleX } }]);
    }
    useStore.getState().endInteraction();

    const project = useStore.getState().project;
    expect(shape(project).spec).toMatchObject({ widthMm: 200, heightMm: 50, cornerRadiusMm: 10 });
    // Before the fix: 21.3 and 21.7 mm away, one on the corner arc.
    expectSpansAt(project, STRETCHED_TABS);
    expectTabsAt(shape(project), STRETCHED_TABS);
    // The cut rises over its tabs where a part drawn at that size with its
    // tabs placed there rises.
    expectSamePoints(
      cncTabRises(shape(project)),
      cncTabRises(part(200, 50, 10, STRETCHED_TABS)),
      1e-6,
    );
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it('carries them through the jig editor canvas', () => {
    const before = projectWith(part(100, 50, 10, EDGE_TABS));
    const object = shape(before);

    const after = withJigTransforms(before, [
      { id: object.id, transform: { ...object.transform, scaleX: 2 } },
    ]);

    expect(shape(after).spec).toMatchObject({ widthMm: 200, heightMm: 50, cornerRadiusMm: 10 });
    expectSpansAt(after, STRETCHED_TABS);
    expectTabsAt(shape(after), STRETCHED_TABS);
  });

  it('moves a tab on a rounded corner to the nearest point of the new corner', () => {
    load(part(100, 50, 10, [CORNER_TAB]));
    const current = shape(useStore.getState().project);

    useStore
      .getState()
      .setObjectTransforms([{ id: current.id, transform: { ...current.transform, scaleX: 2 } }]);

    const [placed] = tabPlaces(shape(useStore.getState().project));
    if (placed === undefined) throw new Error('the tab is gone');
    // The stretch puts it at (297.321, 145), 8.865 mm from the new corner's
    // centre (290, 140): it lands on that corner, 1.135 mm on.
    expect(Math.abs(Math.hypot(placed.x - 290, placed.y - 140) - 10)).toBeLessThan(0.03);
    expect(Math.abs(Math.hypot(placed.x - 297.321, placed.y - 145) - 1.135)).toBeLessThan(0.1);
  });
});

describe('Shape Properties says when a tab left its place', () => {
  it('names the corner tab a sharpened corner moved, and Undo puts it back', () => {
    load(part(100, 50, 10, [CORNER_TAB, ...EDGE_TABS]));
    const before = shape(useStore.getState().project);

    useStore
      .getState()
      .setShapeSpec(before.id, { kind: 'rect', widthMm: 100, heightMm: 50, cornerRadiusMm: 0 });

    const [moved, ...kept] = tabPlaces(shape(useStore.getState().project));
    // The right edge of the sharp corner is 1.34 mm from the tab; the laser
    // and the CNC tab there both move, the edge tabs stay.
    expect(moved?.x).toBeCloseTo(200, 6);
    expect(moved?.y).toBeCloseTo(145, 2);
    expectSamePoints(kept, EDGE_TABS, 1e-6);
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe(
      '2 placed tabs sat on the changed outline and moved to the nearest point of it. Undo restores them.',
    );
    useStore.getState().undo();
    expect(shape(useStore.getState().project).laserTabAnchors).toEqual(before.laserTabAnchors);
  });
});

function p(x: number, y: number): Vec2 {
  return { x, y };
}

// A rectangle at (100, 100) with laser and CNC tabs placed by hand at `tabs`.
function part(
  widthMm: number,
  heightMm: number,
  cornerRadiusMm: number,
  tabs: ReadonlyArray<Vec2>,
): ShapeObject {
  const rectangle = createRectangle({
    id: 'rr',
    color: COLOR,
    spec: { widthMm, heightMm, cornerRadiusMm },
    transform: { ...IDENTITY_TRANSFORM, x: 100, y: 100 },
  });
  const anchors = tabs.map((point) => {
    const anchor = projectCncTabAnchor(rectangle, COLOR, point);
    if (anchor === null) throw new Error('the tab is not on the outline');
    return anchor;
  });
  return { ...rectangle, operationIds: ['cut'], laserTabAnchors: anchors, cncTabAnchors: anchors };
}

function projectWith(object: SceneObject): Project {
  const layer = {
    ...createLayer({ id: 'cut', name: 'cut', color: COLOR }),
    mode: 'line' as const,
    power: 50,
    tabsEnabled: true,
    tabSizeMm: 2,
    tabsPerShape: 4,
    tabCutPowerPercent: 20,
  };
  return { ...createProject(), scene: { objects: [object], layers: [layer], groups: [] } };
}

function load(object: SceneObject): void {
  useStore.setState({
    project: projectWith(object),
    selectedObjectId: object.id,
    additionalSelectedIds: new Set(),
    dirty: false,
  });
}

function shape(project: Project): ShapeObject {
  const object = project.scene.objects[0];
  if (object?.kind !== 'shape') throw new Error('the part is gone');
  return object;
}

function tabPlaces(object: SceneObject): ReadonlyArray<Vec2> {
  return (object.laserTabAnchors ?? []).map((anchor) => {
    const place = laserTabAnchorPosition(object, anchor);
    if (place === null) throw new Error('a laser tab is not on its contour');
    return place;
  });
}

// The laser and CNC tabs placed by hand resolve at `points`, in order.
function expectTabsAt(object: SceneObject, points: ReadonlyArray<Vec2>): void {
  expectSamePoints(tabPlaces(object), points, 1e-6);
  const cnc = (object.cncTabAnchors ?? []).map((anchor) => cncTabAnchorPosition(object, anchor));
  expectSamePoints(
    cnc.filter((point): point is Vec2 => point !== null),
    points,
    1e-6,
  );
}

function expectSpansAt(project: Project, points: ReadonlyArray<Vec2>): void {
  expectSamePoints(
    burnedTabSpans(project),
    points.map((point) => toMachineCoords(point, project.device)),
    GCODE_MM,
  );
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
