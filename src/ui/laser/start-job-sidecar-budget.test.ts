import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StatusQueryCapability } from '../../core/controllers';
import type { Job } from '../../core/job';
import { createProject } from '../../core/scene';
import { emitPreparedGcode, type PreparedOutput } from '../../io/gcode';
import * as executablePlan from '../../io/gcode/executable-plan';
import { buildCanvasMotionPlan } from '../state/canvas-motion-plan';
import { canvasExecutablePlan } from '../state/canvas-preview-motion';
import { canvasProgramSource } from '../state/canvas-program-source';
import { resolveFrameCandidate } from './frame-candidate';
import { buildPreparedJobMetrics } from './prepared-job-metrics';
import { okPreparation } from './start-job-preparation';

const MACHINE = {
  statusReport: {
    state: 'Idle' as const,
    subState: null,
    mPos: { x: 0, y: 0, z: 0 },
    wPos: { x: 0, y: 0, z: 0 },
    feed: 0,
    spindle: 0,
    wco: null,
  },
  alarmCode: null,
  hasActiveStreamer: false,
};

describe('Frame preparation optional sidecar allocation', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each<StatusQueryCapability>(['realtime-report', 'queued-poll', 'none'])(
    'keeps a dense exact program and Frame bounds without entering the sidecar builder for %s',
    (statusQuery) => {
      const prepared = linePrepared(25_001);
      const { gcode } = emitPreparedGcode(prepared);
      const sidecar = vi
        .spyOn(executablePlan, 'buildExecutablePlanSidecar')
        .mockImplementation(() => {
          throw new Error('A dense optional sidecar must not be allocated.');
        });

      const result = okPreparation(
        gcode,
        [],
        undefined,
        [],
        prepared,
        { ...MACHINE, statusQuery },
        undefined,
        false,
        'dense-frame',
      );

      expect(sidecar.mock.calls.length).toBe(0);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.gcode).toBe(gcode);
      expect(canvasProgramSource(result.canvasPlan)).toBe(gcode);
      expect(result.canvasPlan.manifest.blocks.length).toBeGreaterThanOrEqual(25_001);
      expect(result.canvasPlan.manifest.finalPoint).toEqual({ x: 0, y: 0, z: 0 });
      expect(canvasExecutablePlan(result.canvasPlan)).toBeUndefined();
      const metrics = buildPreparedJobMetrics(prepared);
      expect(result.metrics).toEqual(metrics);
      expect(resolveFrameCandidate(result)).toEqual({
        ok: true,
        jobBounds: metrics.frameJobBounds,
        motionBounds: metrics.frameMotionBounds,
      });
    },
  );

  it('counts expanded arc segments before creating the optional sidecar', () => {
    const gcode = [
      'G21 G90',
      'M3 S500',
      'G0 X100 Y0',
      ...Array.from({ length: 300 }, () => 'G2 X100 Y0 I-100 J0 F600'),
    ].join('\n');
    const sidecar = vi
      .spyOn(executablePlan, 'buildExecutablePlanSidecar')
      .mockImplementation(() => {
        throw new Error('An arc-expanded optional sidecar must not be allocated.');
      });

    const plan = buildCanvasMotionPlan({ gcode, prepared: linePrepared(1), machine: MACHINE });

    expect(sidecar.mock.calls.length).toBe(0);
    expect(plan.manifest.blocks).toHaveLength(301);
    expect(
      plan.manifest.blocks.reduce((count, block) => count + block.points.length - 1, 0),
    ).toBeGreaterThan(25_000);
    expect(plan.manifest.finalPoint).toEqual({ x: 100, y: 0, z: 0 });
    expect(canvasProgramSource(plan)).toBe(gcode);
  });

  it('retains the verified sidecar for a small prepared program', () => {
    const prepared = linePrepared(3);
    const { gcode } = emitPreparedGcode(prepared);
    const sidecar = vi.spyOn(executablePlan, 'buildExecutablePlanSidecar');

    const result = okPreparation(
      gcode,
      [],
      undefined,
      [],
      prepared,
      MACHINE,
      undefined,
      false,
      'small-frame',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(sidecar).toHaveBeenCalledTimes(1);
    expect(canvasExecutablePlan(result.canvasPlan)?.compatibility.exactProgram).toBe(gcode);
    expect(result.gcode).toBe(gcode);
    expect(result.metrics).toEqual(buildPreparedJobMetrics(prepared));
  });
});

function linePrepared(segments: number): Extract<PreparedOutput, { readonly ok: true }> {
  const job: Job = {
    groups: [
      {
        kind: 'cut',
        layerId: 'trace',
        color: '#ff0000',
        power: 50,
        speed: 1_000,
        passes: 1,
        airAssist: false,
        segments: [
          {
            polyline: Array.from({ length: segments + 1 }, (_, index) => ({ x: index % 2, y: 20 })),
            closed: false,
          },
        ],
      },
    ],
  };
  return { ok: true, project: createProject(), job, jobOriginOffset: { x: 0, y: 0 } };
}
