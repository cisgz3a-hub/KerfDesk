import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type RotarySetup } from '../../core/devices';
import { estimateJobDuration, machineSpaceJob, type CutGroup, type Job } from '../../core/job';
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
