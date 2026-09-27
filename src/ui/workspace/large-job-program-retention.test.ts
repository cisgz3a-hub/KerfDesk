import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM } from '../../core/scene';
import { prepareOutput } from '../../io/gcode';
import {
  largeJobPreparationFromPrepared,
  MAX_REUSABLE_PREVIEW_PROGRAM_CHARS,
} from './large-job-preparation';
import type * as LiveEstimate from '../laser/live-job-estimate';
import type * as DrawPreview from './draw-preview';

const captured = vi.hoisted(() => ({
  source: '',
  previewSource: undefined as string | undefined,
  observed: false,
  allowPlanEmission: undefined as boolean | undefined,
}));
vi.mock('../laser/live-job-estimate', async (original) => {
  const actual = await original<typeof LiveEstimate>();
  return {
    ...actual,
    estimateLiveJobFromPrepared: (
      _prepared: unknown,
      _origin: unknown,
      options: { readonly onEmittedProgram?: (source: string) => void },
    ) => {
      captured.observed = options.onEmittedProgram !== undefined;
      options.onEmittedProgram?.(captured.source);
      return { kind: 'empty' };
    },
  };
});
vi.mock('./draw-preview', async (original) => {
  const actual = await original<typeof DrawPreview>();
  return {
    ...actual,
    buildPreviewToolpathFromPrepared: (
      _project: unknown,
      _prepared: unknown,
      _origin: unknown,
      options: { readonly emittedProgram?: string; readonly allowPlanEmission?: boolean },
    ) => {
      captured.previewSource = options.emittedProgram;
      captured.allowPlanEmission = options.allowPlanEmission;
      return { steps: [], totalLength: 0 };
    },
  };
});

beforeEach(() => {
  captured.source = '';
  captured.previewSource = undefined;
  captured.observed = false;
  captured.allowPlanEmission = undefined;
});

describe('preview source retention bound', () => {
  it.each([MAX_REUSABLE_PREVIEW_PROGRAM_CHARS, MAX_REUSABLE_PREVIEW_PROGRAM_CHARS + 1])(
    'retains an emitted source of %i code units only within the bound',
    (length) => {
      const project = createProject();
      captured.source = 'x'.repeat(length);
      largeJobPreparationFromPrepared(project, prepareOutput(project), {});
      expect(captured.observed).toBe(true);
      expect(captured.previewSource).toBe(
        length <= MAX_REUSABLE_PREVIEW_PROGRAM_CHARS ? captured.source : undefined,
      );
      expect(captured.allowPlanEmission).toBe(false);
    },
  );

  it('does not retain a row-provider program while building its complete preview route', () => {
    const base = createProject();
    const project = {
      ...base,
      scene: {
        objects: [
          {
            kind: 'raster-image' as const,
            id: 'raster',
            source: 'row.png',
            dataUrl: 'data:image/png;base64,unused',
            lumaBase64: btoa(String.fromCharCode(0)),
            pixelWidth: 1,
            pixelHeight: 1,
            color: '#808080',
            dither: 'grayscale' as const,
            linesPerMm: 1,
            bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
            transform: IDENTITY_TRANSFORM,
          },
        ],
        layers: [createLayer({ id: 'image', color: '#808080', mode: 'image' })],
      },
    };
    const prepared = prepareOutput(project);
    if (!prepared.ok) throw new Error('raster fixture failed');
    const streamed = {
      ...prepared,
      job: {
        ...prepared.job,
        groups: prepared.job.groups.map((group) =>
          group.kind === 'raster'
            ? { ...group, rowProvider: () => new Float64Array([100]) }
            : group,
        ),
      },
    };
    expect(streamed.job.groups.some((group) => group.kind === 'raster')).toBe(true);
    captured.source = 'G1 X1 S100';
    largeJobPreparationFromPrepared(project, streamed, {});
    expect(captured.observed).toBe(false);
    expect(captured.previewSource).toBeUndefined();
  });
});
