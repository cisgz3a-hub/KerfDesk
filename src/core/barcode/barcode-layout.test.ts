import { describe, expect, it } from 'vitest';

import { decodeDataMatrixModules } from '../../__fixtures__/barcode/data-matrix-decoder';
import { readCode128, readCode39, readEan } from '../../__fixtures__/barcode/linear-decoders';
import { decodeQrModules } from '../../__fixtures__/barcode/qr-decoder';
import {
  insideEvenOdd,
  sampleGrid,
  sampleScanLine,
} from '../../__fixtures__/barcode/sample-geometry';
import type { BarcodeShape } from '../scene/scene-object';
import { layoutBarcode, layoutPolylines, type BarcodeLayout } from './barcode-layout';
import { defaultBarcodeSpec } from './barcode-spec';
import { moduleContours } from './module-contours';

function laid(spec: BarcodeShape, data = spec.data): BarcodeLayout {
  const result = layoutBarcode(spec, data);
  if (!result.ok) throw new Error(result.message);
  return result.layout;
}

function onLattice(layout: BarcodeLayout, moduleMm: number): boolean {
  return layoutPolylines(layout).every((polyline) =>
    polyline.points.every(
      (point) =>
        Math.abs(point.x / moduleMm - Math.round(point.x / moduleMm)) < 1e-9 &&
        Math.abs(point.y / moduleMm - Math.round(point.y / moduleMm)) < 1e-9,
    ),
  );
}

describe('moduleContours', () => {
  it('merges touching modules and keeps enclosed light modules as holes', () => {
    // A 3x3 ring: one outer outline and one hole, four corners each.
    const loops = moduleContours(3, 3, [1, 1, 1, 1, 0, 1, 1, 1, 1]);
    expect(loops).toHaveLength(2);
    for (const loop of loops) expect(loop).toHaveLength(5);
  });

  it('keeps diagonal neighbours as separate outlines', () => {
    expect(moduleContours(2, 2, [1, 0, 0, 1])).toHaveLength(2);
  });
});

describe('matrix code layout', () => {
  const url = 'https://kerfdesk.example/p/000123';

  it('scans the QR Code outlines back and keeps an exact quiet zone', () => {
    const spec: BarcodeShape = {
      ...defaultBarcodeSpec('qr'),
      moduleMm: 0.5,
      quietZoneModules: 4,
      data: url,
    };
    const layout = laid(spec);
    const size = layout.widthMm / 0.5 - 8;
    const polylines = layoutPolylines(layout);
    const grid = sampleGrid(polylines, size, size, 0.5, { x: 2, y: 2 });
    expect(decodeQrModules(grid, size)).toMatchObject({ ok: true, text: url });
    const quiet = sampleGrid(polylines, size + 8, 4, 0.5, { x: 0, y: 0 });
    expect(quiet.every((module) => module === 0)).toBe(true);
    expect(layout.heightMm).toBe(layout.widthMm);
    expect(onLattice(layout, 0.5)).toBe(true);
  });

  it('merges modules into far fewer outlines than dark modules', () => {
    const layout = laid({ ...defaultBarcodeSpec('qr'), data: url });
    const size = Math.round(layout.widthMm / layout.moduleMm) - 8;
    const grid = sampleGrid(layoutPolylines(layout), size, size, layout.moduleMm, {
      x: 4 * layout.moduleMm,
      y: 4 * layout.moduleMm,
    });
    const dark = grid.reduce((sum, module) => sum + module, 0);
    expect(layout.marks.length).toBeLessThan(dark / 3);
  });

  it('inverts by engraving the light modules and the quiet zone', () => {
    const spec: BarcodeShape = {
      ...defaultBarcodeSpec('qr'),
      invert: true,
      moduleMm: 1,
      data: url,
    };
    const layout = laid(spec);
    const polylines = layoutPolylines(layout);
    expect(insideEvenOdd(polylines, { x: 0.5, y: 0.5 })).toBe(true);
    const size = layout.widthMm - 8;
    const grid = sampleGrid(polylines, size, size, 1, { x: 4, y: 4 });
    const restored = grid.map((module) => 1 - module);
    expect(decodeQrModules(restored, size)).toMatchObject({ ok: true, text: url });
    expect(onLattice(layout, 1)).toBe(true);
  });

  it('sizes by overall width, quiet zone included, with equal modules', () => {
    const spec: BarcodeShape = {
      ...defaultBarcodeSpec('qr'),
      sizeMode: 'width',
      widthMm: 30,
      data: url,
    };
    const layout = laid(spec);
    expect(layout.widthMm).toBeCloseTo(30, 9);
    expect(layout.moduleMm * Math.round(30 / layout.moduleMm)).toBeCloseTo(30, 9);
    expect(layout.description).toMatch(
      /^QR Code version \d+ \(\d+ × \d+ modules\), error correction M$/,
    );
  });

  it('scans the Data Matrix outlines back', () => {
    const spec: BarcodeShape = {
      ...defaultBarcodeSpec('data-matrix'),
      moduleMm: 0.5,
      data: 'LOT-2026-0924',
    };
    const layout = laid(spec);
    const size = layout.widthMm / 0.5 - 4;
    const grid = sampleGrid(layoutPolylines(layout), size, size, 0.5, { x: 1, y: 1 });
    expect(decodeDataMatrixModules(grid, size)).toMatchObject({ ok: true, text: 'LOT-2026-0924' });
  });

  it('warns below the standard quiet zone and refuses modules too small to draw', () => {
    const tight = layoutBarcode({ ...defaultBarcodeSpec('qr'), quietZoneModules: 2 }, 'A');
    expect(tight.ok && tight.layout.warnings.join(' ')).toContain('below the standard 4 modules');
    const tiny = layoutBarcode({ ...defaultBarcodeSpec('qr'), sizeMode: 'width', widthMm: 1 }, url);
    expect(tiny.ok).toBe(false);
  });
});

