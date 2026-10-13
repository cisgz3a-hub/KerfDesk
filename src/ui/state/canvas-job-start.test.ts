import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import type { CutGroup } from '../../core/job';
import { applyJobStartPoint, jobStartPointOptions } from '../../core/job/job-start-point';
import { createProject } from '../../core/scene';
import { emitPreparedGcode, type PreparedOutput } from '../../io/gcode';
import { buildCanvasMarkerPlan, buildCanvasMotionPlan } from './canvas-motion-plan';

const machine = { statusReport: null, alarmCode: null, hasActiveStreamer: false };

function cut(power: number, x: number): CutGroup {
  return {
    kind: 'cut',
    layerId: String(x),
    color: '#ff0000',
    power,
    speed: 1000,
    passes: 1,
    airAssist: false,
    segments: [
      {
        closed: true,
        polyline: [
          { x, y: 20 },
          { x: x + 10, y: 20 },
          { x: x + 10, y: 30 },
          { x, y: 30 },
          { x, y: 20 },
        ],
      },
    ],
  };
}

function prepared(groups: CutGroup[]): Extract<PreparedOutput, { ok: true }> {
  return {
    ok: true,
    project: createProject({ ...DEFAULT_DEVICE_PROFILE, origin: 'rear-left' }),
    job: applyJobStartPoint({ groups }, { x: 55, y: 20 }),
    jobOriginOffset: { x: 0, y: 0 },
  };
}

describe('canvas selected cutting start', () => {
  it('matches emitted motion and editing metadata after positive power rounds to S0', () => {
    const project = createProject({
      ...DEFAULT_DEVICE_PROFILE,
      origin: 'rear-left',
      maxPowerS: 255,
    });
    const options = jobStartPointOptions(
      project.optimization,
      project.device.scanningOffsets,
      project.device,
    );
    const source = {
      ok: true as const,
      project,
      job: applyJobStartPoint({ groups: [cut(0.1, 10), cut(50, 50)] }, { x: 55, y: 20 }, options),
      jobOriginOffset: { x: 0, y: 0 },
    };
    const marker = buildCanvasMarkerPlan({ prepared: source, machine, relativeView: true });
    const live = buildCanvasMotionPlan({
      prepared: source,
      machine,
      relativeView: true,
      gcode: emitPreparedGcode(source).gcode,
    });
    expect(marker.jobStart).toEqual({ x: 55, y: 20 });
    expect(marker.jobStart).toEqual(live.jobStart);
    expect(marker.startEditingData?.job.groups[0]?.layerId).toBe('50');
  });
  it.each(['group', 'segment'] as const)(
    'matches the emitted first burn after a %s collapses at output precision',
    (kind) => {
      const collapsed: CutGroup = {
        ...cut(50, 10),
        segments: [
          {
            closed: false,
            polyline: [
              { x: 10.0001, y: 20 },
              { x: 10.0002, y: 20 },
            ],
          },
        ],
      };
      const vector = cut(50, 50);
      const groups =
        kind === 'group'
          ? [collapsed, vector]
          : [{ ...vector, segments: [...collapsed.segments, ...vector.segments] }];
      const source = prepared(groups);
      const marker = buildCanvasMarkerPlan({ prepared: source, machine, relativeView: true });
      const live = buildCanvasMotionPlan({
        prepared: source,
        machine,
        relativeView: true,
        gcode: emitPreparedGcode(source).gcode,
      });
      expect(marker.jobStart).toEqual({ x: 55, y: 20 });
      expect(marker.jobStart).toEqual(live.jobStart);

      const empty = buildCanvasMarkerPlan({
        prepared: prepared([collapsed]),
        machine,
        relativeView: true,
      });
      expect(empty.jobStart).toBeNull();
    },
  );

  it('matches the actual first burn after zero-power travel operations', () => {
    const source = prepared([cut(0, 10), cut(50, 50)]);
    const marker = buildCanvasMarkerPlan({ prepared: source, machine, relativeView: true });
    const live = buildCanvasMotionPlan({
      prepared: source,
      machine,
      relativeView: true,
      gcode: emitPreparedGcode(source).gcode,
    });
    expect(marker.jobStart).toEqual({ x: 55, y: 20 });
    expect(marker.jobStart).toEqual(live.jobStart);
  });

  it('has no cutting start when every laser operation has zero power', () => {
    const marker = buildCanvasMarkerPlan({
      prepared: prepared([cut(0, 10)]),
      machine,
      relativeView: true,
    });
    expect(marker.jobStart).toBeNull();
  });
});
