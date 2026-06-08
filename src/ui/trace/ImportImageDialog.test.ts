import { act } from 'react';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./image-loader', () => ({
  PREVIEW_MAX_EDGE_PX: 2048,
  loadImageAsRawData: vi.fn(async () => ({
    width: 2,
    height: 2,
    data: new Uint8ClampedArray(16),
  })),
  dataUrlToFile: vi.fn(async () => new File(['image'], 'logo.png', { type: 'image/png' })),
}));
vi.mock('./use-trace-worker-client', () => ({
  traceImageWithFallback: vi.fn(async () => ({
    paths: [{ color: '#000000', polylines: [] }],
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
  })),
}));

import { IDENTITY_TRANSFORM, type RasterImage, type SceneObject } from '../../core/scene';
import { DEFAULT_TRACE_OPTIONS } from '../../core/trace';
import { useUiStore } from '../state/ui-store';
import { commit, ImportImageDialog, sameTraceSource } from './ImportImageDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function seedRaster(over: Partial<RasterImage> = {}): RasterImage {
  return {
    kind: 'raster-image',
    id: 'src-1',
    source: 'logo.png',
    dataUrl: 'data:image/png;base64,AAA',
    pixelWidth: 100,
    pixelHeight: 80,
    bounds: { minX: 0, minY: 0, maxX: 50, maxY: 40 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'floyd-steinberg',
    linesPerMm: 10,
    ...over,
  };
}

function ctxWith(getCurrentObject: (id: string) => SceneObject | undefined) {
  return {
    traceExistingImage: vi.fn(),
    pushToast: vi.fn(),
    close: vi.fn(),
    setBusy: vi.fn(),
    getCurrentObject,
  };
}

const args = (seed: RasterImage) => ({
  file: new File([''], 'logo.png'),
  options: DEFAULT_TRACE_OPTIONS,
  seed,
});

describe('sameTraceSource', () => {
  const seed = seedRaster();
  it('true when the live source is unchanged', () => {
    expect(sameTraceSource(seedRaster(), seed)).toBe(true);
  });
  it('false when the source was removed', () => {
    expect(sameTraceSource(undefined, seed)).toBe(false);
  });
  it('false when the image content (dataUrl) changed', () => {
    expect(sameTraceSource(seedRaster({ dataUrl: 'data:image/png;base64,BBB' }), seed)).toBe(false);
  });
  it('false when the pixel grid changed', () => {
    expect(sameTraceSource(seedRaster({ pixelWidth: 200 }), seed)).toBe(false);
  });
  it('false when the object is no longer a raster', () => {
    const svg: SceneObject = {
      kind: 'imported-svg',
      id: 'src-1',
      source: 'logo.svg',
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      transform: IDENTITY_TRANSFORM,
      paths: [],
    };
    expect(sameTraceSource(svg, seed)).toBe(false);
  });
});

describe('commit source revalidation (P2-A)', () => {
  it('commits when the live source is unchanged', async () => {
    const seed = seedRaster();
    const ctx = ctxWith(() => seedRaster());
    await commit(args(seed), ctx);
    expect(ctx.traceExistingImage).toHaveBeenCalledTimes(1);
  });

  it('aborts (no overlay) when the live source content changed mid-dialog', async () => {
    const seed = seedRaster();
    const ctx = ctxWith(() => seedRaster({ dataUrl: 'data:image/png;base64,BBB' }));
    await commit(args(seed), ctx);
    expect(ctx.traceExistingImage).not.toHaveBeenCalled();
    expect(ctx.pushToast).toHaveBeenCalledWith(
      expect.stringContaining('changed or was removed'),
      'error',
    );
  });

  it('aborts when the live source was removed mid-dialog', async () => {
    const seed = seedRaster();
    const ctx = ctxWith(() => undefined);
    await commit(args(seed), ctx);
    expect(ctx.traceExistingImage).not.toHaveBeenCalled();
  });
});

describe('Trace Image workflow controls', () => {
  it('shows vector trace settings without image-adjustment controls', async () => {
    const { host, root } = await renderTraceDialog(seedRaster());
    try {
      const text = host.textContent ?? '';
      expect(text).toContain('Trace settings');
      expect(text).toContain('Cutoff');
      expect(text).toContain('Threshold');
      expect(text).toContain('Ignore Less Than');
      expect(text).toContain('Smoothness');
      expect(text).toContain('Optimize');
      expect(text).toContain('Fade Image');
      expect(text).not.toContain('Image adjustments');
      expect(text).not.toContain('Brightness');
      expect(text).not.toContain('Contrast');
      expect(text).not.toContain('Gamma');
      expect(text).not.toContain('Invert');
    } finally {
      await act(async () => root.unmount());
      host.remove();
      useUiStore.setState({ imageDialog: null });
    }
  });
});

async function renderTraceDialog(
  seed: RasterImage,
): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  useUiStore.setState({ imageDialog: seed });
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(createElement(ImportImageDialog));
  });
  if (root === null) throw new Error('root did not mount');
  return { host, root };
}
