import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import type { CncGroup, CncPass, Job } from '../../core/job';
import { buildMotionManifest } from '../../core/job/motion-manifest';
import { emitCncJobWithPassSpans } from '../../core/output';
import { cncPassPosition, cncPassRouteSpans } from './canvas-pass-progress';

const SQUARE = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
  { x: 0, y: 0 },
];

function testGroup(passes: ReadonlyArray<CncPass>, toolId?: string): CncGroup {
  return {
    kind: 'cnc',
    layerId: 'L1',
    color: '#ff0000',
    cutType: 'engrave',
    ...(toolId === undefined ? {} : { toolId }),
    toolDiameterMm: 3.175,
    feedMmPerMin: 1000,
    plungeMmPerMin: 300,
    spindleRpm: 12000,
    spindleSpinupSec: 3,
    safeZMm: 3.81,
    passes,
  };
}

function threePassJob(): Job {
  return {
    groups: [
      testGroup([
        { kind: 'contour', zMm: -1, polyline: SQUARE, closed: true },
        { kind: 'contour', zMm: -2, polyline: SQUARE, closed: true },
        { kind: 'contour', zMm: -3, polyline: SQUARE, closed: true },
      ]),
    ],
  };
}

function mappedSpans(job: Job) {
  const emission = emitCncJobWithPassSpans(job, DEFAULT_DEVICE_PROFILE);
  const manifest = buildMotionManifest(emission.gcode, { machineKind: 'cnc' });
  const spans = cncPassRouteSpans(job, DEFAULT_DEVICE_PROFILE, emission.gcode, manifest);
  return { emission, manifest, spans };
}

describe('cncPassRouteSpans', () => {
  it('maps every emitted pass onto an ascending route range', () => {
    const { manifest, spans } = mappedSpans(threePassJob());
    expect(spans).toBeDefined();
    expect(spans?.length).toBe(3);
    let previousEnd = 0;
    for (const span of spans ?? []) {
      expect(span.routeStartMm).toBeGreaterThanOrEqual(previousEnd);
      expect(span.routeEndMm).toBeGreaterThan(span.routeStartMm);
      previousEnd = span.routeEndMm;
    }
    expect(previousEnd).toBeLessThanOrEqual(manifest.totalRouteMm);
    expect(spans?.map(({ groupIndex, passIndex }) => [groupIndex, passIndex])).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
    ]);
  });

  it("maps a current-position program only when given the run's own emit options", () => {
    const job = threePassJob();
    const finishPosition = { x: 25, y: 40 };
    const emission = emitCncJobWithPassSpans(job, DEFAULT_DEVICE_PROFILE, { finishPosition });
    const manifest = buildMotionManifest(emission.gcode, { machineKind: 'cnc' });
    // An option-less re-emission parks elsewhere, so the byte check refuses…
    expect(
      cncPassRouteSpans(job, DEFAULT_DEVICE_PROFILE, emission.gcode, manifest),
    ).toBeUndefined();
    // …while the run's own options reproduce the program and map every pass.
    const spans = cncPassRouteSpans(job, DEFAULT_DEVICE_PROFILE, emission.gcode, manifest, {
      finishPosition,
    });
    expect(spans?.length).toBe(3);
  });

  it('refuses a program that is not the plain strategy emission of the job', () => {
    const job = threePassJob();
    const emission = emitCncJobWithPassSpans(job, DEFAULT_DEVICE_PROFILE);
    const tampered = `; provenance header\n${emission.gcode}`;
    const manifest = buildMotionManifest(tampered, { machineKind: 'cnc' });
    expect(cncPassRouteSpans(job, DEFAULT_DEVICE_PROFILE, tampered, manifest)).toBeUndefined();
  });

  it('refuses a job whose emission produced no pass spans', () => {
    const job: Job = { groups: [] };
    const manifest = buildMotionManifest('', { machineKind: 'cnc' });
    expect(cncPassRouteSpans(job, DEFAULT_DEVICE_PROFILE, '', manifest)).toBeUndefined();
  });

  it('keeps mapped ranges ascending and bounded for arbitrary jobs (50 seeds)', () => {
    const point = fc
      .record({ x: fc.integer({ min: 0, max: 400 }), y: fc.integer({ min: 0, max: 400 }) })
      .map(({ x, y }) => ({ x: x / 4, y: y / 4 }));
    const depth = fc.integer({ min: -100, max: -1 }).map((z) => z / 10);
    const contourPass: fc.Arbitrary<CncPass> = fc
      .record({ polyline: fc.array(point, { minLength: 2, maxLength: 6 }), zMm: depth })
      .map(({ polyline, zMm }) => ({ kind: 'contour', zMm, polyline, closed: false }));
    const jobArb: fc.Arbitrary<Job> = fc
      .array(fc.array(contourPass, { minLength: 1, maxLength: 4 }), {
        minLength: 1,
        maxLength: 3,
      })
      .map((groups) => ({ groups: groups.map((passes) => testGroup(passes)) }));
    fc.assert(
      fc.property(jobArb, (job) => {
        const { emission, manifest, spans } = mappedSpans(job);
        expect(spans).toBeDefined();
        expect(spans?.length).toBe(emission.spans.length);
        let previousEnd = 0;
        for (const span of spans ?? []) {
          expect(span.routeStartMm).toBeGreaterThanOrEqual(previousEnd);
          expect(span.routeEndMm).toBeGreaterThanOrEqual(span.routeStartMm);
          previousEnd = span.routeEndMm;
        }
        expect(previousEnd).toBeLessThanOrEqual(manifest.totalRouteMm + 1e-6);
      }),
      { numRuns: 50 },
    );
  });
});

describe('cncPassPosition', () => {
  it('walks current/remaining across pass boundaries', () => {
    const { spans } = mappedSpans(threePassJob());
    if (spans === undefined) throw new Error('Expected mapped pass spans.');
    const [first, second, third] = spans;
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error('Expected three mapped pass spans.');
    }
    expect(cncPassPosition(spans, 0)).toEqual({ current: 1, total: 3, remaining: 2 });
    const midSecond = (second.routeStartMm + second.routeEndMm) / 2;
    expect(cncPassPosition(spans, midSecond)).toEqual({ current: 2, total: 3, remaining: 1 });
    // Completing a pass's last block hands the counter to the next pass.
    expect(cncPassPosition(spans, first.routeEndMm)?.current).toBe(2);
    expect(cncPassPosition(spans, third.routeEndMm)).toEqual({
      current: 3,
      total: 3,
      remaining: 0,
    });
    expect(cncPassPosition(spans, Number.MAX_SAFE_INTEGER)).toEqual({
      current: 3,
      total: 3,
      remaining: 0,
    });
  });

  it('returns null for an empty span list', () => {
    expect(cncPassPosition([], 0)).toBeNull();
  });
});
