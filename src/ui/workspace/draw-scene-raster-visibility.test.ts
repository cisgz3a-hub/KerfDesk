// M23 (AUDIT-2026-06-10): hiding an image-mode layer hid vector paths but
// raster bitmaps kept rendering — drawObjects called drawRasterImage
// unconditionally, so the Show toggle visibly did nothing for images.
// LightBurn: hiding a layer hides every object on it, images included.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { drawScene } from './draw-scene';

class CompleteImage {
  complete = true;
  naturalWidth = 2;
  naturalHeight = 2;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = '';
}

function countingContext(): {
  readonly ctx: CanvasRenderingContext2D;
  readonly calls: { drawImage: number };
} {
  const calls = { drawImage: 0 };
  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'drawImage') {
          return () => {
            calls.drawImage += 1;
          };
        }
        if (prop === 'measureText') return () => ({ width: 280 });
        return () => undefined;
      },
      set() {
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
  return { ctx, calls };
}

function rasterProject(args: { visible: boolean; dataUrl: string }): Project {
  const image: RasterImage = {
    kind: 'raster-image',
    id: 'R1',
    source: 'photo.png',
    dataUrl: args.dataUrl,
    pixelWidth: 2,
    pixelHeight: 2,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 10,
  };
  const project = createProject();
  return {
    ...project,
    scene: {
      layers: [
        {
          ...createLayer({ id: '#808080', color: '#808080', mode: 'image' }),
          visible: args.visible,
        },
      ],
      objects: [image],
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('drawScene raster layer visibility (M23)', () => {
  it('draws the bitmap when its image-mode layer is visible', () => {
    vi.stubGlobal('Image', CompleteImage);
    const { ctx, calls } = countingContext();

    drawScene(ctx, 800, 600, rasterProject({ visible: true, dataUrl: 'data:image/png;m23-a' }), {
      selectedId: null,
      preview: false,
      view: { zoomFactor: 1, panX: 0, panY: 0 },
    });

    expect(calls.drawImage).toBe(1);
  });

  it('skips the bitmap when its image-mode layer is hidden', () => {
    vi.stubGlobal('Image', CompleteImage);
    const { ctx, calls } = countingContext();

    drawScene(ctx, 800, 600, rasterProject({ visible: false, dataUrl: 'data:image/png;m23-b' }), {
      selectedId: null,
      preview: false,
      view: { zoomFactor: 1, panX: 0, panY: 0 },
    });

    expect(calls.drawImage).toBe(0);
  });

  it('still draws a bitmap whose color matches no layer (fail visible)', () => {
    vi.stubGlobal('Image', CompleteImage);
    const { ctx, calls } = countingContext();
    const project = rasterProject({ visible: false, dataUrl: 'data:image/png;m23-c' });
    const orphan: Project = {
      ...project,
      scene: { ...project.scene, layers: [] },
    };

    drawScene(ctx, 800, 600, orphan, {
      selectedId: null,
      preview: false,
      view: { zoomFactor: 1, panX: 0, panY: 0 },
    });

    expect(calls.drawImage).toBe(1);
  });
});
