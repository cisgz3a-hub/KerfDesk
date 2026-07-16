import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { findPlungedTravelIssues } from '../invariants';
import type { CncGroup, CncPass, Job } from '../job';
import { emitCncJobWithPassSpans, type CncPassSpan } from '../output';
import { buildCncPassResumeJob } from './cnc-pass-resume-job';

const SAFE_Z_MM = 3.81;

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
    safeZMm: SAFE_Z_MM,
    passes,
  };
}

function contour(zMm: number, polyline: ReadonlyArray<{ x: number; y: number }>): CncPass {
  return { kind: 'contour', zMm, polyline, closed: false };
}

function line(y: number): ReadonlyArray<{ x: number; y: number }> {
  return [
    { x: 0, y },
    { x: 20, y },
    { x: 40, y },
  ];
}

// Points on a 0.25 mm grid stay distinct at emit precision; requiring one
// point that differs from the first guarantees every pass emits cut motion,
// so original and resume emissions both produce a span for every kept pass.
const point = fc
  .record({ x: fc.integer({ min: 0, max: 400 }), y: fc.integer({ min: 0, max: 400 }) })
  .map(({ x, y }) => ({ x: x / 4, y: y / 4 }));
const cuttingPolyline = fc
  .array(point, { minLength: 2, maxLength: 8 })
  .filter((points) =>
    points.some((p) => p.x !== (points[0]?.x ?? 0) || p.y !== (points[0]?.y ?? 0)),
  );
const contourPass: fc.Arbitrary<CncPass> = fc
  .record({ polyline: cuttingPolyline, zMm: fc.integer({ min: -100, max: -1 }).map((z) => z / 10) })
  .map(({ polyline, zMm }) => ({ kind: 'contour', zMm, polyline, closed: false }));

const singleGroupJob: fc.Arbitrary<Job> = fc
  .array(contourPass, { minLength: 2, maxLength: 6 })
  .map((passes) => ({ groups: [testGroup(passes)] }));

function spanText(gcode: string, span: CncPassSpan): string {
  return gcode
    .split('\n')
    .slice(span.firstRawLine - 1, span.lastRawLine)
    .join('\n');
}

describe('buildCncPassResumeJob', () => {
  const source: Job = {
    groups: [
      testGroup([contour(-1, line(0)), contour(-2, line(0))], 'tool-a'),
      testGroup([contour(-1, line(10)), contour(-2, line(10)), contour(-3, line(10))], 'tool-b'),
    ],
  };

  it('keeps the boundary pass, later passes, and later groups in order', () => {
    const result = buildCncPassResumeJob(source, 0, 1);
    expect(result.kind).toBe('resume-job');
    if (result.kind !== 'resume-job') return;
    expect(result.job.groups).toHaveLength(2);
    expect(result.job.groups[0]).toEqual({
      ...source.groups[0],
      passes: [contour(-2, line(0))],
    });
    expect(result.job.groups[1]).toBe(source.groups[1]);
    expect(result.omittedPassCount).toBe(1);
    expect(result.totalPassCount).toBe(5);
  });

  it('resumes at a later group and counts every omitted pass', () => {
    const result = buildCncPassResumeJob(source, 1, 2);
    expect(result.kind).toBe('resume-job');
    if (result.kind !== 'resume-job') return;
    expect(result.job.groups).toHaveLength(1);
    expect(result.job.groups[0]?.kind === 'cnc' && result.job.groups[0].passes).toEqual([
      contour(-3, line(10)),
    ]);
    expect(result.omittedPassCount).toBe(4);
  });

  it('refuses out-of-range and non-integer indices', () => {
    expect(buildCncPassResumeJob(source, 2, 0)).toEqual({
      kind: 'error',
      reason: 'invalid-resume-index',
    });
    expect(buildCncPassResumeJob(source, 0, 2)).toEqual({
      kind: 'error',
      reason: 'invalid-resume-index',
    });
    expect(buildCncPassResumeJob(source, 0, -1)).toEqual({
      kind: 'error',
      reason: 'invalid-resume-index',
    });
    expect(buildCncPassResumeJob(source, 0.5, 0)).toEqual({
      kind: 'error',
      reason: 'invalid-resume-index',
    });
  });

  it('refuses jobs containing non-CNC groups', () => {
    const mixed: Job = {
      groups: [
        {
          kind: 'cut',
          layerId: 'L2',
          color: '#000000',
          power: 80,
          speed: 1000,
          passes: 1,
          airAssist: false,
          segments: [],
        },
        ...source.groups,
      ],
    };
    expect(buildCncPassResumeJob(mixed, 1, 0)).toEqual({
      kind: 'error',
      reason: 'non-cnc-group',
    });
  });

  it('emits resume jobs that never travel plunged (75 seeds)', () => {
    fc.assert(
      fc.property(
        singleGroupJob.chain((job) => {
          const passCount = job.groups[0]?.kind === 'cnc' ? job.groups[0].passes.length : 0;
          return fc.record({
            job: fc.constant(job),
            k: fc.integer({ min: 0, max: passCount - 1 }),
          });
        }),
        ({ job, k }) => {
          const result = buildCncPassResumeJob(job, 0, k);
          expect(result.kind).toBe('resume-job');
          if (result.kind !== 'resume-job') return;
          const gcode = emitCncJobWithPassSpans(result.job, DEFAULT_DEVICE_PROFILE).gcode;
          expect(findPlungedTravelIssues(gcode, { safeZMm: SAFE_Z_MM })).toEqual([]);
        },
      ),
      { numRuns: 75 },
    );
  });

  it('re-emits every kept pass after the boundary byte-identically (75 seeds)', () => {
    fc.assert(
      fc.property(
        singleGroupJob.chain((job) => {
          const passCount = job.groups[0]?.kind === 'cnc' ? job.groups[0].passes.length : 0;
          return fc.record({
            job: fc.constant(job),
            k: fc.integer({ min: 0, max: passCount - 1 }),
          });
        }),
        ({ job, k }) => {
          const original = emitCncJobWithPassSpans(job, DEFAULT_DEVICE_PROFILE);
          const result = buildCncPassResumeJob(job, 0, k);
          if (result.kind !== 'resume-job') throw new Error(result.reason);
          const resume = emitCncJobWithPassSpans(result.job, DEFAULT_DEVICE_PROFILE);
          // The boundary pass itself may reposition differently (the resume
          // head starts parked); every pass after it must emit identically.
          for (const span of resume.spans) {
            if (span.passIndex === 0) continue;
            const originalSpan = original.spans.find(
              (candidate) =>
                candidate.groupIndex === 0 && candidate.passIndex === span.passIndex + k,
            );
            expect(originalSpan).toBeDefined();
            if (originalSpan === undefined) continue;
            expect(spanText(resume.gcode, span)).toBe(spanText(original.gcode, originalSpan));
          }
        },
      ),
      { numRuns: 75 },
    );
  });

  it('starts the resume program with the full spindle-safe preamble', () => {
    const result = buildCncPassResumeJob(source, 1, 1);
    if (result.kind !== 'resume-job') throw new Error(result.reason);
    const { gcode } = emitCncJobWithPassSpans(result.job, DEFAULT_DEVICE_PROFILE);
    expect(gcode.split('\n').slice(0, 7)).toEqual([
      'G21',
      'G90',
      'G54',
      'G94',
      `G0 Z${SAFE_Z_MM.toFixed(3)}`,
      'M3 S12000',
      'G4 P3.000',
    ]);
  });
});
