// LBG-C04: where optimizePaths starts closed shapes. Fixtures are machine
// coordinates in mm; the default planning start is the machine origin.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROJECT_OPTIMIZATION,
  type ProjectOptimizationSettings,
  type Vec2,
} from '../scene';
import { finalPassCutSegments } from './cut-pass-segments';
import type { CncGroup, CutGroup, CutSegment, FillGroup, Job } from './job';
import { optimizePaths } from './optimize-paths';

function closed(...points: Array<readonly [number, number]>): CutSegment {
  const polyline = points.map(([x, y]) => ({ x, y }));
  return { closed: true, polyline: [...polyline, polyline[0] as Vec2] };
}

function open(...points: Array<readonly [number, number]>): CutSegment {
  return { closed: false, polyline: points.map(([x, y]) => ({ x, y })) };
}

function square(minX: number, minY: number, size: number): CutSegment {
  // Drawn from the top-right corner, counter-clockwise.
  return closed([minX + size, minY + size], [minX, minY + size], [minX, minY], [minX + size, minY]);
}

function arcPoints(
  cx: number,
  cy: number,
  r: number,
  fromDeg: number,
  toDeg: number,
  steps: number,
) {
  return Array.from({ length: steps + 1 }, (_, i): readonly [number, number] => {
    const angle = ((fromDeg + ((toDeg - fromDeg) * i) / steps) * Math.PI) / 180;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  });
}

function group(segments: ReadonlyArray<CutSegment>, extra: Partial<CutGroup> = {}): CutGroup {
  return {
    kind: 'cut',
    layerId: 'L1',
    color: '#000',
    power: 50,
    speed: 1000,
    passes: 1,
    airAssist: false,
    segments,
    ...extra,
  };
}

function plan(
  segments: ReadonlyArray<CutSegment>,
  settings: Partial<ProjectOptimizationSettings>,
  extra: Partial<CutGroup> = {},
): ReadonlyArray<CutSegment> {
  const result = optimizePaths(
    { groups: [group(segments, extra)] },
    {
      ...DEFAULT_PROJECT_OPTIMIZATION,
      ...settings,
    },
  );
  return (result.groups[0] as CutGroup).segments;
}

const start = (segment: CutSegment | undefined): Vec2 | undefined => segment?.polyline[0];
const end = (segment: CutSegment | undefined): Vec2 | undefined =>
  segment?.polyline[(segment?.polyline.length ?? 0) - 1];

