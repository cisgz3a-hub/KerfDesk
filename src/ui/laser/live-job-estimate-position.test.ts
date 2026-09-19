import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { buildProgramTimeline } from '../../core/gcode-time';
import { deviceProgramTimingOptions } from '../../core/gcode-time/program-timing-options';
import type { Job, JobOriginPlacement } from '../../core/job';
import { grblStrategy } from '../../core/output';
import {
  createLayer,
  createProject,
  DEFAULT_OUTPUT_SCOPE,
  IDENTITY_TRANSFORM,
} from '../../core/scene';
import { prepareOutput, type PreparedOutput } from '../../io/gcode';
import { prepareLargeJob } from '../workspace/large-job-preparation';
import {
  estimateLiveJob,
  estimateLiveJobFromPrepared,
  estimateLiveJobSnapshot,
  estimateLiveJobUnbounded,
} from './live-job-estimate';

const DEVICE = {
  ...DEFAULT_DEVICE_PROFILE,
  accelMmPerSec2: 500,
  junctionDeviationMm: 0.01,
  controlledLaserOffTravelFeedMmPerMin: 600,
};
const INITIAL_POSITION = { x: 300, y: 0, z: 0 };
const USER_ORIGIN = { startFrom: 'user-origin', anchor: 'front-left' } as const;
const JOB: Job = {
  groups: [
    {
      kind: 'cut',
      layerId: 'L1',
      color: '#000000',
      power: 50,
      speed: 600,
      passes: 1,
      airAssist: false,
      segments: [
        {
          polyline: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
          ],
          closed: false,
        },
      ],
    },
  ],
};
const PREPARED: Extract<PreparedOutput, { ok: true }> = {
  ok: true,
  project: { ...createProject(), device: DEVICE },
  job: JOB,
  jobOriginOffset: { x: 0, y: 0 },
};

function exactProgramSeconds(finishPosition?: { x: number; y: number }): number {
  const gcode = grblStrategy.emit(
    JOB,
    DEVICE,
    finishPosition === undefined ? {} : { finishPosition },
  );
  const result = buildProgramTimeline(
    gcode,
    {
      accelMmPerSec2: DEVICE.accelMmPerSec2,
      junctionDeviationMm: DEVICE.junctionDeviationMm,
      maxFeedMmPerMin: DEVICE.maxFeed,
    },
    { ...deviceProgramTimingOptions(DEVICE, 'laser'), initialPositionMm: INITIAL_POSITION },
  );
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.timeline.totalSeconds;
}

function lineProject() {
  return {
    ...createProject(),
    device: DEVICE,
    scene: {
      layers: [{ ...createLayer({ id: 'L1', color: '#000000' }), speed: 600 }],
      objects: [
        {
          kind: 'imported-svg' as const,
          id: 'line',
          source: 'line.svg',
          bounds: { minX: 0, minY: 0, maxX: 100, maxY: 0 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color: '#000000',
              polylines: [
                {
                  points: [
                    { x: 0, y: 0 },
                    { x: 100, y: 0 },
                  ],
                  closed: false,
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

describe('physical initial position (TIME-05)', () => {
  it.each([
    undefined,
    USER_ORIGIN,
    { startFrom: 'verified-origin', anchor: 'front-left' } as const,
  ] satisfies ReadonlyArray<JobOriginPlacement | undefined>)(
    'counts the 300 mm approach independently of placement %j',
    (jobOrigin) => {
      const fromOrigin = estimateLiveJobFromPrepared(PREPARED, jobOrigin);
      const actual = estimateLiveJobFromPrepared(PREPARED, jobOrigin, {
        initialPosition: INITIAL_POSITION,
      });
      expect(fromOrigin.kind).toBe('estimated');
      expect(actual.kind).toBe('estimated');
      if (fromOrigin.kind !== 'estimated' || actual.kind !== 'estimated') return;
      expect(actual.totalSeconds - fromOrigin.totalSeconds).toBeGreaterThan(29);
      expect(actual.totalSeconds).toBeCloseTo(exactProgramSeconds(), 8);
    },
  );

  it('keeps Current Position as the finish target when the actual starting head differs', () => {
    const finishPosition = { x: 120, y: 0 };
    const jobOrigin = {
      startFrom: 'current-position',
      anchor: 'front-left',
      currentPosition: finishPosition,
    } as const;
    const actual = estimateLiveJobFromPrepared(PREPARED, jobOrigin, {
      initialPosition: INITIAL_POSITION,
    });
    expect(actual.kind).toBe('estimated');
    if (actual.kind !== 'estimated') return;
    expect(actual.totalSeconds).toBeCloseTo(exactProgramSeconds(finishPosition), 8);
    expect(actual.totalSeconds).toBeLessThan(exactProgramSeconds(INITIAL_POSITION));
  });

  it('carries the starting head through bounded, snapshot and shared background preparation', async () => {
    const project = lineProject();
    const options = { initialPosition: INITIAL_POSITION };
    const prepared = prepareOutput(project, { jobOrigin: USER_ORIGIN });
    const expected = estimateLiveJobFromPrepared(prepared, USER_ORIGIN, options);
    const fromOrigin = estimateLiveJob(project, DEFAULT_OUTPUT_SCOPE, USER_ORIGIN);
    expect(expected.kind).toBe('estimated');
    expect(fromOrigin.kind).toBe('estimated');
    if (expected.kind !== 'estimated' || fromOrigin.kind !== 'estimated') return;
    expect(expected.totalSeconds - fromOrigin.totalSeconds).toBeGreaterThan(29);
    expect(estimateLiveJob(project, DEFAULT_OUTPUT_SCOPE, USER_ORIGIN, options)).toEqual(expected);
    expect(estimateLiveJobUnbounded(project, DEFAULT_OUTPUT_SCOPE, USER_ORIGIN, options)).toEqual(
      expected,
    );
    const renderVariableText = async () => {
      throw new Error('No variable text should render');
    };
    expect(
      await estimateLiveJobSnapshot(
        project,
        DEFAULT_OUTPUT_SCOPE,
        () => new Date(0),
        renderVariableText,
        undefined,
        USER_ORIGIN,
        options,
      ),
    ).toEqual(expected);
    expect(prepareLargeJob(project, { jobOrigin: USER_ORIGIN, ...options }).estimate).toEqual(
      expected,
    );
  });
});
