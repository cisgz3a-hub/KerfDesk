// ADR-672: a camera capture kept after Trace from Camera is a picture of the
// bed, a placement reference like the LightBurn camera overlay. It stays in
// the scene but never engraves, while the trace made from it does.

import { describe, expect, it } from 'vitest';
import { compileJob } from '../../core/job';
import {
  createProject,
  IDENTITY_TRANSFORM,
  operationIdsForObject,
  type Project,
  type RasterImage,
  type TracedImage,
} from '../../core/scene';
import { CAMERA_CAPTURE_SOURCE } from '../../core/scene/reference-image-output';
import { applyCameraTraceImport } from './camera-trace-import';

function capture(): RasterImage {
  return {
    kind: 'raster-image',
    id: 'capture',
    source: CAMERA_CAPTURE_SOURCE,
    dataUrl: 'data:image/png;base64,AAAA',
    lumaBase64: 'QEBAQA==',
    pixelWidth: 2,
    pixelHeight: 2,
    bounds: { minX: 10, minY: 10, maxX: 30, maxY: 30 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'floyd-steinberg',
    linesPerMm: 5,
  };
}

function vectorTrace(): TracedImage {
  return {
    kind: 'traced-image',
    id: 'trace',
    source: CAMERA_CAPTURE_SOURCE,
    traceMode: 'filled-contours',
    tracePixelWidth: 2,
    tracePixelHeight: 2,
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 2, y: 0 },
              { x: 2, y: 2 },
              { x: 0, y: 2 },
            ],
          },
        ],
      },
    ],
  };
}

function rasterTrace(): RasterImage {
  return { ...capture(), id: 'raster-trace', source: 'camera capture (trace bitmap)' };
}

function sourcesInJob(project: Project): ReadonlyArray<string> {
  return compileJob(project.scene, project.device).groups.flatMap((group) =>
    group.kind === 'raster' ? [group.sourceObjectId ?? 'raster'] : [group.kind],
  );
}

function captureOperationsOutput(project: Project): ReadonlyArray<boolean> {
  const kept = project.scene.objects.find((object) => object.id === 'capture');
  if (kept === undefined) throw new Error('capture was not kept');
  const ids = operationIdsForObject(kept, project.scene.layers);
  return project.scene.layers.filter((layer) => ids.includes(layer.id)).map((l) => l.output);
}

describe('a camera capture kept after Trace (ADR-672)', () => {
  it('stays on an Image operation with Output off while the vector trace is output', () => {
    const result = applyCameraTraceImport(
      { project: createProject(), undoStack: [] },
      capture(),
      vectorTrace(),
      { deleteSourceAfterTrace: false },
    );

    expect(captureOperationsOutput(result.project)).toEqual([false]);
    expect(sourcesInJob(result.project)).toEqual(['fill']);
  });

  it('stays out of the job while the raster trace burns on its own operation', () => {
    const result = applyCameraTraceImport(
      { project: createProject(), undoStack: [] },
      capture(),
      rasterTrace(),
      { deleteSourceAfterTrace: false },
    );

    expect(captureOperationsOutput(result.project)).toEqual([false]);
    expect(sourcesInJob(result.project)).toEqual(['raster-trace']);
  });

  it('is removed with Delete Image After trace, leaving the trace output', () => {
    const result = applyCameraTraceImport(
      { project: createProject(), undoStack: [] },
      capture(),
      rasterTrace(),
      { deleteSourceAfterTrace: true },
    );

    expect(result.project.scene.objects.map((object) => object.id)).toEqual(['raster-trace']);
    expect(sourcesInJob(result.project)).toEqual(['raster-trace']);
  });
});