describe('optimizePaths closed-shape start (LBG-C04)', () => {
  it("leaves every segment as drawn under 'drawn' and when the setting is absent", () => {
    const segments = [square(100, 100, 10), open([5, 5], [50, 0]), square(40, 40, 5)];
    const { closedShapeStart: _absent, ...legacy } = DEFAULT_PROJECT_OPTIMIZATION;
    for (const travelPolicy of ['nearest-neighbor', 'source-order'] as const) {
      const job: Job = { groups: [group(segments)] };
      const drawn = optimizePaths(job, { ...DEFAULT_PROJECT_OPTIMIZATION, travelPolicy });
      const absent = optimizePaths(job, { ...legacy, travelPolicy });
      expect(drawn).toEqual(absent);
      const closedOut = (drawn.groups[0] as CutGroup).segments.filter((s) => s.closed);
      for (const segment of closedOut) expect(segments).toContain(segment);
    }
  });

  it('nearest enters a closed shape at the vertex nearest the head', () => {
    const [only] = plan([square(100, 100, 10)], { closedShapeStart: 'nearest' });
    expect(start(only)).toEqual({ x: 100, y: 100 });
    expect(end(only)).toEqual({ x: 100, y: 100 });
    expect(only?.polyline).toHaveLength(5);
  });

  it('nearest-corner skips a nearer mid-edge vertex for the nearest corner', () => {
    // Drawn from the middle of the bottom edge, the vertex nearest the origin.
    const rectangle = closed([0, 10], [10, 10], [10, 20], [-10, 20], [-10, 10]);
    expect(start(plan([rectangle], { closedShapeStart: 'nearest' })[0])).toEqual({ x: 0, y: 10 });
    // Both bottom corners are sqrt(200) away: the lower vertex index wins.
    const [cornered] = plan([rectangle], { closedShapeStart: 'nearest-corner' });
    expect(start(cornered)).toEqual({ x: 10, y: 10 });
    expect(cornered?.polyline).toEqual([
      { x: 10, y: 10 },
      { x: 10, y: 20 },
      { x: -10, y: 20 },
      { x: -10, y: 10 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
    ]);
  });

  it('nearest-corner picks the corner of a rounded shape over a nearer point on its arc', () => {
    // A D whose half circle bulges toward the origin under a flat top, drawn
    // from the bottom of the arc: its corners are vertices 30 and 31.
    const d = closed(
      ...arcPoints(110, 120, 10, 270, 360, 30),
      ...arcPoints(110, 120, 10, 180, 270, 30).slice(0, -1),
    );
    const nearest = start(plan([d], { closedShapeStart: 'nearest' })[0]);
    const corner = start(plan([d], { closedShapeStart: 'nearest-corner' })[0]);
    expect(corner).toEqual(d.polyline[31]);
    expect(corner?.x).toBe(100);
    expect(nearest?.y).toBeLessThan(115);
    expect(nearest).not.toEqual(start(d));
  });

  it('starts a shape without corners at its nearest vertex', () => {
    const circle = closed(...arcPoints(100, 100, 10, 90, 450, 72).slice(0, -1));
    const rounded = closed(
      ...arcPoints(137, 103, 3, -90, 0, 8),
      ...arcPoints(137, 117, 3, 0, 90, 8),
      ...arcPoints(103, 117, 3, 90, 180, 8),
      ...arcPoints(103, 103, 3, 180, 270, 8),
    );
    for (const shape of [circle, rounded]) {
      const nearest = plan([shape], { closedShapeStart: 'nearest' });
      const corner = plan([shape], { closedShapeStart: 'nearest-corner' });
      expect(corner).toEqual(nearest);
      expect(start(corner[0])).not.toEqual(start(shape));
    }
  });

  it('breaks exact ties the same way every time, to the drawn start first', () => {
    // Every corner of a square is the same distance from its centre.
    const segments = [square(-5, -5, 10), square(-15, -15, 30)];
    const settings = { startPoint: 'job-center', insideFirst: false } as const;
    for (const closedShapeStart of ['nearest', 'nearest-corner'] as const) {
      const first = plan(segments, { ...settings, closedShapeStart });
      expect(plan(segments, { ...settings, closedShapeStart })).toEqual(first);
      expect(first[0]).toBe(segments[0]);
    }
  });

  it('still cuts inside shapes first', () => {
    const outer = square(0, 0, 100);
    const inner = square(40, 40, 20);
    const ordered = plan([outer, inner], { closedShapeStart: 'nearest', insideFirst: true });
    expect(ordered.map((segment) => segment.polyline.length)).toEqual([5, 5]);
    expect(start(ordered[0])).toEqual({ x: 40, y: 40 });
    // The outline starts at its vertex nearest where the inner one ended.
    expect(start(ordered[1])).toEqual({ x: 0, y: 0 });
    expect(ordered[1]?.polyline).toContainEqual({ x: 100, y: 100 });
  });

  it('plans open segments exactly as before', () => {
    const segments = [open([50, 0], [5, 5]), open([100, 0], [60, 0]), open([0, 90], [0, 30])];
    const drawn = plan(segments, {});
    for (const closedShapeStart of ['nearest', 'nearest-corner'] as const) {
      expect(plan(segments, { closedShapeStart })).toEqual(drawn);
    }
  });

  it('under Keep source order keeps the order and starts each shape nearest the last end', () => {
    const far = square(200, 0, 10);
    const line = open([150, 50], [20, 50]);
    const near = square(0, 40, 10);
    const ordered = plan([far, line, near], {
      travelPolicy: 'source-order',
      closedShapeStart: 'nearest',
    });
    // The first shape starts nearest the planning start (the origin).
    expect(start(ordered[0])).toEqual({ x: 200, y: 0 });
    expect(ordered[1]).toBe(line);
    // The next starts nearest where the line ended, at (20, 50).
    expect(start(ordered[2])).toEqual({ x: 10, y: 50 });
    const drawn = plan([far, line, near], { travelPolicy: 'source-order' });
    expect(drawn).toEqual([far, line, near]);
    expect(drawn[0]).toBe(far);
  });

  it('runs the final-pass overcut past the new start', () => {
    const rectangle = closed([0, 10], [10, 10], [10, 20], [-10, 20], [-10, 10]);
    const result = optimizePaths(
      { groups: [group([rectangle], { finalPassOvercutMm: 2 })] },
      { ...DEFAULT_PROJECT_OPTIMIZATION, closedShapeStart: 'nearest-corner' },
    );
    const [overcut] = finalPassCutSegments(result.groups[0] as CutGroup);
    expect(overcut?.polyline).toEqual([
      { x: 10, y: 10 },
      { x: 10, y: 20 },
      { x: -10, y: 20 },
      { x: -10, y: 10 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 12 },
    ]);
  });

  it('starts Offset Fill rings the same way and leaves CNC groups untouched', () => {
    const ring = { ...square(100, 100, 10), reverse: false };
    const fill: FillGroup = {
      ...group([]),
      kind: 'fill',
      fillStyle: 'offset',
      overscanMm: 0,
      segments: [ring],
    };
    const cnc: CncGroup = {
      kind: 'cnc',
      layerId: 'cnc',
      color: '#f00',
      cutType: 'profile-outside',
      toolDiameterMm: 3.175,
      feedMmPerMin: 1000,
      plungeMmPerMin: 300,
      spindleRpm: 12000,
      spindleSpinupSec: 0,
      safeZMm: 3.81,
      passes: [{ kind: 'contour', zMm: -1, closed: true, polyline: square(50, 50, 10).polyline }],
    };
    for (const travelPolicy of ['nearest-neighbor', 'source-order'] as const) {
      const result = optimizePaths(
        { groups: [fill, cnc] },
        { ...DEFAULT_PROJECT_OPTIMIZATION, travelPolicy, closedShapeStart: 'nearest-corner' },
      );
      expect(start((result.groups[0] as FillGroup).segments[0])).toEqual({ x: 100, y: 100 });
      expect(result.groups[1]).toBe(cnc);
    }
  });
});
