// The plan-backed preview authority is a SECOND complete route, verified
// against the legacy one by materializing the whole emitted program at once.
// A dense traced line drawing compiles to millions of fill spans, where those
// copies — not the job — exhausted the renderer. Past the compiled-work
// advisory the legacy route stays the authority and the machine array it was
// compared against is consumed in place instead.

import { describe, expect, it, vi } from 'vitest';
import { projectWithLine } from '../../__fixtures__/file-actions';
import type * as CoreJob from '../../core/job';
import type { FillGroup, Job, Toolpath } from '../../core/job';
import { createProject } from '../../core/scene';
import { prepareOutput } from '../../io/gcode';
import { buildPreviewToolpathFromPrepared } from './draw-preview';
import {
  MAX_PLAN_PREVIEW_ROUTE_STEPS,
  planPreviewRouteEligible,
  previewRouteSource,
} from './executable-plan-preview-route';

const observed = vi.hoisted(() => ({ routes: [] as Toolpath[] }));
vi.mock('../../core/job', async (original) => {
  const actual = await original<typeof CoreJob>();
  return {
    ...actual,
    buildToolpath: (...args: Parameters<typeof actual.buildToolpath>) => {
      const route = actual.buildToolpath(...args);
      observed.routes.push(route);
      return route;
    },
  };
});

function fillJob(segmentCount: number): Job {
  const segments = [];
  for (let index = 0; index < segmentCount; index += 1) {
    const y = index * 0.1;
    segments.push({
      polyline: [
        { x: 0, y },
        { x: 8, y },
      ],
      closed: false,
      reverse: false,
    });
  }
  const group: FillGroup = {
    kind: 'fill',
    layerId: 'traced',
    color: '#000000',
    power: 30,
    speed: 1500,
    passes: 1,
    airAssist: false,
    overscanMm: 5,
    segments,
  };
  return { groups: [group] };
}

const anyJob = fillJob(1);

describe('plan preview route budget', () => {
  it('admits a route at the advisory budget and declines the step past it', () => {
    const prepared = {
      ok: true as const,
      project: createProject(),
      job: anyJob,
      jobOriginOffset: { x: 0, y: 0 },
    };
    expect(
      planPreviewRouteEligible({ prepared, routeStepCount: MAX_PLAN_PREVIEW_ROUTE_STEPS }),
    ).toBe(true);
    expect(
      planPreviewRouteEligible({ prepared, routeStepCount: MAX_PLAN_PREVIEW_ROUTE_STEPS + 1 }),
    ).toBe(false);
  });

  it('declines a current-position job and a streamed raster at any size', () => {
    const project = createProject();
    const streamed = {
      ok: true as const,
      project,
      job: {
        groups: [
          {
            kind: 'raster' as const,
            layerId: 'image',
            sourceObjectId: 'image-object',
            source: 'pixels.png',
            color: '#808080',
            power: 60,
            speed: 700,
            passes: 1,
            airAssist: false,
            pixelWidth: 2,
            pixelHeight: 1,
            sValues: new Float64Array(0),
            rowProvider: () => new Float64Array([600, 0]),
            bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
            overscanMm: 0.5,
          },
        ],
      } as unknown as Job,
      jobOriginOffset: { x: 0, y: 0 },
    };
    const vector = { ok: true as const, project, job: anyJob, jobOriginOffset: { x: 0, y: 0 } };
    expect(
      planPreviewRouteEligible({
        prepared: vector,
        jobOrigin: {
          startFrom: 'current-position',
          anchor: 'front-left',
          currentPosition: { x: 1, y: 2 },
        },
        routeStepCount: 2,
      }),
    ).toBe(false);
    expect(planPreviewRouteEligible({ prepared: streamed, routeStepCount: 2 })).toBe(false);
  });

  it('keeps the plan authority for an ordinary job', () => {
    const project = projectWithLine();
    const prepared = prepareOutput(project);
    expect(prepared.ok).toBe(true);
    const preview = buildPreviewToolpathFromPrepared(project, prepared, undefined, {
      executablePlan: true,
    });
    expect(previewRouteSource(preview)).toBe('executable-plan');
  });

  it('keeps the legacy route and consumes the machine array past the budget', () => {
    const project = createProject();
    // Every fill span compiles to a cut step plus the travel that reaches it,
    // so this clears the step budget with room to spare.
    const job = fillJob(MAX_PLAN_PREVIEW_ROUTE_STEPS);
    const prepared = { ok: true as const, project, job, jobOriginOffset: { x: 0, y: 0 } };
    observed.routes.length = 0;

    const preview = buildPreviewToolpathFromPrepared(project, prepared, undefined, {
      executablePlan: true,
    });

    const machineRoute = observed.routes[0];
    if (machineRoute === undefined) throw new Error('missing machine route');
    expect(machineRoute.steps.length).toBeGreaterThan(MAX_PLAN_PREVIEW_ROUTE_STEPS);
    expect(previewRouteSource(preview)).toBe('legacy-toolpath');
    // Slot reuse, not a second retained route.
    expect(preview.steps).toBe(machineRoute.steps);
  }, 120000);
});
