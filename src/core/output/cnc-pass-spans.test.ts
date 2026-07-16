import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { CncGroup, CncPass, Job } from '../job';
import { cncGrblStrategy, emitCncJobWithPassSpans } from './cnc-grbl-strategy';
import type { CncPassSpan } from './cnc-pass-spans';

// Points on a 0.25 mm grid stay distinct at the emitter's 3-decimal precision.
const point = fc
  .record({ x: fc.integer({ min: 0, max: 400 }), y: fc.integer({ min: 0, max: 400 }) })
  .map(({ x, y }) => ({ x: x / 4, y: y / 4 }));
const depth = fc.integer({ min: -100, max: -1 }).map((z) => z / 10);

const contourPass: fc.Arbitrary<CncPass> = fc
  .record({ polyline: fc.array(point, { minLength: 2, maxLength: 8 }), zMm: depth })
  .map(({ polyline, zMm }) => ({ kind: 'contour', zMm, polyline, closed: false }));

const path3dPass: fc.Arbitrary<CncPass> = fc
  .array(fc.record({ x: fc.integer({ min: 0, max: 400 }), z: depth }), {
    minLength: 2,
    maxLength: 8,
  })
  .map((points) => ({
    kind: 'path3d',
    points: points.map(({ x, z }, index) => ({ x: x / 4, y: index * 2, z })),
    closed: false,
  }));

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

const groupArb: fc.Arbitrary<CncGroup> = fc
  .array(fc.oneof(contourPass, path3dPass), { minLength: 1, maxLength: 5 })
  .map((passes) => testGroup(passes));

const jobArb: fc.Arbitrary<Job> = fc
  .array(groupArb, { minLength: 1, maxLength: 3 })
  .map((groups) => ({ groups }));

function rawLine(gcode: string, oneBased: number): string {
  return gcode.split('\n')[oneBased - 1] ?? '';
}

function spanIsInside(span: CncPassSpan, gcode: string): boolean {
  // The program ends with a trailing '\n', so the last real line is length-1.
  return span.firstRawLine >= 1 && span.lastRawLine < gcode.split('\n').length;
}

