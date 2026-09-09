import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM } from '../../core/scene';
import { prepareOutput } from '../../io/gcode';
import type * as DrawPreview from './draw-preview';
import type * as LiveEstimate from '../laser/live-job-estimate';
import { largeJobPreparationFromPrepared } from './large-job-preparation';
import { serializeExecutablePlanPreviewRoute } from './executable-plan-preview-route';

const retained = vi.hoisted(() => ({ preview: false }));
vi.mock('./draw-preview', async (original) => {
  const actual = await original<typeof DrawPreview>();
  return {
    ...actual,
    buildPreviewToolpathFromPrepared: (
      ...args: Parameters<typeof actual.buildPreviewToolpathFromPrepared>
    ) => {
      retained.preview = true;
      return actual.buildPreviewToolpathFromPrepared(...args);
    },
  };
});
vi.mock('../laser/live-job-estimate', async (original) => {
  const actual = await original<typeof LiveEstimate>();
  return {
    ...actual,
    estimateLiveJobFromPrepared: (
      ...args: Parameters<typeof actual.estimateLiveJobFromPrepared>
    ) => {
      // A completed multi-million-step route must not be live during the
      // planner's independent allocations. Model that peak without a huge test.
      if (retained.preview) throw new Error('estimate retains the completed Preview route');
      return actual.estimateLiveJobFromPrepared(...args);
    },
  };
});

beforeEach(() => {
  retained.preview = false;
});

describe('large-job preparation allocation lifetime', () => {
  it.each([false, true])(
    'finishes the exact estimate before retaining a full route (streamed %s)',
    async (streamed) => {
      const project = {
        ...createProject(),
        scene: {
          objects: [
            {
              kind: 'raster-image' as const,
              id: 'raster',
              source: 'ordered-preparation.png',
              dataUrl: 'data:image/png;base64,unused',
              color: '#808080',
              pixelWidth: 4,
              pixelHeight: 3,
              lumaBase64: btoa(
                String.fromCharCode(0, 80, 160, 255, 200, 0, 120, 40, 255, 70, 220, 0),
              ),
              linesPerMm: 2,
              dither: 'floyd-steinberg' as const,
              bounds: { minX: 0, minY: 0, maxX: 2, maxY: 1.5 },
              transform: { ...IDENTITY_TRANSFORM, scaleX: 1.3, scaleY: 0.8, rotationDeg: 17 },
              operationIds: ['image'],
            },
          ],
          layers: [
            {
              ...createLayer({ id: 'image', color: '#808080', mode: 'image' }),
              linesPerMm: 2,
              passes: 2,
            },
          ],
        },
      };
      const compiled = prepareOutput(project);
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) throw new Error('fixture failed to prepare');
      // Exercise both storage contracts without allocating a huge fixture.
      // The row provider exposes the exact same compiled powers on every read.
      const prepared = streamed
        ? {
            ...compiled,
            job: {
              ...compiled.job,
              groups: compiled.job.groups.map((group) =>
                group.kind !== 'raster'
                  ? group
                  : {
                      ...group,
                      sValues: new Float64Array(0),
                      rowProvider: (y: number) =>
                        group.sValues.slice(y * group.pixelWidth, (y + 1) * group.pixelWidth),
                    },
              ),
            },
          }
        : compiled;
      const sourceBefore = structuredClone(project);
      const preparedBefore = structuredClone(compiled);
      const preview = await vi.importActual<typeof DrawPreview>('./draw-preview');
      const duration = await vi.importActual<typeof LiveEstimate>('../laser/live-job-estimate');
      // Derive the historical route-first result independently of the guarded
      // production entry. The lifetime change must preserve its complete value.
      const expectedToolpath = serializeExecutablePlanPreviewRoute(
        preview.buildPreviewToolpathFromPrepared(project, prepared, undefined, {
          executablePlan: true,
        }),
      );
      const expectedEstimate = duration.estimateLiveJobFromPrepared(prepared, undefined, {
        unbounded: true,
      });

      const result = largeJobPreparationFromPrepared(project, prepared, {});

      expect(result).toEqual({
        toolpath: expectedToolpath,
        jobOriginOffset: prepared.jobOriginOffset,
        estimate: expectedEstimate,
      });
      expect(retained.preview).toBe(true);
      expect(project).toEqual(sourceBefore);
      expect(structuredClone(compiled)).toEqual(preparedBefore);
    },
  );
});
