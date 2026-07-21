import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type RasterImage,
  type TracedImage,
} from '../../core/scene';
import { PREPARATION_RAW_VECTOR_SEGMENT_BUDGET } from '../../core/job';
import { buildPreviewToolpath } from './draw-preview';

const gcodeMocks = vi.hoisted(() => ({
  prepareOutput: vi.fn(),
}));

vi.mock('../../io/gcode', () => gcodeMocks);

beforeEach(() => {
  gcodeMocks.prepareOutput.mockReset();
});

function traceProject(segmentCount: number) {
  const points = Array.from({ length: segmentCount + 1 }, (_, x) => ({ x, y: 0 }));
  const trace: TracedImage = {
    kind: 'traced-image',
    id: 'trace-1',
    source: 'trace.png',
    traceMode: 'centerline',
    bounds: { minX: 0, minY: 0, maxX: segmentCount, maxY: 0 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#000000', polylines: [{ closed: false, points }] }],
  };
  return {
    ...createProject(),
    scene: {
      ...EMPTY_SCENE,
      layers: [createLayer({ id: '#000000', color: '#000000', mode: 'line' })],
      objects: [trace],
    },
  };
}

describe('buildPreviewToolpath complexity guard', () => {
  it('prepares detailed traces above the old 10k segment guard', () => {
    const project = traceProject(12_000);
    gcodeMocks.prepareOutput.mockReturnValueOnce({
      ok: true,
      project,
      jobOriginOffset: { x: 0, y: 0 },
      job: {
        groups: [
          {
            kind: 'cut',
            layerId: '#000000',
            color: '#000000',
            power: 20,
            speed: 1000,
            passes: 1,
            airAssist: false,
            segments: [
              {
                closed: false,
                polyline: [
                  { x: 0, y: 0 },
                  { x: 10, y: 0 },
                ],
              },
            ],
          },
        ],
      },
    });

    const toolpath = buildPreviewToolpath(project);

    expect(gcodeMocks.prepareOutput).toHaveBeenCalledOnce();
    expect(toolpath.totalLength).toBeGreaterThan(0);
    expect((toolpath as { readonly previewIssue?: { kind: string } }).previewIssue).toBeUndefined();
  });

  it('skips extremely huge traces before full output preparation', () => {
    gcodeMocks.prepareOutput.mockImplementationOnce(() => {
      throw new Error('prepareOutput should not run for a preview-skipped huge trace');
    });
    const toolpath = buildPreviewToolpath(traceProject(PREPARATION_RAW_VECTOR_SEGMENT_BUDGET + 1));

    expect(gcodeMocks.prepareOutput).not.toHaveBeenCalled();
    expect(toolpath.totalLength).toBe(0);
    expect((toolpath as { readonly previewIssue?: { kind: string } }).previewIssue).toEqual({
      kind: 'too-complex',
    });
  });

  it('pauses the preview for a raster above the work-unit budget (ADR-243)', () => {
    gcodeMocks.prepareOutput.mockImplementationOnce(() => {
      throw new Error('prepareOutput should not run for a preview-paused huge raster');
    });
    const base = createProject();
    const color = '#808080';
    const raster: RasterImage = {
      kind: 'raster-image',
      id: 'R1',
      color,
      source: 'x.png',
      dataUrl: 'data:image/png;base64,unused',
      pixelWidth: 4,
      pixelHeight: 4,
      dither: 'floyd-steinberg',
      linesPerMm: 25,
      bounds: { minX: 0, minY: 0, maxX: 300, maxY: 300 },
      transform: IDENTITY_TRANSFORM,
    };
    const project = {
      ...base,
      scene: {
        ...EMPTY_SCENE,
        layers: [{ ...createLayer({ id: color, color, mode: 'image' as const }), linesPerMm: 25 }],
        objects: [raster],
      },
    };

    const toolpath = buildPreviewToolpath(project);

    expect(gcodeMocks.prepareOutput).not.toHaveBeenCalled();
    expect((toolpath as { readonly previewIssue?: { kind: string } }).previewIssue).toEqual({
      kind: 'too-complex',
    });
  });
});
