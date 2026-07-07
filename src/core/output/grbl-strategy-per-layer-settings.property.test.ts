// Per-layer settings correctness (audit 2026-07-07 gap).
//
// The pre-existing coverage could not catch two layers receiving each other's
// settings: the power-scale property pins a SINGLE-layer job at 50%, the
// mixed-mode production snapshot runs every layer at the same default
// 30%/1500, and the multi-group fuzz asserts only determinism / laser-off /
// bounds. This suite applies PROJECT.md non-negotiable #7 per layer: in a job
// whose groups carry independently different power/speed, every group's
// section must burn at ITS OWN S and F —
//   * every G1 S inside a section is 0 (blank/travel) or that group's
//     expectedS, and the group's expectedS actually appears;
//   * every G1 F inside a section is that group's rounded speed;
//   * sections appear in job order.
// Geometry arbitraries use integer coordinates with strictly positive extents
// so no segment degenerates at emit precision — every group provably emits at
// least one burn move.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  collectG1FValues,
  collectG1SValues,
  expectedS,
  splitGcodeLayerSections,
} from '../invariants';
import type { CutSegment, FillSegment, Job } from '../job';
import { grblStrategy } from './grbl-strategy';

const FUZZ_RUNS = 100;
const DEVICE = DEFAULT_DEVICE_PROFILE;
const MAX_SEGMENT_EXTENT_MM = 9;
const SEGMENT_START_MAX = Math.floor(DEVICE.bedWidth) - 3 * MAX_SEGMENT_EXTENT_MM;

const arbPower = fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true });
const arbSpeed = fc.integer({ min: 1, max: Math.round(DEVICE.maxFeed) });
const arbPasses = fc.integer({ min: 1, max: 3 });

// A cut polyline of 2-4 points with strictly increasing X: consecutive points
// are always distinct, so every point emits a real G1.
const arbCutSegment: fc.Arbitrary<CutSegment> = fc
  .record({
    x: fc.integer({ min: 0, max: SEGMENT_START_MAX }),
    y: fc.integer({ min: 0, max: Math.floor(DEVICE.bedHeight) - MAX_SEGMENT_EXTENT_MM }),
    steps: fc.array(
      fc.record({
        dx: fc.integer({ min: 1, max: MAX_SEGMENT_EXTENT_MM }),
        dy: fc.integer({ min: 0, max: MAX_SEGMENT_EXTENT_MM }),
      }),
      { minLength: 1, maxLength: 3 },
    ),
  })
  .map(({ x, y, steps }) => {
    const points = [{ x, y }];
    let cx = x;
    for (const step of steps) {
      cx += step.dx;
      points.push({ x: cx, y: y + step.dy });
    }
    return { polyline: points, closed: false };
  });

// A horizontal fill span with a strictly positive run, on one of a few shared
// Y values so spans collide into multi-span sweeps with interior S0 gaps.
const arbFillSpan: fc.Arbitrary<FillSegment> = fc
  .record({
    y: fc.constantFrom(10, 20, 30),
    x0: fc.integer({ min: 0, max: SEGMENT_START_MAX }),
    dx: fc.integer({ min: 1, max: MAX_SEGMENT_EXTENT_MM }),
  })
  .map(({ y, x0, dx }) => ({
    polyline: [
      { x: x0, y },
      { x: x0 + dx, y },
    ],
    closed: false,
    reverse: false,
  }));

const arbCutSeed = fc.record({
  kind: fc.constant('cut' as const),
  power: arbPower,
  speed: arbSpeed,
  passes: arbPasses,
  segments: fc.array(arbCutSegment, { minLength: 1, maxLength: 3 }),
});

const arbFillSeed = fc.record({
  kind: fc.constant('fill' as const),
  power: arbPower,
  speed: arbSpeed,
  passes: arbPasses,
  overscanMm: fc.constantFrom(0, 2, 5),
  segments: fc.array(arbFillSpan, { minLength: 1, maxLength: 4 }),
});

