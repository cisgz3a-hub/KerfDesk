import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

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
    width: 2,
    height: 2,
  })),
}));

import { DEFAULT_CNC_MACHINE_CONFIG, IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { loadImageAsRawData } from './image-loader';
import { ImportImageDialog } from './ImportImageDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function seedRaster(): RasterImage {
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
  };
}

describe('Trace Image workflow controls', () => {
  it('defaults laser traces to editable vectors with the raster scan escape', async () => {
    await withTraceDialog(async (host) => {
      const output = outputSelect(host);
      expect(output?.value).toBe('vector');
      expect(Array.from(output?.options ?? []).map((option) => option.textContent)).toEqual([
        'Editable vectors',
        'Raster scan',
      ]);
      expect(host.textContent ?? '').toContain(
        'Raster scan uses the same Raster/Image scan motion as a photo.',
      );
      expect(host.textContent ?? '').toContain(
        'The trace is binary artwork, not a grayscale photo',
      );
    });
  });

  it('offers all five trace presets including the rebuilt Edge Detection', async () => {
    await withTraceDialog(async (host) => {
      const select = presetSelect(host);
      const values = Array.from(select.options).map((option) => option.value);
      expect(values).toContain('Line Art');
      expect(values).toContain('Smooth');
      expect(values).toContain('Sharp');
      expect(values).toContain('Centerline');
      // Re-exposed with the chained single-line backend (it was hidden while
      // the outline backend doubled every edge).
      expect(values).toContain('Edge Detection');
    });
  });

  it('shows Fill Style only for filled-contour presets', async () => {
    await withTraceDialog(async (host) => {
      // The vector default (ADR-237) shows Fill Style immediately for the
      // filled-contour Line Art preset; the raster escape hides it.
      expect(fillStyleSelect(host)).toBeInstanceOf(HTMLSelectElement);
      await changeSelect(outputSelect(host), 'raster');
      expect(fillStyleSelect(host)).toBeNull();
      await changeSelect(outputSelect(host), 'vector');
      const select = presetSelect(host);
      expect(fillStyleSelect(host)?.value).toBe('scanline');
      expect(
        Array.from(fillStyleSelect(host)?.options ?? []).map((option) => option.textContent),
      ).toEqual(['Scanline', 'Follow Shape', 'Island Fill']);
      expect(host.textContent ?? '').toContain(
        'Follow Shape is best for closed logos, wreaths, and hollow designs.',
      );
      expect(host.textContent ?? '').toContain(
        'Island Fill burns connected regions with short straight scanlines.',
      );

      for (const preset of ['Smooth', 'Sharp']) {
        await changePreset(select, preset);
        expect(fillStyleSelect(host)).toBeInstanceOf(HTMLSelectElement);
      }
      for (const preset of ['Centerline']) {
        await changePreset(select, preset);
        expect(fillStyleSelect(host)).toBeNull();
      }
    });
  });

  it('keeps CNC tracing vector-only', async () => {
    const prior = useStore.getState().project;
    useStore.setState({ project: { ...prior, machine: DEFAULT_CNC_MACHINE_CONFIG } });
    try {
      await withTraceDialog(async (host) => {
        expect(outputSelect(host)).toBeNull();
        expect(fillStyleSelect(host)).toBeInstanceOf(HTMLSelectElement);
        expect(host.textContent ?? '').toContain('Cutting on CNC');
        expect(host.textContent ?? '').not.toContain(
          'Raster scan uses the same Raster/Image scan motion',
        );
      });
    } finally {
      useStore.setState({ project: prior });
    }
  });

  it('shows vector trace settings without image-adjustment controls', async () => {
    await withTraceDialog(async (host) => {
      const text = host.textContent ?? '';
      for (const label of [
        'Trace settings',
        'Cutoff',
        'Threshold',
        'Ignore Less Than',
        'Smoothness',
        'Optimize',
        'Trace alpha mask',
        'Line Art automatically preserves pale logo details.',
        'Fade Image',
        'Delete Image After trace',
      ]) {
        expect(text).toContain(label);
      }
      for (const label of [
        'Force Sketch Trace',
        'Image adjustments',
        'Brightness',
        'Contrast',
        'Gamma',
        'Invert',
      ]) {
        expect(text).not.toContain(label);
      }
    });
  });

  it('disables alpha-mask tracing when the source image has no transparent pixels', async () => {
    await withTraceDialog(async (host) => {
      await waitForText(host, 'No transparent pixels detected');

      const alphaInput = checkboxByLabel(host, 'Trace alpha mask');
      expect(alphaInput).not.toBeNull();
      expect(alphaInput?.disabled).toBe(true);
      expect(host.textContent ?? '').toContain(
        'No transparent pixels detected; alpha mask will not change this image.',
      );
    });
  });

  it('keeps alpha-mask tracing disabled until source transparency is known', async () => {
    vi.mocked(loadImageAsRawData).mockImplementationOnce(() => new Promise(() => undefined));

    await withTraceDialog(async (host) => {
      const alphaInput = checkboxByLabel(host, 'Trace alpha mask');
      expect(alphaInput).not.toBeNull();
      expect(alphaInput?.disabled).toBe(true);
      expect(host.textContent ?? '').toContain('Checking image transparency');
    });
  });

  it('keeps alpha-mask tracing available for transparent source images', async () => {
    vi.mocked(loadImageAsRawData).mockResolvedValueOnce({
      width: 2,
      height: 2,
      data: new Uint8ClampedArray([
        255, 255, 255, 0, 0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255,
      ]),
    });

    await withTraceDialog(async (host) => {
      await waitForEnabledCheckbox(host, 'Trace alpha mask');

      const alphaInput = checkboxByLabel(host, 'Trace alpha mask');
      expect(alphaInput).not.toBeNull();
      expect(alphaInput?.disabled).toBe(false);
      expect(host.textContent ?? '').not.toContain('No transparent pixels detected');
    });
  });

  it('shows the edge-specific controls when Edge Detection is selected', async () => {
    await withTraceDialog(async (host) => {
      const select = presetSelect(host);
      await changePreset(select, 'Edge Detection');
      const text = host.textContent ?? '';
      expect(text).toContain('Sensitivity');
    });
  });

  it('does not show contour-only Smoothness and Optimize controls for Centerline', async () => {
    await withTraceDialog(async (host) => {
      await changePreset(presetSelect(host), 'Centerline');
      const text = host.textContent ?? '';
      expect(text).toContain('Threshold');
      expect(text).toContain('Ignore Less Than');
      expect(text).not.toContain('Smoothness');
      expect(text).not.toContain('Optimize');
    });
  });

  it('reveals the boundary-mode toggle only after a region is boxed', async () => {
    await withTraceDialog(async (host) => {
      // No boundary yet → the crop/enhance toggle is hidden.
      expect(boundaryModeSelect(host)).toBeNull();

      const frame = host.querySelector('[aria-label="Trace preview"]') as HTMLDivElement | null;
      expect(frame).not.toBeNull();
      stubRect(frame!, { left: 0, top: 0, width: 100, height: 80 });
      await act(async () => {
        frame?.dispatchEvent(
          new MouseEvent('mousedown', { clientX: 10, clientY: 10, bubbles: true }),
        );
        frame?.dispatchEvent(
          new MouseEvent('mousemove', { clientX: 60, clientY: 50, bubbles: true }),
        );
        frame?.dispatchEvent(
          new MouseEvent('mouseup', { clientX: 60, clientY: 50, bubbles: true }),
        );
      });

      // A region now exists → the toggle appears, defaulting to Crop.
      const modeSelect = boundaryModeSelect(host);
      expect(modeSelect).toBeInstanceOf(HTMLSelectElement);
      expect(modeSelect?.value).toBe('crop');
      expect(Array.from(modeSelect?.options ?? []).map((o) => o.value)).toEqual([
        'crop',
        'enhance',
      ]);
    });
  });
});

