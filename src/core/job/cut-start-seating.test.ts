import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords } from '../devices';
import {
  applyTransform,
  createLayer,
  DEFAULT_PROJECT_OPTIMIZATION,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Layer,
  type Scene,
  type SceneObject,
  type Vec2,
} from '../scene';
import { cutStartPointAt } from '../scene/cut-start-points';
import type { CutStartPoint } from '../scene/scene-object';
import { compileJob } from './compile-job';
import type { CutSegment, Job } from './job';
import { optimizePaths } from './optimize-paths';

const RED = '#ff0000';
const device = DEFAULT_DEVICE_PROFILE;

// 20 × 10 rectangle drawn from the middle of its bottom edge.
const MID_EDGE_RECTANGLE: ReadonlyArray<Vec2> = [
  { x: 30, y: 20 },
  { x: 40, y: 20 },
  { x: 40, y: 30 },
  { x: 20, y: 30 },
  { x: 20, y: 20 },
];

function artwork(
  starts: ReadonlyArray<CutStartPoint> | undefined,
  transform: SceneObject['transform'] = IDENTITY_TRANSFORM,
): SceneObject {
  return {
    kind: 'imported-svg',
    id: 'art',
    source: 'art.svg',
    bounds: { minX: 20, minY: 20, maxX: 40, maxY: 30 },
    transform,
    paths: [{ color: RED, polylines: [{ points: MID_EDGE_RECTANGLE, closed: true }] }],
    ...(starts === undefined ? {} : { cutStartPoints: starts }),
  };
}

function scene(object: SceneObject, patch: Partial<Layer> = {}): Scene {
  return {
    ...EMPTY_SCENE,
    objects: [object],
    layers: [{ ...createLayer({ id: 'cut', color: RED }), ...patch }],
  };
}

function cutSegments(job: Job): ReadonlyArray<CutSegment> {
  const group = job.groups[0];
  if (group?.kind !== 'cut') throw new Error('expected a Line cut group');
  return group.segments;
}

function startAtCorner(corner: Vec2): CutStartPoint {
  const object = artwork(undefined);
  if (!('paths' in object)) throw new Error('fixture has paths');
  const path = object.paths[0];
  if (path === undefined) throw new Error('fixture path');
  const start = cutStartPointAt(path, 0, 0, corner);
  if (start === null) throw new Error('corner is on the contour');
  return start;
}

describe('Set Start Point at compile', () => {
  it('leaves the drawn start alone when no start point is stored', () => {
    const [segment] = cutSegments(compileJob(scene(artwork(undefined)), device));
    expect(segment?.polyline[0]).toEqual(toMachineCoords({ x: 30, y: 20 }, device));
    expect(segment?.startLocked).toBeUndefined();
  });

  it('starts the closed cut at the chosen node and locks it', () => {
    const corner = { x: 40, y: 30 };
    const [segment] = cutSegments(compileJob(scene(artwork([startAtCorner(corner)])), device));
    expect(segment?.polyline[0]).toEqual(toMachineCoords(corner, device));
    expect(segment?.polyline.at(-1)).toEqual(toMachineCoords(corner, device));
    expect(segment?.startLocked).toBe(true);
  });

  it('follows the artwork through move, rotation and mirror', () => {
    const corner = { x: 20, y: 30 };
    const transform = { ...IDENTITY_TRANSFORM, x: 5, y: 7, rotationDeg: 90, mirrorX: true };
    const object = artwork([startAtCorner(corner)], transform);
    const [segment] = cutSegments(compileJob(scene(object), device));
    expect(segment?.polyline[0]).toEqual(
      toMachineCoords(applyTransform(corner, transform), device),
    );
    expect(segment?.startLocked).toBe(true);
  });

  it('lands on the kerf-offset corner rather than beside it', () => {
    const corner = { x: 40, y: 20 };
    const [segment] = cutSegments(
      compileJob(scene(artwork([startAtCorner(corner)]), { kerfOffsetMm: 0.2 }), device),
    );
    const target = toMachineCoords(corner, device);
    const start = segment?.polyline[0];
    expect(segment?.startLocked).toBe(true);
    // The mitred outer corner sits 0.2 mm out along both axes.
    expect(Math.abs((start?.x ?? 0) - target.x)).toBeCloseTo(0.2, 6);
    expect(Math.abs((start?.y ?? 0) - target.y)).toBeCloseTo(0.2, 6);
  });

  it('does not seat shapes that tabs split into open bridges', () => {
    const segments = cutSegments(
      compileJob(
        scene(artwork([startAtCorner({ x: 40, y: 30 })]), {
          tabsEnabled: true,
          tabSizeMm: 1,
          tabsPerShape: 2,
        }),
        device,
      ),
    );
    expect(segments.length).toBeGreaterThan(1);
    for (const segment of segments) {
      expect(segment.closed).toBe(false);
      expect(segment.startLocked).toBeUndefined();
    }
  });

  it('ignores a start point whose contour no longer exists', () => {
    const stale: CutStartPoint = { pathIndex: 4, polylineIndex: 0, pathT: 0.5 };
    const [segment] = cutSegments(compileJob(scene(artwork([stale])), device));
    expect(segment?.polyline[0]).toEqual(toMachineCoords({ x: 30, y: 20 }, device));
    expect(segment?.startLocked).toBeUndefined();
  });

  it('wins over the automatic start and direction choices', () => {
    const corner = { x: 40, y: 30 };
    const job = compileJob(scene(artwork([startAtCorner(corner)])), device);
    const optimized = optimizePaths(job, {
      ...DEFAULT_PROJECT_OPTIMIZATION,
      bestStartPoint: true,
      preferCorners: true,
      bestDirection: true,
    });
    expect(cutSegments(optimized)[0]).toBe(cutSegments(job)[0]);
  });
});