// 1-4 groups, each with its OWN independently drawn power/speed/passes. The
// branches below are textually identical: the kind-check exists only so TS
// narrows the seed union before the spread (spreading the union directly does
// not produce CutGroup | FillGroup).
const arbPerLayerJob: fc.Arbitrary<Job> = fc
  .array(fc.oneof(arbCutSeed, arbFillSeed), { minLength: 1, maxLength: 4 })
  .map((seeds) => ({
    groups: seeds.map((seed, i) =>
      seed.kind === 'cut'
        ? { ...seed, layerId: `L${i}`, color: '#000000', airAssist: false }
        : { ...seed, layerId: `L${i}`, color: '#000000', airAssist: false },
    ),
  }));

function emitSections(job: Job): ReadonlyArray<{ layerId: string; body: string }> {
  return splitGcodeLayerSections(grblStrategy.emit(job, DEVICE));
}

describe('grblStrategy per-layer settings (non-negotiable #7, per layer)', () => {
  it('emits group sections in job order across 100 fuzzed multi-layer jobs', () => {
    fc.assert(
      fc.property(arbPerLayerJob, (job) => {
        const ids = emitSections(job).map((section) => section.layerId);
        return (
          ids.length === job.groups.length && ids.every((id, i) => id === job.groups[i]?.layerId)
        );
      }),
      { numRuns: FUZZ_RUNS },
    );
  });

  it("every section's G1 S values are S0 or that group's own expected S, which appears", () => {
    fc.assert(
      fc.property(arbPerLayerJob, (job) => {
        const sections = emitSections(job);
        return job.groups.every((group, i) => {
          if (group.kind !== 'cut' && group.kind !== 'fill') return false;
          const body = sections[i]?.body;
          if (body === undefined) return false;
          const want = expectedS(group.power, DEVICE.maxPowerS);
          const sValues = collectG1SValues(body);
          return sValues.includes(want) && sValues.every((s) => s === 0 || s === want);
        });
      }),
      { numRuns: FUZZ_RUNS },
    );
  });

  it("every section's G1 F values equal that group's own speed, and each group feeds at least once", () => {
    fc.assert(
      fc.property(arbPerLayerJob, (job) => {
        const sections = emitSections(job);
        return job.groups.every((group, i) => {
          if (group.kind !== 'cut' && group.kind !== 'fill') return false;
          const body = sections[i]?.body;
          if (body === undefined) return false;
          const fValues = collectG1FValues(body);
          return fValues.length > 0 && fValues.every((f) => f === Math.round(group.speed));
        });
      }),
      { numRuns: FUZZ_RUNS },
    );
  });

  it('two cut layers with different settings each burn at their own S and F (swap detector)', () => {
    const job: Job = {
      groups: [
        {
          kind: 'cut',
          layerId: 'fast-low',
          color: '#00ff00',
          power: 25,
          speed: 3000,
          passes: 1,
          airAssist: false,
          segments: [
            {
              polyline: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
              ],
              closed: false,
            },
          ],
        },
        {
          kind: 'cut',
          layerId: 'slow-high',
          color: '#ff0000',
          power: 60,
          speed: 1200,
          passes: 1,
          airAssist: false,
          segments: [
            {
              polyline: [
                { x: 20, y: 0 },
                { x: 30, y: 0 },
              ],
              closed: false,
            },
          ],
        },
      ],
    };
    const out = grblStrategy.emit(job, DEVICE);
    // $30 = 1000 on the default profile: 25% → S250, 60% → S600.
    expect(out).toContain('G1 X10.000 Y0.000 F3000 S250');
    expect(out).toContain('G1 X30.000 Y0.000 F1200 S600');
    const sections = splitGcodeLayerSections(out);
    expect(sections.map((section) => section.layerId)).toEqual(['fast-low', 'slow-high']);
    expect(sections[0]?.body).not.toContain('S600');
    expect(sections[1]?.body).not.toContain('S250');
  });
});
