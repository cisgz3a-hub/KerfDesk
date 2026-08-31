import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type RotarySetup } from '../../core/devices';
import type { ExecutablePlanV1 } from '../../core/execution-plan';
import {
  estimateJobDuration,
  machineSpaceJob,
  type CncGroup,
  type CutGroup,
  type Job,
} from '../../core/job';
import { createProject } from '../../core/scene';
import type { PreparedOutput } from '../../io/gcode';
import { buildPreparedJobMetrics } from './prepared-job-metrics';

// Shipped chuck defaults: one revolution = 360 machine mm over a pi*60 mm
// surface, so machine Y is 360/(pi*60) ~= 1.9099x the design Y.
const CHUCK: RotarySetup = {
  enabled: true,
  type: 'chuck',
  mmPerRotation: 360,
  objectDiameterMm: 60,
};

function yLineJob(): Job {
  const group: CutGroup = {
    kind: 'cut',
    layerId: 'L1',
    color: '#ff0000',
    power: 50,
    speed: 600,
    passes: 1,
    airAssist: false,
    segments: [
      {
        closed: false,
        polyline: [
          { x: 0, y: 0 },
          { x: 0, y: 50 },
        ],
      },
    ],
  };
  return { groups: [group] };
}

function subPrecisionYLineJob(): Job {
  const job = yLineJob();
  const group = job.groups[0];
  if (group?.kind !== 'cut') throw new Error('Expected the cut fixture.');
  return {
    groups: [
      {
        ...group,
        segments: [
          {
            closed: false,
            polyline: [
              { x: 0, y: 0 },
              { x: 0, y: 50.0004 },
            ],
          },
        ],
      },
    ],
  };
}

function precisionCncJob(xs: ReadonlyArray<number>): Job {
  const group: CncGroup = {
    kind: 'cnc',
    layerId: 'cnc',
    color: '#000000',
    cutType: 'engrave',
    toolDiameterMm: 4,
    feedMmPerMin: 600,
    plungeMmPerMin: 200,
    spindleRpm: 12_000,
    spindleSpinupSec: 1,
    safeZMm: 5,
    passes: [
      {
        kind: 'contour',
        zMm: -1,
        closed: false,
        polyline: xs.map((x) => ({ x, y: 20_000 })),
      },
    ],
  };
  return { groups: [group] };
}

function deviceWith(rotary: RotarySetup | undefined) {
  return rotary === undefined ? DEFAULT_DEVICE_PROFILE : { ...DEFAULT_DEVICE_PROFILE, rotary };
}

// buildPreparedJobMetrics reads only `project` and `job` off PreparedOutput;
// the remaining fields of the success variant are irrelevant to duration and
// bounds, so a structural stand-in keeps the fixture readable.
function preparedWith(job: Job, rotary?: RotarySetup): Extract<PreparedOutput, { ok: true }> {
  const base = createProject();
  const project = { ...base, device: deviceWith(rotary) };
  return { ok: true, project, job } as unknown as Extract<PreparedOutput, { ok: true }>;
}

describe('buildPreparedJobMetrics rotary duration (ADR-127)', () => {
  it('measures the machine-space job, not the design surface', () => {
    const job = yLineJob();
    const device = deviceWith(CHUCK);
    const expected = estimateJobDuration(machineSpaceJob(job, device, undefined), device, {});

    const metrics = buildPreparedJobMetrics(preparedWith(job, CHUCK));

    expect(metrics.duration.totalSeconds).toBeCloseTo(expected.totalSeconds, 6);
  });

  it('counts a chuck rotary Y move as longer than the drawn surface distance', () => {
    const job = yLineJob();
    const flat = buildPreparedJobMetrics(preparedWith(job));
    const rotary = buildPreparedJobMetrics(preparedWith(job, CHUCK));

    // Guards the test itself: if these were equal the assertion above could
    // pass with the surface-space job still being measured.
    expect(rotary.duration.totalSeconds).toBeGreaterThan(flat.duration.totalSeconds);
  });

  it('leaves a non-rotary job byte-identical', () => {
    const job = yLineJob();
    const device = DEFAULT_DEVICE_PROFILE;
    const expected = estimateJobDuration(job, device, {});

    const metrics = buildPreparedJobMetrics(preparedWith(job));

    expect(metrics.duration.totalSeconds).toBeCloseTo(expected.totalSeconds, 6);
  });
});

describe('buildPreparedJobMetrics calculated bounds', () => {
  it('uses verified plan values while leaving Frame-specific bounds on the established path', () => {
    const job = subPrecisionYLineJob();
    const plan = {
      bounds: {
        processMm: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 50, maxZ: 0 },
        allMotionMm: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 50, maxZ: 0 },
      },
    } as ExecutablePlanV1;

    const metrics = buildPreparedJobMetrics(preparedWith(job), undefined, plan);

    expect(metrics.jobBounds?.maxY).toBe(50);
    expect(metrics.motionBounds?.maxY).toBe(50);
    expect(metrics.frameJobBounds?.maxY).toBe(50.0004);
    expect(metrics.frameMotionBounds?.maxY).toBe(50.0004);
  });

  it('uses represented CNC bounds for output disclosure and Frame on a mixed contour', () => {
    const metrics = buildPreparedJobMetrics(
      preparedWith(precisionCncJob([10_000, 10_010, 10_010.0004])),
    );

    expect(metrics.jobBounds?.maxX).toBe(10_012);
    expect(metrics.frameJobBounds?.maxX).toBe(10_012);
  });

  it('keeps a Frame outline while disclosing no emitted bounds for an emissionless contour', () => {
    const metrics = buildPreparedJobMetrics(preparedWith(precisionCncJob([10_000, 10_000.0004])));

    expect(metrics.jobBounds).toBeNull();
    expect(metrics.frameJobBounds).not.toBeNull();
  });
});
