import { describe, expect, it } from 'vitest';
import { deviceForActiveHead } from '../../core/cnc/cnc-head-feeds';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Project,
} from '../../core/scene';
import { prepareOutput } from '../../io/gcode';
import { canvasJobTimingPlan } from '../state/canvas-job-timing-plan';
import { estimateLiveJob, estimateLiveJobFromPrepared } from './live-job-estimate';
import { buildPreparedJobMetrics } from './prepared-job-metrics';

function square(id: string, x: number, y: number): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: x, minY: y, maxX: x + 20, maxY: y + 20 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            closed: true,
            points: [
              { x, y },
              { x: x + 20, y },
              { x: x + 20, y: y + 20 },
              { x, y: y + 20 },
            ],
          },
        ],
      },
    ],
  };
}

// Rolling audit v2 09-P2-1: twelve on-path squares, laser Max feed 6000 and
// CNC Max feed 1500, as a router-only setup has after the CNC step.
function cncProject(laserMaxFeed: number): Project {
  const base = createProject();
  return {
    ...base,
    device: { ...base.device, maxFeed: laserMaxFeed },
    machine: {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      params: { ...DEFAULT_CNC_MACHINE_CONFIG.params, maxFeedMmPerMin: 1500 },
    },
    scene: {
      objects: Array.from({ length: 12 }, (_, i) =>
        square(`S${i}`, 10 + (i % 4) * 90, 10 + Math.floor(i / 4) * 120),
      ),
      layers: [
        {
          ...createLayer({ id: 'L1', color: '#ff0000' }),
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, depthMm: 1, depthPerPassMm: 1 },
        },
      ],
    },
  };
}

function prepared(project: Project) {
  const result = prepareOutput(project);
  if (!result.ok) throw new Error('expected the CNC job to prepare');
  return result;
}

describe('CNC time estimates read CNC Max feed (ADR-416 Decision 4)', () => {
  it('times rapids at CNC Max feed on the live tile and in Job Review, as the countdown does', () => {
    const project = cncProject(6000);
    const job = prepared(project);
    let gcode = '';
    const live = estimateLiveJobFromPrepared(job, undefined, {
      onEmittedProgram: (program) => {
        gcode = program;
      },
    });
    const countdown = canvasJobTimingPlan(
      gcode,
      deviceForActiveHead(project.device, project.machine),
      { x: 0, y: 0, z: 0 },
      {
        machineKind: 'cnc',
        controllerSessionEpoch: 1,
        positionEpoch: 1,
        activeControllerKind: 'grbl-v1.1',
        detectedControllerKind: 'grbl-v1.1',
      },
      'cnc',
    );
    if (countdown.kind !== 'ok') throw new Error(countdown.reason);

    // Before the fix both read 99.36 s (1m 39s): rapids ran at the laser's 6000.
    expect(live).toMatchObject({ kind: 'estimated', label: '2m 42s' });
    if (live.kind !== 'estimated') return;
    // 161.26 s until ADR-258 Amendment 5: each tabbed square now enters in
    // the middle of a tab at the tab top and steps down at the tab wall.
    expect(live.totalSeconds).toBeCloseTo(161.88, 1);
    expect(live.totalSeconds).toBeCloseTo(countdown.plan.totalSeconds, 6);
    expect(buildPreparedJobMetrics(job).duration.totalSeconds).toBeCloseTo(live.totalSeconds, 6);
  });

  it("leaves a CNC estimate alone when only the laser's Max feed changes", () => {
    const fast = estimateLiveJob(cncProject(6000));
    const slow = estimateLiveJob(cncProject(1500));

    expect(fast.kind).toBe('estimated');
    expect(slow).toEqual(fast);
  });
});