describe('emitCncJobWithPassSpans', () => {
  it('emits byte-identical G-code to the ordinary strategy (100 seeds)', () => {
    fc.assert(
      fc.property(jobArb, (job) => {
        const { gcode } = emitCncJobWithPassSpans(job, DEFAULT_DEVICE_PROFILE);
        expect(gcode).toBe(cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE));
      }),
      { numRuns: 100 },
    );
  });

  it('records one ascending, non-overlapping, in-range span per pass (100 seeds)', () => {
    fc.assert(
      fc.property(jobArb, (job) => {
        const { gcode, spans } = emitCncJobWithPassSpans(job, DEFAULT_DEVICE_PROFILE);
        const totalPasses = job.groups.reduce(
          (count, group) => count + (group.kind === 'cnc' ? group.passes.length : 0),
          0,
        );
        expect(spans.length).toBe(totalPasses);
        let previousLast = 0;
        for (const span of spans) {
          expect(span.firstRawLine).toBeGreaterThan(previousLast);
          expect(span.lastRawLine).toBeGreaterThanOrEqual(span.firstRawLine);
          expect(spanIsInside(span, gcode)).toBe(true);
          previousLast = span.lastRawLine;
        }
      }),
      { numRuns: 100 },
    );
  });

  it('keeps every cutting move inside a pass span (100 seeds)', () => {
    fc.assert(
      fc.property(jobArb, (job) => {
        const { gcode, spans } = emitCncJobWithPassSpans(job, DEFAULT_DEVICE_PROFILE);
        const lines = gcode.split('\n');
        for (let raw = 1; raw <= lines.length; raw += 1) {
          if (!(lines[raw - 1] ?? '').startsWith('G1 X')) continue;
          const covered = spans.some((span) => raw >= span.firstRawLine && raw <= span.lastRawLine);
          expect(covered).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('maps spans to job group indices and pass indices', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
    ];
    const job: Job = {
      groups: [
        testGroup(
          [
            { kind: 'contour', zMm: -1, polyline: square, closed: true },
            { kind: 'contour', zMm: -2, polyline: square, closed: true },
          ],
          'tool-a',
        ),
        testGroup([{ kind: 'contour', zMm: -1.5, polyline: square, closed: true }], 'tool-b'),
      ],
    };
    const { gcode, spans } = emitCncJobWithPassSpans(job, DEFAULT_DEVICE_PROFILE);
    expect(spans.map(({ groupIndex, passIndex }) => [groupIndex, passIndex])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
    ]);
    // First pass repositions from the preamble park; the successive-depth pass
    // starts with its direct plunge — both belong to their own span.
    expect(rawLine(gcode, spans[0]?.firstRawLine ?? 0)).toBe('G0 X0.000 Y0.000');
    expect(rawLine(gcode, spans[1]?.firstRawLine ?? 0)).toBe('G1 Z-2.000 F300');
    // The multi-tool M0 change block sits between groups, outside every span.
    const m0Raw = gcode.split('\n').findIndex((line) => line === 'M0') + 1;
    expect(m0Raw).toBeGreaterThan(spans[1]?.lastRawLine ?? Number.NaN);
    expect(m0Raw).toBeLessThan(spans[2]?.firstRawLine ?? Number.NaN);
  });

  it('covers arc and helical passes with their own spans', () => {
    const job: Job = {
      groups: [
        testGroup([
          {
            kind: 'arc',
            start: { x: 10, y: 0 },
            end: { x: 0, y: 10 },
            center: { x: 0, y: 0 },
            clockwise: false,
            zMm: -1,
            closed: false,
          },
          {
            kind: 'helical-contour',
            start: { x: 13, y: 10 },
            center: { x: 10, y: 10 },
            clockwise: true,
            startZMm: 0,
            zMm: -2,
            revolutions: 2,
            polyline: [
              { x: 13, y: 10 },
              { x: 10, y: 13 },
              { x: 7, y: 10 },
              { x: 10, y: 7 },
              { x: 13, y: 10 },
            ],
            closed: true,
          },
        ]),
      ],
    };
    const { gcode, spans } = emitCncJobWithPassSpans(job, DEFAULT_DEVICE_PROFILE);
    expect(gcode).toBe(cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE));
    expect(spans.map(({ groupIndex, passIndex }) => [groupIndex, passIndex])).toEqual([
      [0, 0],
      [0, 1],
    ]);
    const lines = gcode.split('\n');
    const arcSpan = spans[0];
    const helixSpan = spans[1];
    if (arcSpan === undefined || helixSpan === undefined) throw new Error('missing spans');
    // The native G2/G3 arc motion lives inside its pass span.
    const arcLines = lines.slice(arcSpan.firstRawLine - 1, arcSpan.lastRawLine);
    expect(arcLines.some((line) => line.startsWith('G3 '))).toBe(true);
    const helixLines = lines.slice(helixSpan.firstRawLine - 1, helixSpan.lastRawLine);
    expect(helixLines.some((line) => line.startsWith('G2 ') || line.startsWith('G3 '))).toBe(true);
  });

  it('skips degenerate passes without disturbing later spans', () => {
    const job: Job = {
      groups: [
        testGroup([
          { kind: 'contour', zMm: -1, polyline: [{ x: 5, y: 5 }], closed: false },
          {
            kind: 'contour',
            zMm: -1,
            polyline: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
            ],
            closed: false,
          },
        ]),
      ],
    };
    const { spans } = emitCncJobWithPassSpans(job, DEFAULT_DEVICE_PROFILE);
    expect(spans.map(({ groupIndex, passIndex }) => [groupIndex, passIndex])).toEqual([[0, 1]]);
  });
});
