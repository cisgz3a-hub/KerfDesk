// The plan-backed preview authority is a SECOND complete route, verified
// against the legacy one by materializing the whole emitted program at once.
// A dense traced line drawing compiles to millions of fill spans, where those
// copies — not the job — exhausted the renderer. Past the compiled-work
// advisory the legacy route stays the authority and the machine array it was
// compared against is consumed in place instead.

import { describe, expect, it, vi } from 'vitest';
import { projectWithLine } from '../../__fixtures__/file-actions';
import type * as CoreJob from '../../core/job';
import type { CutGroup, FillGroup, Job, Toolpath } from '../../core/job';
import { buildToolpath } from '../../core/job';
import { createProject } from '../../core/scene';
import { measureCompiledWork } from '../../core/preflight/compiled-work';
import { prepareOutput } from '../../io/gcode';
import { PackedToolpathSteps } from '../../core/job/packed-toolpath-steps';
import { buildPreviewToolpathFromPrepared } from './draw-preview';
import { planPreviewRouteEligible, previewRouteSource } from './executable-plan-preview-route';
import { MAX_PLAN_PREVIEW_ROUTE_SEGMENTS } from './preview-route-budget';

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

function contourJob(segmentCount: number): Job {
  return {
    groups: [
      {
        kind: 'cut',
        layerId: 'contour',
        color: '#000000',
        power: 30,
        speed: 1500,
        passes: 1,
        airAssist: false,
        segments: [
          {
            polyline: Array.from({ length: segmentCount + 1 }, (_, index) => ({
              x: (index % 500) * 0.1,
              y: Math.floor(index / 500) * 0.1,
            })),
            closed: false,
          },
        ],
      },
    ],
  };
}

describe('plan preview route budget', () => {
  it('admits a contour at the segment budget and declines its next edge', () => {
    const job = contourJob(MAX_PLAN_PREVIEW_ROUTE_SEGMENTS);
    const prepared = {
      ok: true as const,
      project: createProject(),
      job,
      jobOriginOffset: { x: 0, y: 0 },
    };
    expect(measureCompiledWork(job).motionSegments).toBe(MAX_PLAN_PREVIEW_ROUTE_SEGMENTS);
    expect(planPreviewRouteEligible({ prepared, route: buildToolpath(job) })).toBe(true);
    const overBudget = contourJob(MAX_PLAN_PREVIEW_ROUTE_SEGMENTS + 1);
    expect(measureCompiledWork(overBudget).motionSegments).toBe(
      MAX_PLAN_PREVIEW_ROUTE_SEGMENTS + 1,
    );
    const route = buildToolpath(overBudget);
    expect(route.steps).toHaveLength(1);
    expect(planPreviewRouteEligible({ prepared: { ...prepared, job: overBudget }, route })).toBe(
      false,
    );
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
        route: buildToolpath(anyJob),
      }),
    ).toBe(false);
    expect(planPreviewRouteEligible({ prepared: streamed, route: buildToolpath(anyJob) })).toBe(
      false,
    );
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
    const job = fillJob(MAX_PLAN_PREVIEW_ROUTE_SEGMENTS);
    const prepared = { ok: true as const, project, job, jobOriginOffset: { x: 0, y: 0 } };
    observed.routes.length = 0;

    const preview = buildPreviewToolpathFromPrepared(project, prepared, undefined, {
      executablePlan: true,
    });

    const machineRoute = observed.routes[0];
    if (machineRoute === undefined) throw new Error('missing machine route');
    expect(machineRoute.steps.length).toBeGreaterThan(MAX_PLAN_PREVIEW_ROUTE_SEGMENTS);
    expect(previewRouteSource(preview)).toBe('legacy-toolpath');
    // Columnar buffers, not a second retained route, and the machine array it
    // was mapped out of is drained slot by slot rather than left beside it.
    expect(preview.steps).toBeInstanceOf(PackedToolpathSteps);
    expect(preview.steps.length).toBe(machineRoute.steps.length);
    expect(
      [...(machineRoute.steps as unknown as Array<unknown>)].every((step) => step === undefined),
    ).toBe(true);
    // Still readable end to end, one step at a time, out of the buffers.
    expect(preview.steps.at(0)).toBeDefined();
    expect(preview.steps.at(preview.steps.length - 1)).toBeDefined();
    expect(preview.steps.filter((step) => step.kind === 'cut')).toHaveLength(
      MAX_PLAN_PREVIEW_ROUTE_SEGMENTS,
    );
  }, 120000);

  it('packs a single large contour and retains every point without a second plan', () => {
    const project = createProject();
    const job = contourJob(MAX_PLAN_PREVIEW_ROUTE_SEGMENTS + 1);
    const prepared = { ok: true as const, project, job, jobOriginOffset: { x: 0, y: 0 } };
    const preview = buildPreviewToolpathFromPrepared(project, prepared, undefined, {
      executablePlan: true,
    });
    expect(previewRouteSource(preview)).toBe('legacy-toolpath');
    expect(preview.steps).toBeInstanceOf(PackedToolpathSteps);
    const cut = preview.steps.find((step) => step.kind === 'cut');
    expect(cut?.polyline).toHaveLength(MAX_PLAN_PREVIEW_ROUTE_SEGMENTS + 2);
    const source = job.groups[0] as CutGroup;
    expect(cut?.polyline).toEqual(
      source.segments[0]?.polyline.map((point) => ({
        x: point.x,
        y: project.device.bedHeight - point.y,
      })),
    );
  });
});
