// ADR-255 §8 parity gate: timing a program the Inspector PARSED must agree
// with estimateJobDuration on the Job that produced it. Both now plan over
// core/motion-planner, so a divergence means the round trip
// (Job → G-code → parse → blocks) lost or invented motion — not that the
// physics drifted.
//
// Test files may import across modules (CLAUDE.md boundary exemption).

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { buildGcodeRenderModel } from '../gcode-view';
import { estimateJobDuration, type Job } from '../job';
import { grblStrategy } from '../output/grbl-strategy';
import { buildProgramTime } from './program-time';
import type { MotionLimits } from './motion-limits';

const DEVICE = DEFAULT_DEVICE_PROFILE;

const LIMITS: MotionLimits = {
  accelMmPerSec2: DEVICE.accelMmPerSec2,
  junctionDeviationMm: DEVICE.junctionDeviationMm,
  maxFeedMmPerMin: DEVICE.maxFeed,
};

function cutJob(polyline: ReadonlyArray<{ x: number; y: number }>, speed: number): Job {
  return {
    groups: [
      {
        kind: 'cut',
        layerId: 'L1',
        color: '#ff0000',
        power: 50,
        speed,
        passes: 1,
        airAssist: false,
        segments: [{ polyline, closed: true }],
      },
    ],
  };
}

const SQUARE = [
  { x: 20, y: 20 },
  { x: 80, y: 20 },
  { x: 80, y: 80 },
  { x: 20, y: 80 },
  { x: 20, y: 20 },
];

const ZIGZAG = Array.from({ length: 40 }, (_, index) => ({
  x: 20 + index * 2,
  y: index % 2 === 0 ? 20 : 26,
}));

describe('parity with estimateJobDuration', () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly job: Job;
  }> = [
    { name: 'square at 1500 mm/min', job: cutJob(SQUARE, 1500) },
    { name: 'square at 600 mm/min', job: cutJob(SQUARE, 600) },
    { name: 'corner-dense zigzag', job: cutJob(ZIGZAG, 3000) },
  ];

  for (const testCase of cases) {
    it(`${testCase.name} agrees within tolerance`, () => {
      const expected = estimateJobDuration(testCase.job, DEVICE).totalSeconds;
      const gcode = grblStrategy.emit(testCase.job, DEVICE);
      const parsed = buildGcodeRenderModel(gcode);
      expect(parsed.kind).toBe('ok');
      if (parsed.kind !== 'ok') return;
      const actual = buildProgramTime(parsed.model, LIMITS).motionSeconds;

      // Measured 2026-07-25: these three cases agree to 1.0000 — exactly,
      // to millisecond printing (10.727 / 25.011 / 10.302 s on both sides).
      // Sharing core/motion-planner removed the drift the design doc listed
      // as this feature's top fidelity risk. The 1% band is headroom for job
      // shapes not in this corpus (pre/post-amble motion the emitted program
      // does not contain), NOT observed slack — tighten it, never widen it.
      expect(actual).toBeGreaterThan(0);
      expect(expected).toBeGreaterThan(0);
      const ratio = actual / expected;
      expect(ratio).toBeGreaterThan(0.99);
      expect(ratio).toBeLessThan(1.01);
    });
  }

  it('preserves ordering: a slower feed takes longer on the same geometry', () => {
    const fast = timeOf(cutJob(SQUARE, 3000));
    const slow = timeOf(cutJob(SQUARE, 600));
    expect(slow).toBeGreaterThan(fast);
  });
});

function timeOf(job: Job): number {
  const parsed = buildGcodeRenderModel(grblStrategy.emit(job, DEVICE));
  if (parsed.kind !== 'ok') throw new Error(parsed.reason);
  return buildProgramTime(parsed.model, LIMITS).motionSeconds;
}