function boundaryModeSelect(host: HTMLElement): HTMLSelectElement | null {
  return host.querySelector('select[aria-label="Trace boundary mode"]');
}

function stubRect(
  element: HTMLElement,
  rect: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  },
): void {
  element.getBoundingClientRect = () =>
    ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => undefined,
    }) as DOMRect;
}

async function withTraceDialog(run: (host: HTMLElement) => Promise<void>): Promise<void> {
  const { host, root } = await renderTraceDialog();
  try {
    await run(host);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    useUiStore.setState({ imageDialog: null });
  }
}

async function renderTraceDialog(): Promise<{
  readonly host: HTMLDivElement;
  readonly root: Root;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  useUiStore.setState({ imageDialog: { source: seedRaster() } });
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(createElement(ImportImageDialog));
  });
  if (root === null) throw new Error('root did not mount');
  return { host, root };
}

function presetSelect(host: HTMLElement): HTMLSelectElement {
  const select = host.querySelector('select[aria-label="Trace preset"]');
  expect(select).toBeInstanceOf(HTMLSelectElement);
  return select as HTMLSelectElement;
}

function fillStyleSelect(host: HTMLElement): HTMLSelectElement | null {
  return host.querySelector('select[aria-label="Trace fill style"]');
}

function outputSelect(host: HTMLElement): HTMLSelectElement | null {
  return host.querySelector('select[aria-label="Trace output"]');
}

async function changePreset(select: HTMLSelectElement, value: string): Promise<void> {
  await changeSelect(select, value);
}

async function changeSelect(select: HTMLSelectElement | null, value: string): Promise<void> {
  expect(select).toBeInstanceOf(HTMLSelectElement);
  await act(async () => {
    if (select === null) return;
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
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
