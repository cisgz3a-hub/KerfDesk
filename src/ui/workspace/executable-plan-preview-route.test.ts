import { describe, expect, it, vi } from 'vitest';
import { projectWithLine } from '../../__fixtures__/file-actions';
import { buildToolpath, type JobOriginPlacement, type Toolpath } from '../../core/job';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type Project,
} from '../../core/scene';
import { prepareOutput } from '../../io/gcode';
import { emitPreparedGcode } from '../../io/gcode/emit-gcode';
import { emitPreparedGcodeWithExecutablePlan } from '../../io/gcode/executable-plan-emission';
import {
  buildPreviewToolpath,
  buildPreviewToolpathFromPrepared,
  drawPreview,
} from './draw-preview';
import {
  buildExecutablePlanPreviewToolpath,
  comparePreviewRoutesAtEmitPrecision,
  previewRouteForDrawing,
  previewRouteSource,
  serializeExecutablePlanPreviewRoute,
} from './executable-plan-preview-route';
import type { PreviewToolpath } from './preview-status';

describe('ExecutablePlan non-live preview route', () => {
  it('selects plan motions for an emitted route that matches at command precision', () => {
    const project = projectWithLine();
    const prepared = prepareOutput(project);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const exactProgramBefore = emitPreparedGcode(prepared).gcode;

    const preview = buildPreviewToolpath(project);

    expect(previewRouteSource(preview)).toBe('executable-plan');
    expect(previewRouteForDrawing(preview)).not.toBe(preview);
    expect(emitPreparedGcode(prepared).gcode).toBe(exactProgramBefore);
    expect(Object.keys(preview)).toEqual(['steps', 'totalLength']);
  });

  it('draws a serialized plan route instead of its legacy carrier', () => {
    const preview: PreviewToolpath = {
      totalLength: 1,
      steps: [
        cutStep(1, [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ]),
      ],
      executablePlanPreview: {
        source: 'executable-plan',
        schema: 'curvedesk.executable-plan',
        schemaVersion: 1,
        toolpath: {
          totalLength: 2,
          steps: [
            cutStep(2, [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 2, y: 0 },
            ]),
          ],
        },
      },
    };
    const lineTo = vi.fn();
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo,
      stroke: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    drawPreview(ctx, preview, { scale: 1, offsetX: 0, offsetY: 0 }, 1, {
      showEndpoints: false,
    });

    expect(lineTo).toHaveBeenCalledTimes(2);
  });

  it('retains the legacy route when the current-position start basis differs', () => {
    const project = projectWithLine();
    const jobOrigin: JobOriginPlacement = {
      startFrom: 'current-position',
      anchor: 'front-left',
      currentPosition: { x: 120, y: 80 },
    };
    const prepared = prepareOutput(project, { jobOrigin });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const preview = buildPreviewToolpathFromPrepared(project, prepared, jobOrigin, {
      executablePlan: true,
    });

    expect(previewRouteSource(preview)).toBe('legacy-toolpath');
    expect(previewRouteForDrawing(preview)).toBe(preview);
  });

  it('retains the legacy CNC route when the plan exposes omitted boundary retracts', () => {
    const project = cncLineProject();
    const prepared = prepareOutput(project);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const emission = emitPreparedGcodeWithExecutablePlan(prepared);
    expect(emission.sidecar.kind).toBe('ok');
    if (emission.sidecar.kind !== 'ok') return;
    const legacy = buildToolpath(prepared.job, {
      startPoint: { x: 0, y: 0 },
      parkPoint: { x: 0, y: 0 },
      scanningOffsets: project.device.scanningOffsets,
      bedSizeMm: { widthMm: project.device.bedWidth, heightMm: project.device.bedHeight },
    });
    const planRoute = buildExecutablePlanPreviewToolpath(emission.sidecar.plan);

    expect(comparePreviewRoutesAtEmitPrecision(legacy, planRoute)).toMatchObject({
      ok: false,
      reason: 'segment-count',
      legacyCount: 4,
      planCount: 6,
      planSample: [
        'vertical 0,0->0,0 z:0->3.81',
        'rapid-travel 0,0->10,390 z:3.81->3.81',
        'vertical 10,390->10,390 z:3.81->-1',
        'process 10,390->20,390',
        'vertical 20,390->20,390 z:-1->3.81',
        'rapid-travel 20,390->0,0 z:3.81->3.81',
      ],
    });

    const preview = buildPreviewToolpath(project);

    expect(previewRouteSource(preview)).toBe('legacy-toolpath');
    expect(previewRouteForDrawing(preview)).toBe(preview);
  });

  it('retains the legacy route when travel intent differs', () => {
    const base = projectWithLine();
    const project = {
      ...base,
      device: { ...base.device, controlledLaserOffTravelFeedMmPerMin: 1200 },
    };

    const preview = buildPreviewToolpath(project);

    expect(previewRouteSource(preview)).toBe('legacy-toolpath');
  });

  it('leaves hand-built and unsupported carriers unchanged', () => {
    const legacy: Toolpath = {
      steps: [
        {
          kind: 'travel',
          from: { x: 0, y: 0 },
          to: { x: 1, y: 0 },
          length: 1,
        },
      ],
      totalLength: 1,
    };

    expect(previewRouteSource(legacy)).toBe('legacy-toolpath');
    expect(previewRouteForDrawing(legacy)).toBe(legacy);
    expect(serializeExecutablePlanPreviewRoute(legacy)).toBe(legacy);
    expect(comparePreviewRoutesAtEmitPrecision(legacy, { ...legacy, totalLength: 1.01 })).toEqual({
      ok: false,
      reason: 'route-length',
      legacy: '1.000',
      plan: '1.010',
    });
  });
});

function cutStep(
  length: number,
  polyline: ReadonlyArray<{ readonly x: number; readonly y: number }>,
) {
  return {
    kind: 'cut' as const,
    color: '#000000',
    length,
    polyline,
  };
}

function cncLineProject(): Project {
  const base = createProject();
  const color = '#111111';
  return {
    ...base,
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: {
      layers: [
        {
          ...createLayer({ id: color, color }),
          cnc: {
            ...DEFAULT_CNC_LAYER_SETTINGS,
            cutType: 'engrave',
            depthMm: 1,
            depthPerPassMm: 1,
          },
        },
      ],
      objects: [
        {
          kind: 'imported-svg',
          id: 'cnc-line',
          source: 'cnc-line.svg',
          bounds: { minX: 10, minY: 10, maxX: 20, maxY: 10 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color,
              polylines: [
                {
                  closed: false,
                  points: [
                    { x: 10, y: 10 },
                    { x: 20, y: 10 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}
