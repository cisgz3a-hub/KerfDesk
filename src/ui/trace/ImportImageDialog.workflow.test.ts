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
  })),
}));

import { IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
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
  it('labels Edge Detection as an edge-contour preset', async () => {
    await withTraceDialog(async (host) => {
      const select = presetSelect(host);
      const edgeOption = Array.from(select.options).find(
        (option) => option.value === 'Edge Detection',
      );
      expect(edgeOption?.textContent).toBe('Edge Detection (edge contours)');
    });
  });

  it('shows Fill Style only for filled-contour presets', async () => {
    await withTraceDialog(async (host) => {
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
      for (const preset of ['Centerline', 'Edge Detection']) {
        await changePreset(select, preset);
        expect(fillStyleSelect(host)).toBeNull();
      }
    });
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

  it('shows simple Edge Detection controls when the edge preset is selected', async () => {
    await withTraceDialog(async (host) => {
      await changePreset(presetSelect(host), 'Edge Detection');

      const text = host.textContent ?? '';
      for (const label of [
        'Sensitivity',
        'Detail',
        'Minimum line',
        'Creates outline contours from brightness changes.',
        'Use Centerline for one-stroke Line mode.',
      ]) {
        expect(text).toContain(label);
      }
      expect(text).not.toContain('Cutoff');
      expect(text).not.toContain('Threshold');
      expect(text).not.toContain('Sketch Trace');
    });
  });

  it('warns that Edge Detection double-outlines filled text and offers Line Art first', async () => {
    await withTraceDialog(async (host) => {
      const select = presetSelect(host);
      await changePreset(select, 'Edge Detection');

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

      expect(select.value).toBe('Line Art');
    });
  });
});

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

async function changePreset(select: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
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