describe('1D code layout', () => {
  it('draws one rectangle per bar and scans back (Code 128 and Code 39)', () => {
    for (const [symbology, read] of [
      ['code128', readCode128],
      ['code39', readCode39],
    ] as const) {
      const spec: BarcodeShape = {
        ...defaultBarcodeSpec(symbology),
        moduleMm: 0.25,
        data: 'KERF-42',
      };
      const layout = laid(spec);
      const quiet = spec.quietZoneModules;
      const modules = Math.round(layout.widthMm / 0.25) - 2 * quiet;
      const line = sampleScanLine(
        layoutPolylines(layout),
        modules,
        0.25,
        quiet * 0.25,
        0.5 + spec.barHeightMm / 2,
      );
      expect(read(line)).toBe('KERF-42');
      expect(layout.marks.length).toBe(line.split(/0+/).filter((bar) => bar !== '').length);
      expect(
        onLattice(
          {
            ...layout,
            marks: layout.marks.map((mark) => ({
              ...mark,
              points: mark.points.map((p) => ({ x: p.x, y: 0 })),
            })),
          },
          0.25,
        ),
      ).toBe(true);
    }
  });

  it('extends EAN-13 guard bars and places the digits under their halves', () => {
    const spec: BarcodeShape = { ...defaultBarcodeSpec('ean13'), moduleMm: 0.33 };
    const layout = laid(spec, '5901234123457');
    const padding = 2 * 0.33;
    const heights = layout.marks.map((mark) => Math.max(...mark.points.map((p) => p.y)));
    const tall = heights.filter((height) => height > padding + spec.barHeightMm + 1e-9);
    expect(tall).toHaveLength(6);
    expect(layout.captions.map((caption) => caption.text)).toEqual(['5', '901234', '123457']);
    const first = layout.captions[0];
    expect(first?.centerXMm).toBeLessThan(11 * 0.33);
    const line = sampleScanLine(layoutPolylines(layout), 95, 0.33, 11 * 0.33, padding + 1);
    expect(readEan(line)).toBe('5901234123457');
  });

  it('inverts a 1D code inside a background box and keeps text below the bars', () => {
    const spec: BarcodeShape = {
      ...defaultBarcodeSpec('code128'),
      invert: true,
      moduleMm: 0.3,
      data: 'ABC-123',
    };
    const layout = laid(spec);
    const polylines = layoutPolylines(layout);
    expect(polylines[0]?.points).toContainEqual({ x: layout.widthMm, y: layout.heightMm });
    const modules = Math.round(layout.widthMm / 0.3) - 20;
    const line = sampleScanLine(polylines, modules, 0.3, 3, 0.6 + 1);
    expect(readCode128(Array.from(line, (bit) => (bit === '1' ? '0' : '1')).join(''))).toBe(
      'ABC-123',
    );
    const caption = layout.captions[0];
    expect(caption?.topMm).toBeGreaterThan(0.6 + spec.barHeightMm);
    expect(layout.heightMm).toBeGreaterThan((caption?.topMm ?? 0) + (caption?.sizeMm ?? 0) * 0.9);
  });

  it('drops captions and guard extensions when text is off', () => {
    const layout = laid({ ...defaultBarcodeSpec('upca'), showText: false }, '036000291452');
    expect(layout.captions).toEqual([]);
    const bottoms = new Set(layout.marks.map((mark) => Math.max(...mark.points.map((p) => p.y))));
    expect(bottoms.size).toBe(1);
  });

  it('reports invalid data instead of drawing a code', () => {
    const result = layoutBarcode(defaultBarcodeSpec('ean13'), '5901234123458');
    expect(result).toMatchObject({ ok: false });
    expect(layoutBarcode(defaultBarcodeSpec('qr'), '')).toMatchObject({
      ok: false,
      message: 'Enter the data to encode.',
    });
  });
});
