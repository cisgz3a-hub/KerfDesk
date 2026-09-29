import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { readEan } from '../../__fixtures__/barcode/linear-decoders';
import { decodeQrModules } from '../../__fixtures__/barcode/qr-decoder';
import { insideEvenOdd } from '../../__fixtures__/barcode/sample-geometry';
import {
  defaultBarcodeSpec,
  layoutBarcode,
  type BarcodeLayout,
  type BarcodeShape,
} from '../../core/barcode';
import type { Polyline, Vec2 } from '../../core/scene';
import { BarcodePreviewSvg } from './BarcodePreviewSvg';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

function laid(spec: BarcodeShape): BarcodeLayout {
  const result = layoutBarcode(spec, spec.data);
  if (!result.ok) throw new Error(result.message);
  return result.layout;
}

async function preview(layout: BarcodeLayout): Promise<SVGSVGElement> {
  const host = document.createElement('div');
  root = createRoot(host);
  await act(async () => root?.render(<BarcodePreviewSvg layout={layout} stale={false} />));
  const svg = host.querySelector('svg');
  if (svg === null) throw new Error('no preview drawn');
  return svg;
}

function outlines(d: string): Polyline[] {
  return d
    .split('M')
    .filter((part) => part !== '')
    .map((part) => {
      const numbers = part.replace('Z', '').split(/[L ]/).map(Number);
      const points: Vec2[] = [];
      for (let index = 0; index + 1 < numbers.length; index += 2) {
        points.push({ x: numbers[index] ?? 0, y: numbers[index + 1] ?? 0 });
      }
      return { points, closed: true };
    });
}

function isDark(colour: string | null): boolean {
  const value = (colour ?? '').replace(/\s/g, '').toLowerCase();
  if (value === '#000000' || value === 'rgb(0,0,0)') return true;
  if (value === '#ffffff' || value === 'rgb(255,255,255)') return false;
  throw new Error(`unexpected colour ${colour}`);
}

/** Whether the preview shows a point dark: the outlines' fill inside them, the paper outside. */
function shownDark(svg: SVGSVGElement, point: Vec2): boolean {
  const path = svg.querySelector('path');
  const inside = insideEvenOdd(outlines(path?.getAttribute('d') ?? ''), point);
  return isDark(inside ? (path?.getAttribute('fill') ?? null) : svg.style.backgroundColor);
}

// Invert engraves the light modules for stock that marks lighter than its
// surface, so on the finished piece the code still reads dark on light.
describe('the barcode dialog preview shows the code as it reads on the stock', () => {
  it.each([false, true])(
    'QR Code, invert %s: dark modules dark on a light quiet zone',
    async (invert) => {
      const spec: BarcodeShape = { ...defaultBarcodeSpec('qr'), data: 'KERF-0001', invert };
      const layout = laid(spec);
      const svg = await preview(layout);
      const { moduleMm } = layout;
      const quiet = spec.quietZoneModules;
      const size = Math.round(layout.widthMm / moduleMm) - 2 * quiet;
      const grid = new Uint8Array(size * size);
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const centre = { x: (quiet + x + 0.5) * moduleMm, y: (quiet + y + 0.5) * moduleMm };
          grid[y * size + x] = shownDark(svg, centre) ? 1 : 0;
        }
      }
      expect(decodeQrModules(grid, size)).toMatchObject({ ok: true, text: 'KERF-0001' });
      expect(shownDark(svg, { x: moduleMm / 2, y: moduleMm / 2 })).toBe(false);
    },
  );

  it.each([false, true])('EAN-13, invert %s: dark bars and digits on light', async (invert) => {
    const spec: BarcodeShape = { ...defaultBarcodeSpec('ean13'), invert };
    const layout = laid(spec);
    const svg = await preview(layout);
    const { moduleMm } = layout;
    const barMiddle = layout.paddingMm + spec.barHeightMm / 2;
    let modules = '';
    for (let index = 0; index < 95; index += 1) {
      const x = (spec.quietZoneModules + index + 0.5) * moduleMm;
      modules += shownDark(svg, { x, y: barMiddle }) ? '1' : '0';
    }
    expect(readEan(modules)).toBe('5901234123457');
    expect(shownDark(svg, { x: moduleMm / 2, y: barMiddle })).toBe(false);
    const digits = [...svg.querySelectorAll('text')];
    expect(digits.map((text) => text.textContent).join('')).toBe('5901234123457');
    expect(digits.every((text) => isDark(text.getAttribute('fill')))).toBe(true);
  });
});
