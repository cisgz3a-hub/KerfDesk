import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_OUTPUT_SCOPE,
  IDENTITY_TRANSFORM,
  type Project,
} from '../../core/scene';
import { canvasPlanRetentionKey } from '../../ui/state/canvas-motion-plan';
import { resolveJobPlacement } from '../../ui/job-placement';
import { buildIdleCanvasMotionPlan } from '../../ui/workspace/use-canvas-motion-overlay';
import { ciBudgetMs } from '../ci-budget';

describe('canvas motion overlay performance budgets', () => {
  it('reuses the retention key for a 100k-point immutable trace', () => {
    const project = denseTraceProject(100_000);
    const placement = { startFrom: 'absolute' as const, anchor: 'front-left' as const };
    canvasPlanRetentionKey(project, DEFAULT_OUTPUT_SCOPE, placement);
    const started = performance.now();
    for (let index = 0; index < 100; index += 1) {
      canvasPlanRetentionKey(project, DEFAULT_OUTPUT_SCOPE, placement);
    }
    const elapsed = performance.now() - started;
    console.info(`[canvas-motion-perf] 100 cached dense-trace lookups=${elapsed.toFixed(2)}ms`);
    expect(elapsed).toBeLessThan(ciBudgetMs(50, 500));
  });

  it('builds idle markers without emitting the full 50k-point G-code program', async () => {
    const project = denseTraceProject(50_000);
    const placementSettings = { startFrom: 'absolute' as const, anchor: 'front-left' as const };
    const laser = disconnectedLaser();
    const placement = resolveJobPlacement(placementSettings, laser);
    const started = performance.now();
    const plan = await buildIdleCanvasMotionPlan(
      {
        project,
        previewMode: false,
        liveRun: null,
        outputScope: DEFAULT_OUTPUT_SCOPE,
        placementSettings,
        placement,
        rotaryRaster: false,
        registrationKey: '',
        machineRevision: 'performance-fixture',
        interactionActive: false,
        laser,
      },
      placement,
    );
    const elapsed = performance.now() - started;
    console.info(`[canvas-motion-perf] 50k idle marker plan=${elapsed.toFixed(2)}ms`);
    expect(plan?.jobStart).not.toBeNull();
    expect(elapsed).toBeLessThan(ciBudgetMs(250, 750));
  });
});

function disconnectedLaser() {
  return {
    connection: { kind: 'disconnected' as const },
    statusReport: null,
    alarmCode: null,
    hasActiveStreamer: false,
    controllerSettings: null,
    reportInches: false,
    workOriginActive: false,
    wcoCache: null,
    trustedPositionEpoch: 0,
    statusQuery: 'realtime-report' as const,
  };
}

function denseTraceProject(pointCount: number): Project {
  const project = createProject();
  const points = Array.from({ length: pointCount }, (_, index) => ({
    x: (index % 1_000) / 10,
    y: ((index * 7) % 1_000) / 10,
  }));
  return {
    ...project,
    scene: {
      layers: [createLayer({ id: 'dense-trace-layer', color: '#ff0000' })],
      objects: [
        {
          kind: 'imported-svg',
          id: 'dense-trace',
          source: 'dense-trace.svg',
          bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
          transform: IDENTITY_TRANSFORM,
          paths: [{ color: '#ff0000', polylines: [{ points, closed: false }] }],
        },
      ],
    },
  };
}
