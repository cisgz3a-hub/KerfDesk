// Switching trace styles keeps the operator's choices honest (ADR-560): a
// crop-only style does not overwrite Enhance region, "Settings edited" follows
// the adjustments the selected style uses, and the kept ones it ignores are
// named.

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

import { IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import { TRACE_PRESETS } from '../../core/trace';
import { useUiStore } from '../state/ui-store';
import { ImportImageDialog } from './ImportImageDialog';
import { edgeSensitivityFromOptions } from './trace-options';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('Trace dialog style switches', () => {
  it('returns to Enhance region after a visit to a crop-only style', async () => {
    await withTraceDialog(async (host) => {
      await drawBoundary(host);
      await changeSelect(select(host, 'Trace boundary mode'), 'enhance');
      await changeSelect(select(host, 'Trace preset'), 'Photo shading');
      expect(select(host, 'Trace boundary mode')?.value).toBe('crop');
      expect(host.textContent).toContain('Photo shading traces only the boxed region.');
      await changeSelect(select(host, 'Trace preset'), 'Colour layers');
      expect(select(host, 'Trace boundary mode')?.value).toBe('crop');
      expect(host.textContent).toContain('Colour layers trace only the boxed region.');
      await changeSelect(select(host, 'Trace preset'), 'Line Art');
      expect(select(host, 'Trace boundary mode')?.value).toBe('enhance');
    });
  });

  it('marks edits that change the trace and names kept ones the style ignores', async () => {
    await withTraceDialog(async (host) => {
      const text = (): string => host.textContent ?? '';
      await changeSelect(select(host, 'Trace detection'), 'faint-lines');
      expect(text()).toContain('Settings edited');
      await changeSelect(select(host, 'Trace detection'), 'preset');
      expect(text()).not.toContain('Settings edited');
      await changeSelect(select(host, 'Trace preset'), 'Edge Detection');
      const edge = TRACE_PRESETS['Edge Detection'];
      const sensitivity = edge !== undefined && edgeSensitivityFromOptions(edge) === 0 ? 100 : 0;
      await typeNumber(host, 'Trace Sensitivity', sensitivity);
      expect(text()).toContain('Settings edited');
      await changeSelect(select(host, 'Trace preset'), 'Line Art');
      expect(text()).not.toContain('Settings edited');
      expect(text()).toContain('Kept but not used here: Sensitivity.');
    });
  });

  it('says what Smooth does differently from Line Art', async () => {
    await withTraceDialog(async (host) => {
      await changeSelect(select(host, 'Trace preset'), 'Smooth');
      expect(host.textContent).toContain(
        'Sets its threshold from the image and removes isolated noise dots when the image has many of them.',
      );
    });
  });
});

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

async function withTraceDialog(run: (host: HTMLElement) => Promise<void>): Promise<void> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  useUiStore.getState().openImageDialog(seedRaster());
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(createElement(ImportImageDialog));
  });
  try {
    await run(host);
  } finally {
    await act(async () => root?.unmount());
    host.remove();
    useUiStore.setState({ imageDialog: null });
  }
}

function select(host: HTMLElement, label: string): HTMLSelectElement | null {
  return host.querySelector(`select[aria-label="${label}"]`);
}

async function changeSelect(element: HTMLSelectElement | null, value: string): Promise<void> {
  expect(element).toBeInstanceOf(HTMLSelectElement);
  await act(async () => {
    if (element === null) return;
    element.value = value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function typeNumber(host: HTMLElement, label: string, value: number): Promise<void> {
  const input = host.querySelector(`input[type="number"][aria-label="${label}"]`);
  expect(input).toBeInstanceOf(HTMLInputElement);
  await act(async () => {
    if (!(input instanceof HTMLInputElement)) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
      input,
      String(value),
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

// Drag a box over the preview, as the operator does.
async function drawBoundary(host: HTMLElement): Promise<void> {
  const frame = host.querySelector<HTMLDivElement>('[aria-label="Trace preview"]');
  expect(frame).toBeInstanceOf(HTMLDivElement);
  if (frame === null) return;
  frame.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 100, height: 80, right: 100, bottom: 80, x: 0, y: 0 }) as DOMRect;
  await act(async () => {
    for (const [type, x, y] of [
      ['mousedown', 10, 10],
      ['mousemove', 60, 50],
      ['mouseup', 60, 50],
    ] as const) {
      frame.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
    }
  });
}
