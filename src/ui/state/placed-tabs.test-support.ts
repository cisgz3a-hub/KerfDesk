// Shared by the tests that carry tabs placed by hand through an edit: where they
// resolve, what the G-code burns, and where the CNC cut rises.
import { expect } from 'vitest';
import { burnedTabSpans } from '../../__fixtures__/burned-tab-spans';
import { cncTabAnchorPosition, projectCncTabAnchor } from '../../core/cnc/cnc-tab-anchors';
import { compileCncJob } from '../../core/cnc/compile-cnc-job';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords } from '../../core/devices';
import { laserTabAnchorPosition } from '../../core/job/laser-tab-anchors';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  createLayer,
  createProject,
  type CncTabAnchor,
  type Project,
  type SceneObject,
  type Vec2,
} from '../../core/scene';

// eslint-disable-next-line no-restricted-syntax -- scene data: the artwork's operation colour
export const TAB_COLOR = '#000000';
const GCODE_MM = 0.003;

export function p(x: number, y: number): Vec2 {
  return { x, y };
}

/** `object` with laser and CNC tabs placed by hand at the scene points `tabs`. */
export function withPlacedTabs<T extends SceneObject>(object: T, tabs: ReadonlyArray<Vec2>): T {
  const anchors = tabs.map((point): CncTabAnchor => {
    const anchor = projectCncTabAnchor(object, TAB_COLOR, point);
    if (anchor === null) throw new Error('the tab is not on the outline');
    return anchor;
  });
  return { ...object, laserTabAnchors: anchors, cncTabAnchors: anchors };
}

export function tabbedProject(objects: ReadonlyArray<SceneObject>): Project {
  const layer = {
    ...createLayer({ id: 'cut', name: 'cut', color: TAB_COLOR }),
    mode: 'line' as const,
    power: 50,
    tabsEnabled: true,
    tabSizeMm: 2,
    tabsPerShape: 4,
    tabCutPowerPercent: 20,
  };
  return { ...createProject(), scene: { objects: [...objects], layers: [layer], groups: [] } };
}

export function tabPlaces(object: SceneObject): ReadonlyArray<Vec2> {
  return (object.laserTabAnchors ?? []).map((anchor) => {
    const place = laserTabAnchorPosition(object, anchor);
    if (place === null) throw new Error('a laser tab is not on its contour');
    return place;
  });
}

function cncPlaces(object: SceneObject): ReadonlyArray<Vec2> {
  return (object.cncTabAnchors ?? []).map((anchor) => {
    const place = cncTabAnchorPosition(object, anchor);
    if (place === null) throw new Error('a CNC tab is not on its contour');
    return place;
  });
}

/** The laser and CNC tabs resolve at `points`, in the order they were placed. */
export function expectTabsAt(object: SceneObject, points: ReadonlyArray<Vec2>, mm = 1e-6): void {
  expectPointsInOrder(tabPlaces(object), points, mm);
  expectPointsInOrder(cncPlaces(object), points, mm);
}

/** The emitted GRBL G-code burns its tab spans at the scene points `points`. */
export function expectSpansAt(project: Project, points: ReadonlyArray<Vec2>, mm = GCODE_MM): void {
  expectSamePoints(
    burnedTabSpans(project),
    points.map((point) => toMachineCoords(point, project.device)),
    mm,
  );
}

function expectPointsInOrder(
  actual: ReadonlyArray<Vec2>,
  expected: ReadonlyArray<Vec2>,
  mm: number,
): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((point, index) => {
    const target = expected[index] as Vec2;
    expect(Math.hypot(point.x - target.x, point.y - target.y)).toBeLessThan(mm);
  });
}

export function expectSamePoints(
  actual: ReadonlyArray<Vec2>,
  expected: ReadonlyArray<Vec2>,
  mm: number,
): void {
  const sorted = (points: ReadonlyArray<Vec2>) =>
    [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  expectPointsInOrder(sorted(actual), sorted(expected), mm);
}

/** Where the deepest pass of a profile rises over a tab. */
export function cncTabRises(
  object: SceneObject,
  cutType: 'profile-outside' | 'profile-on-path' = 'profile-outside',
): ReadonlyArray<Vec2> {
  const layer = {
    ...createLayer({ id: 'cut', color: TAB_COLOR }),
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType,
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
