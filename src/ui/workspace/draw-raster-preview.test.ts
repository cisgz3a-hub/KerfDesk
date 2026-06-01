import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { drawRasterPreview } from './draw-raster-preview';
import type { ViewTransform } from './view-transform';

function traceSourceRaster(): RasterImage {
  return {
    kind: 'raster-image',
    id: 'R1',
    source: 'source.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 2,
    pixelHeight: 2,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'floyd-steinberg',
    linesPerMm: 10,
    role: 'trace-source',
  };
}

describe('drawRasterPreview', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips trace-source backing images because they do not burn', () => {
    const project: Project = {
      ...createProject(),
      scene: {
        objects: [traceSourceRaster()],
        layers: [createLayer({ id: 'image', color: '#808080', mode: 'image' })],
      },
    };
    const createElement = vi.spyOn(document, 'createElement');
    const ctx = {} as CanvasRenderingContext2D;
    const view: ViewTransform = { scale: 1, offsetX: 0, offsetY: 0 };

    drawRasterPreview(ctx, project, view);

    expect(createElement).not.toHaveBeenCalled();
  });
});
