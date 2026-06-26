import { act } from 'react';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./image-loader', () => ({
  PREVIEW_MAX_EDGE_PX: 2048,
  loadImageAsRawData: vi.fn(async () => ({
    width: 2,
    height: 2,
    data: new Uint8ClampedArray([
      255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255,
    ]),
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
import { DEFAULT_TRACE_OPTIONS, type TraceBoundary } from '../../core/trace';
import { useUiStore } from '../state/ui-store';
import { loadImageAsRawData } from './image-loader';
import { commit, ImportImageDialog, sameTraceSource } from './ImportImageDialog';
import { traceImageWithFallback } from './use-trace-worker-client';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.mocked(traceImageWithFallback).mockClear();
});

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

const args = (
  seed: RasterImage,
  overrides: {
    readonly deleteSourceAfterTrace?: boolean;
    readonly boundary?: TraceBoundary | null;
  } = {},
) => ({
  file: new File([''], 'logo.png'),
  options: DEFAULT_TRACE_OPTIONS,
  seed,
  ...overrides,
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
    expect(ctx.traceExistingImage).toHaveBeenCalledWith(
      'src-1',
      expect.objectContaining({ kind: 'traced-image' }),
      { deleteSourceAfterTrace: false },
    );
    expect(ctx.pushToast).toHaveBeenCalledWith(expect.stringContaining('source kept'), 'success');
  });

  it('passes Delete Image After trace through commit and reports source deleted', async () => {
    const seed = seedRaster();
    const ctx = ctxWith(() => seedRaster());
    await commit(args(seed, { deleteSourceAfterTrace: true }), ctx);
    expect(ctx.traceExistingImage).toHaveBeenCalledWith(
      'src-1',
      expect.objectContaining({ kind: 'traced-image' }),
      { deleteSourceAfterTrace: true },
    );
    expect(ctx.pushToast).toHaveBeenCalledWith(
      expect.stringContaining('source deleted'),
      'success',
    );
  });

  it('commits a bounded trace in source-image coordinates', async () => {
    vi.mocked(traceImageWithFallback).mockResolvedValueOnce({
      paths: [
        {
          color: '#000000',
          polylines: [
            {
              closed: false,
              points: [
                { x: 0, y: 0 },
                { x: 1, y: 2 },
              ],
            },
          ],
        },
      ],
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 2 },
    });
    const seed = seedRaster();
    const ctx = ctxWith(() => seedRaster());
    await commit(args(seed, { boundary: { x: 1, y: 0, width: 1, height: 2 } }), ctx);

    expect(traceImageWithFallback).toHaveBeenCalledWith(
      expect.objectContaining({ width: 1, height: 2 }),
      DEFAULT_TRACE_OPTIONS,
    );
    expect(ctx.traceExistingImage).toHaveBeenCalledWith(
      'src-1',
      expect.objectContaining({
        bounds: { minX: 1, minY: 0, maxX: 2, maxY: 2 },
        paths: [
          {
            color: '#000000',
            polylines: [
              {
                closed: false,
                points: [
                  { x: 1, y: 0 },
                  { x: 2, y: 2 },
                ],
              },
            ],
          },
        ],
      }),
      { deleteSourceAfterTrace: false },
    );
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
  it('labels Edge Detection as an edge-contour preset', async () => {
    const { host, root } = await renderTraceDialog(seedRaster());
    try {
      const select = host.querySelector('select[aria-label="Trace preset"]');
      expect(select).toBeInstanceOf(HTMLSelectElement);
      const edgeOption = Array.from((select as HTMLSelectElement).options).find(
        (option) => option.value === 'Edge Detection',
      );
      expect(edgeOption?.textContent).toBe('Edge Detection (edge contours)');
    } finally {
      await act(async () => root.unmount());
      host.remove();
      useUiStore.setState({ imageDialog: null });
    }
  });

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
      expect(text).toContain('Trace alpha mask');
      expect(text).toContain('Line Art automatically preserves pale logo details.');
      expect(text).not.toContain('Force Sketch Trace');
      expect(text).toContain('Fade Image');
      expect(text).toContain('Delete Image After trace');
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

  it('disables alpha-mask tracing when the source image has no transparent pixels', async () => {
    const { host, root } = await renderTraceDialog(seedRaster());
    try {
      await waitForText(host, 'No transparent pixels detected');

      const alphaInput = checkboxByLabel(host, 'Trace alpha mask');
      expect(alphaInput).not.toBeNull();
      expect(alphaInput?.disabled).toBe(true);
      expect(host.textContent ?? '').toContain(
        'No transparent pixels detected; alpha mask will not change this image.',
      );
    } finally {
      await act(async () => root.unmount());
      host.remove();
      useUiStore.setState({ imageDialog: null });
    }
  });

  it('keeps alpha-mask tracing disabled until source transparency is known', async () => {
    vi.mocked(loadImageAsRawData).mockImplementationOnce(() => new Promise(() => undefined));

    const { host, root } = await renderTraceDialog(seedRaster());
    try {
      const alphaInput = checkboxByLabel(host, 'Trace alpha mask');
      expect(alphaInput).not.toBeNull();
      expect(alphaInput?.disabled).toBe(true);
      expect(host.textContent ?? '').toContain('Checking image transparency');
    } finally {
      await act(async () => root.unmount());
      host.remove();
      useUiStore.setState({ imageDialog: null });
    }
  });

  it('keeps alpha-mask tracing available for transparent source images', async () => {
    vi.mocked(loadImageAsRawData).mockResolvedValueOnce({
      width: 2,
      height: 2,
      data: new Uint8ClampedArray([
        255, 255, 255, 0, 0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255,
      ]),
    });

    const { host, root } = await renderTraceDialog(seedRaster());
    try {
      await waitForEnabledCheckbox(host, 'Trace alpha mask');

      const alphaInput = checkboxByLabel(host, 'Trace alpha mask');
      expect(alphaInput).not.toBeNull();
      expect(alphaInput?.disabled).toBe(false);
      expect(host.textContent ?? '').not.toContain('No transparent pixels detected');
    } finally {
      await act(async () => root.unmount());
      host.remove();
      useUiStore.setState({ imageDialog: null });
    }
  });

  it('shows simple Edge Detection controls when the edge preset is selected', async () => {
    const { host, root } = await renderTraceDialog(seedRaster());
    try {
      const select = host.querySelector('select[aria-label="Trace preset"]');
      expect(select).toBeInstanceOf(HTMLSelectElement);
      await act(async () => {
        (select as HTMLSelectElement).value = 'Edge Detection';
        select?.dispatchEvent(new Event('change', { bubbles: true }));
      });

      const text = host.textContent ?? '';
      expect(text).toContain('Sensitivity');
      expect(text).toContain('Detail');
      expect(text).toContain('Minimum line');
      expect(text).toContain('Creates outline contours from brightness changes.');
      expect(text).toContain('Use Centerline for one-stroke Line mode.');
      expect(text).not.toContain('Cutoff');
      expect(text).not.toContain('Threshold');
      expect(text).not.toContain('Sketch Trace');
    } finally {
      await act(async () => root.unmount());
      host.remove();
      useUiStore.setState({ imageDialog: null });
    }
  });

  it('warns that Edge Detection double-outlines filled text and offers Line Art first', async () => {
    const { host, root } = await renderTraceDialog(seedRaster());
    try {
      const select = host.querySelector('select[aria-label="Trace preset"]');
      expect(select).toBeInstanceOf(HTMLSelectElement);
      await act(async () => {
        (select as HTMLSelectElement).value = 'Edge Detection';
        select?.dispatchEvent(new Event('change', { bubbles: true }));
      });

      const text = host.textContent ?? '';
      expect(text).toContain('Edge Detection creates edge contours, not one-stroke lines.');
      expect(text).toContain('Line mode will outline those detected edges.');
      const buttons = Array.from(
        host.querySelectorAll<HTMLButtonElement>(
          'div[aria-label="Edge Detection guidance"] button',
        ),
      );
      expect(buttons.map((button) => button.textContent?.trim())).toEqual([
        'Use Line Art',
        'Use Centerline',
      ]);

      await act(async () => {
        buttons[0]?.click();
      });

      expect((select as HTMLSelectElement).value).toBe('Line Art');
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

async function waitForText(host: HTMLElement, text: string): Promise<void> {
  await waitFor(() => {
    expect(host.textContent ?? '').toContain(text);
  });
}

async function waitForEnabledCheckbox(host: HTMLElement, label: string): Promise<void> {
  await waitFor(() => {
    const input = checkboxByLabel(host, label);
    expect(input).not.toBeNull();
    expect(input?.disabled).toBe(false);
  });
}

async function waitFor(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch (err) {
      lastError = err;
    }
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });
  }
  throw lastError;
}

function checkboxByLabel(host: HTMLElement, label: string): HTMLInputElement | null {
  return (
    Array.from(host.querySelectorAll('label'))
      .find((row) => row.textContent?.includes(label))
      ?.querySelector('input[type="checkbox"]') ?? null
  );
}
