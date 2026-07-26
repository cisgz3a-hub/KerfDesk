import { describe, expect, it } from 'vitest';
import { buildGcodeTimingPlan } from '../../core/gcode-time';
import { buildMotionManifest } from '../../core/job/motion-manifest';
import { timingRouteAtManifestRoute } from './live-canvas-run-timing';

const INITIAL_POSITION = { x: 5, y: 6, z: 2 };
const MOTION_LIMITS = {
  accelMmPerSec2: 500,
  junctionDeviationMm: 0.01,
  maxFeedMmPerMin: 6_000,
};

const ARC_PROGRAMS: ReadonlyArray<{ readonly name: string; readonly gcode: string }> = [
  {
    name: 'semicircular arc',
    gcode: 'G21\nG90\nG0 X10 Y0\nG2 X-10 Y0 I-10 J0 F600',
  },
  {
    name: 'helical full circle',
    gcode: 'G21\nG90\nG0 X10 Y0 Z0\nG3 X10 Y0 Z-2 I-10 J0 F600',
  },
];

describe('live countdown route-basis mapping', () => {
  it.each(ARC_PROGRAMS)(
    'maps $name progress by raw line despite different arc tessellation',
    ({ gcode }) => {
      const manifest = buildMotionManifest(gcode, {
        machineKind: 'cnc',
        initialPosition: INITIAL_POSITION,
      });
      const result = buildGcodeTimingPlan(gcode, MOTION_LIMITS, INITIAL_POSITION);
      if (result.kind !== 'ok') throw new Error(`Expected timing plan: ${result.reason}`);
      const plan = result.plan;
      const finalBlock = manifest.blocks.at(-1);
      if (finalBlock === undefined) throw new Error('Expected final motion block.');

      expect(manifest.totalRouteMm).not.toBeCloseTo(plan.totalRouteMm, 4);
      expect(timingRouteAtManifestRoute(plan, manifest, manifest.totalRouteMm)).toBeCloseTo(
        plan.totalRouteMm,
        10,
      );

      const midpoint = (finalBlock.routeStartMm + finalBlock.routeEndMm) / 2;
      const timingSegmentIndexes = Array.from(plan.segmentRawLine).flatMap((rawLine, index) =>
        rawLine === finalBlock.rawLineIndex ? [index] : [],
      );
      const first = timingSegmentIndexes[0];
      const last = timingSegmentIndexes.at(-1);
      if (first === undefined || last === undefined) {
        throw new Error('Expected timing segments for the final motion line.');
      }
      const expectedMidpoint = ((plan.routeStartMm[first] ?? 0) + (plan.routeEndMm[last] ?? 0)) / 2;
      expect(timingRouteAtManifestRoute(plan, manifest, midpoint)).toBeCloseTo(
        expectedMidpoint,
        10,
      );
    },
  );
});
