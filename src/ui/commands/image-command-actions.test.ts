import { describe, expect, it, vi } from 'vitest';
import {
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
  type TracedImage,
} from '../../core/scene';
import { retraceOriginalAction, traceSourceForTracedImage } from './image-command-actions';

function raster(): RasterImage {
  return {
    kind: 'raster-image',
    id: 'src1',
    source: 'logo.png',
    dataUrl: 'data:image/png;base64,AAAA',
    pixelWidth: 20,
    pixelHeight: 10,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 10,
    role: 'trace-source',
  };
}

function trace(sourceId = 'src1'): TracedImage {
  return {
    kind: 'traced-image',
    id: 'trace1',
    source: 'logo.png',
    traceSourceId: sourceId,
    traceMode: 'filled-contours',
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#000000', polylines: [] }],
  };
}

function rasterTrace(sourceId = 'src1'): RasterImage {
  return {
    kind: 'raster-image',
    id: 'raster-trace',
    source: 'logo.png (bitmap)',
    traceSourceId: sourceId,
    dataUrl: 'data:image/png;base64,AAAA',
    pixelWidth: 20,
    pixelHeight: 10,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 10,
  };
}

function projectWith(...objects: Project['scene']['objects']): Project {
  const base = createProject();
  return { ...base, scene: { ...base.scene, objects } };
}

describe('retraceOriginalAction', () => {
  it('finds the original raster for a trace by traceSourceId', () => {
    const source = raster();
    expect(traceSourceForTracedImage(projectWith(source, trace()), trace())).toBe(source);
  });

  it('opens Trace Image on the original raster instead of the vector trace', () => {
    const source = raster();
    const selected = trace();
    const openImageDialog = vi.fn();
    const pushToast = vi.fn();

    retraceOriginalAction(projectWith(source, selected), selected, openImageDialog, pushToast)();

    expect(openImageDialog).toHaveBeenCalledWith(source, { replaceTraceId: selected.id });
    expect(pushToast).not.toHaveBeenCalled();
  });

  it('opens the original raster when the selected trace result is also a raster', () => {
    const source = raster();
    const selected = rasterTrace();
    const openImageDialog = vi.fn();
    const pushToast = vi.fn();

    expect(traceSourceForTracedImage(projectWith(source, selected), selected)).toBe(source);
    retraceOriginalAction(projectWith(source, selected), selected, openImageDialog, pushToast)();

    expect(openImageDialog).toHaveBeenCalledWith(source, { replaceTraceId: selected.id });
    expect(pushToast).not.toHaveBeenCalled();
  });

  it('reports a missing original raster instead of tracing the vector geometry', () => {
    const selected = trace('missing-source');
    const openImageDialog = vi.fn();
    const pushToast = vi.fn();

    retraceOriginalAction(projectWith(selected), selected, openImageDialog, pushToast)();

    expect(openImageDialog).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(
      'Original raster for logo.png is missing. Re-trace needs the kept source image.',
      'error',
    );
  });
});
