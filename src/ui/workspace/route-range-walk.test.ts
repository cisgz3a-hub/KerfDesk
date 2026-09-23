import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { buildMotionManifest } from '../../core/job/motion-manifest';
import { fingerprintGcode } from '../../core/recovery';
import { mapControllerPointToScene, type CanvasMotionPlan } from '../state/canvas-motion-plan';
import { confirmedRouteBatch } from './motion-route-geometry';
import { InkPath2D } from './motion-route-ink.test-support';
import { scenePointMapper, visitRouteRange, walkRouteLines } from './route-range-walk';

// Arcs, a Z plunge/retract, rapids and a park: every drawable and non-drawable
// intent the walkers must agree on.
const GCODE = [
  'G21',
  'G90',
  'M3 S0',
  'G0 X3 Y4',
  'G1 Z-1 F300',
  'G1 X20 Y4 S500 F1200',
  'G2 X30 Y14 I0 J10',
  'G1 X30 Y30',
  'G1 Z2',
  'G0 X5 Y25',
  'G1 Z-1',
  'G3 X15 Y35 I10 J0',
  'G1 X5.5 Y25.25',
  'G0 X0 Y0',
].join('\n');

function plan(
  origin: CanvasMotionPlan['device']['origin'] = 'front-left',
  coordinateFrame: CanvasMotionPlan['coordinateFrame'] = {
    kind: 'machine',
    workOffsetMm: { x: 12.5, y: -7.25, z: 0 },
    nativeToBedOffsetMm: { x: 0.3, y: 1.7 },
  },
): CanvasMotionPlan {
  return {
    manifest: buildMotionManifest(GCODE, { machineKind: 'cnc' }),
    fingerprint: fingerprintGcode(GCODE),
    retentionKey: `walk-${origin}`,
    machineKind: 'cnc',
    device: { ...DEFAULT_DEVICE_PROFILE, origin, bedWidth: 417.3, bedHeight: 301.9 },
    coordinateFrame,
    framePerimeter: [],
    jobStart: null,
    approachFrom: null,
    capability: 'realtime',
    unavailableReason: null,
    resumed: false,
    positionEpoch: 0,
  };
}

type Line = readonly [number, number, number, number, string];

function referenceLines(canvasPlan: CanvasMotionPlan, from: number, to: number): Line[] {
  const lines: Line[] = [];
  visitRouteRange(canvasPlan, from, to, (segment) =>
    lines.push([segment.from.x, segment.from.y, segment.to.x, segment.to.y, segment.intent]),
  );
  return lines;
}

function expectSameLines(actual: ReadonlyArray<Line>, expected: ReadonlyArray<Line>): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((line, index) => {
    const reference = expected[index];
    expect(line[4]).toBe(reference?.[4]);
    for (let axis = 0; axis < 4; axis += 1) {
      expect(line[axis]).toBeCloseTo(reference?.[axis] as number, 9);
    }
  });
}

describe('scenePointMapper', () => {
  it.each(['front-left', 'front-right', 'rear-left', 'rear-right', 'center'] as const)(
    'maps exactly like mapControllerPointToScene for a %s origin in both frames',
    (origin) => {
      for (const frame of [
        undefined,
        { kind: 'relative' as const, jobOriginOffset: { x: -41.2, y: 13.9 } },
      ]) {
        const canvasPlan = plan(origin, frame);
        const map = scenePointMapper(canvasPlan);
        const out = { x: 0, y: 0 };
        for (const [x, y] of [
          [0, 0],
          [123.456, -78.9],
          [-0.001, 999.5],
          [417.3, 301.9],
        ] as const) {
          map(x, y, out);
          const expected = mapControllerPointToScene({ x, y, z: 0 }, canvasPlan);
          expect(out.x).toBeCloseTo(expected.x, 9);
          expect(out.y).toBeCloseTo(expected.y, 9);
        }
      }
    },
  );
});

describe('walkRouteLines', () => {
  const canvasPlan = plan();
  const total = canvasPlan.manifest.totalRouteMm;

  it('emits the same clipped scene segments as visitRouteRange for any window', () => {
    const windows: Array<readonly [number, number]> = [
      [0, total],
      [0, 0.5],
      [3.25, 41.7],
      [total * 0.37, total * 0.81],
      [total - 1e-3, total],
    ];
    for (const [from, to] of windows) {
      const lines: Line[] = [];
      const reached = walkRouteLines(canvasPlan, from, to, (x0, y0, x1, y1, intent) => {
        lines.push([x0, y0, x1, y1, intent]);
        return true;
      });
      expect(reached).toBe(to);
      expectSameLines(lines, referenceLines(canvasPlan, from, to));
    }
  });

  it('resumes exactly where a stopped walk left off: no segment lost or repeated', () => {
    const resumed: Line[] = [];
    let cursor = 0;
    for (let guard = 0; cursor < total && guard < 10_000; guard += 1) {
      let taken = 0;
      cursor = walkRouteLines(canvasPlan, cursor, total, (x0, y0, x1, y1, intent) => {
        resumed.push([x0, y0, x1, y1, intent]);
        taken += 1;
        return taken < 3;
      });
    }
    expect(cursor).toBe(total);
    expectSameLines(resumed, referenceLines(canvasPlan, 0, total));
  });

  it('builds bounded batches that together cover the range once', () => {
    let cursor = 0;
    let segments = 0;
    while (cursor < total) {
      const batch = confirmedRouteBatch(
        canvasPlan,
        InkPath2D as unknown as typeof Path2D,
        cursor,
        total,
        null,
        4,
      );
      expect(batch.endRouteMm).toBeGreaterThan(cursor);
      cursor = batch.endRouteMm;
      segments +=
        (batch.process as unknown as InkPath2D).segmentCount() +
        (batch.travel as unknown as InkPath2D).segmentCount();
    }
    expect(segments).toBe(referenceLines(canvasPlan, 0, total).length);
  });
});
