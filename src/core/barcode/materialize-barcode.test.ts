import { describe, expect, it, vi } from 'vitest';

import { decodeQrModules } from '../../__fixtures__/barcode/qr-decoder';
import { insideEvenOdd, sampleGrid } from '../../__fixtures__/barcode/sample-geometry';
import {
  addObject,
  createLayer,
  EMPTY_SCENE,
  hitTest,
  transformedBBox,
  type Bounds,
  type Polyline,
} from '../scene';
import type { BarcodeShape } from '../scene/scene-object';
import { defaultBarcodeSpec } from './barcode-spec';
import {
  createBarcodeObject,
  materializeBarcode,
  type BarcodeCaptionRenderer,
} from './materialize-barcode';

// Stands in for the font pipeline: each caption becomes a box whose ink
// starts at an arbitrary origin, as real text renders do.
const boxCaptions: BarcodeCaptionRenderer = async ({ text, sizeMm }) => {
  const width = text.length * sizeMm * 0.5;
  const height = sizeMm * 0.7;
  const points = [
    { x: 100, y: 50 },
    { x: 100 + width, y: 50 },
    { x: 100 + width, y: 50 + height },
    { x: 100, y: 50 + height },
    { x: 100, y: 50 },
  ];
  return {
    polylines: [{ points, closed: true }],
    bounds: { minX: 100, minY: 50, maxX: 100 + width, maxY: 50 + height },
  };
};

function inkBounds(polylines: readonly Polyline[]): Bounds {
  const points = polylines.flatMap((polyline) => polyline.points);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

describe('materializeBarcode', () => {
  it('keeps matrix codes in one even-odd path with paired curves and never asks for text', async () => {
    const render = vi.fn(boxCaptions);
    const result = await materializeBarcode(
      defaultBarcodeSpec('qr'),
      'KerfDesk',
      '#000000',
      render,
    );
    expect(render).not.toHaveBeenCalled();
    if (!result.ok) throw new Error(result.message);
    const [path] = result.barcode.paths;
    expect(result.barcode.paths).toHaveLength(1);
    expect(path?.fillRule).toBe('evenodd');
    expect(path?.curves).toHaveLength(path?.polylines.length ?? -1);
    const { layout } = result.barcode;
    expect(result.barcode.bounds).toEqual({
      minX: 0,
      minY: 0,
      maxX: layout.widthMm,
      maxY: layout.heightMm,
    });
    const size = Math.round(layout.widthMm / layout.moduleMm) - 8;
    const origin = { x: 4 * layout.moduleMm, y: 4 * layout.moduleMm };
    const grid = sampleGrid(path?.polylines ?? [], size, size, layout.moduleMm, origin);
    expect(decodeQrModules(grid, size)).toMatchObject({ ok: true, text: 'KerfDesk' });
  });

  it('centres each caption under its span, top at the text line', async () => {
    const spec: BarcodeShape = { ...defaultBarcodeSpec('ean13'), moduleMm: 0.33 };
    const result = await materializeBarcode(spec, '5901234123457', '#000000', boxCaptions);
    if (!result.ok) throw new Error(result.message);
    const { layout, paths } = result.barcode;
    const polylines = paths[0]?.polylines ?? [];
    const glyphs = polylines.slice(layout.marks.length);
    expect(glyphs).toHaveLength(3);
    layout.captions.forEach((caption, index) => {
      const xs = glyphs[index]?.points.map((point) => point.x) ?? [];
      const ys = glyphs[index]?.points.map((point) => point.y) ?? [];
      expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(caption.centerXMm, 9);
      expect(Math.min(...ys)).toBeCloseTo(caption.topMm, 9);
    });
  });

  it('knocks captions out of an inverted plate and deepens the box to fit them', async () => {
    const tallText: BarcodeCaptionRenderer = async (caption) => {
      const rendered = await boxCaptions(caption);
      const points =
        rendered.polylines[0]?.points.map((point) => ({
          x: point.x,
          y: point.y === 50 ? 50 : 80,
        })) ?? [];
      return { polylines: [{ points, closed: true }], bounds: { ...rendered.bounds, maxY: 80 } };
    };
    const spec: BarcodeShape = { ...defaultBarcodeSpec('code128'), invert: true, moduleMm: 0.3 };
    const result = await materializeBarcode(spec, 'ABC', '#000000', tallText);
    if (!result.ok) throw new Error(result.message);
    const { layout, bounds, paths } = result.barcode;
    const polylines = paths[0]?.polylines ?? [];
    const caption = layout.captions[0];
    expect(bounds.maxY).toBeCloseTo((caption?.topMm ?? 0) + 30 + layout.paddingMm, 9);
    expect(polylines[0]?.points).toContainEqual({ x: layout.widthMm, y: bounds.maxY });
    // Inside the glyph box: plate and glyph cancel, so it stays unengraved.
    expect(
      insideEvenOdd(polylines, { x: caption?.centerXMm ?? 0, y: (caption?.topMm ?? 0) + 1 }),
    ).toBe(false);
    expect(insideEvenOdd(polylines, { x: 0.1, y: bounds.maxY - 0.1 })).toBe(true);
  });

  // EAN-13 sets its first digit in the quiet zone, left of the start guard;
  // below the standard quiet zone that digit reaches past the code's box.
  it('widens the bounds to hold every caption, with the padding kept under the text', async () => {
    const spec: BarcodeShape = { ...defaultBarcodeSpec('ean13'), quietZoneModules: 3 };
    const result = await materializeBarcode(spec, '5901234123457', '#000000', boxCaptions);
    if (!result.ok) throw new Error(result.message);
    const { layout, bounds, paths } = result.barcode;
    const ink = inkBounds((paths[0]?.polylines ?? []).slice(layout.marks.length));
    expect(ink.minX).toBeLessThan(0);
    expect(bounds.minX).toBeCloseTo(ink.minX - layout.paddingMm, 9);
    expect(bounds.maxX).toBe(layout.widthMm);
    expect(bounds.maxY).toBeGreaterThanOrEqual(ink.maxY + layout.paddingMm);
  });

  it('selects the code from a click on a digit past the quiet zone', async () => {
    const spec: BarcodeShape = { ...defaultBarcodeSpec('ean13'), quietZoneModules: 0 };
    const created = await createBarcodeObject({
      id: 'ean',
      color: '#000000',
      spec,
      value: '5901234123457',
      renderCaption: boxCaptions,
    });
    if (!created.ok) throw new Error(created.message);
    const polylines = created.object.paths[0]?.polylines ?? [];
    const digit = inkBounds(polylines.filter((polyline) => polyline.points.some((p) => p.x < 0)));
    const layer = createLayer({ id: 'fill', color: '#000000', mode: 'fill' });
    const scene = addObject({ ...EMPTY_SCENE, layers: [layer] }, created.object);
    const point = { x: digit.minX + 0.05, y: (digit.minY + digit.maxY) / 2 };
    expect(hitTest(scene, point)).toBe('ean');
    expect(transformedBBox(created.object).minX).toBeLessThanOrEqual(digit.minX);
  });

  it('keeps a caption past the quiet zone knocked out of an inverted plate', async () => {
    const spec: BarcodeShape = { ...defaultBarcodeSpec('upca'), quietZoneModules: 3, invert: true };
    const result = await materializeBarcode(spec, '036000291452', '#000000', boxCaptions);
    if (!result.ok) throw new Error(result.message);
    const { layout, bounds, paths } = result.barcode;
    const polylines = paths[0]?.polylines ?? [];
    // UPC-A's last digit sits right of the stop guard.
    const last = inkBounds(polylines.slice(-1));
    expect(last.maxX).toBeGreaterThan(layout.widthMm);
    // The digit stays a hole in the plate rather than an engraved mark.
    const middle = { x: (last.minX + last.maxX) / 2, y: (last.minY + last.maxY) / 2 };
    expect(insideEvenOdd(polylines, middle)).toBe(false);
    expect(bounds.maxX).toBeCloseTo(last.maxX + layout.paddingMm, 9);
    expect(insideEvenOdd(polylines, { x: bounds.maxX - 0.01, y: middle.y })).toBe(true);
  });

  it('reports caption failures and invalid data without geometry', async () => {
    const failing: BarcodeCaptionRenderer = async () => {
      throw new Error('font missing');
    };
    const failed = await materializeBarcode(
      defaultBarcodeSpec('code39'),
      'ABC',
      '#000000',
      failing,
    );
    expect(failed).toEqual({
      ok: false,
      message: 'The barcode text could not be drawn: font missing',
    });
    const invalid = await materializeBarcode(
      defaultBarcodeSpec('upca'),
      '12345',
      '#000000',
      boxCaptions,
    );
    expect(invalid.ok).toBe(false);
  });
});

describe('createBarcodeObject', () => {
  it('builds a shape object whose spec, bounds and paths agree', async () => {
    const spec = defaultBarcodeSpec('data-matrix');
    const created = await createBarcodeObject({
      id: 'b1',
      color: '#112233',
      spec,
      value: spec.data,
      renderCaption: boxCaptions,
    });
    if (!created.ok) throw new Error(created.message);
    expect(created.object).toMatchObject({ kind: 'shape', id: 'b1', color: '#112233', spec });
    expect(created.object.paths[0]?.color).toBe('#112233');
    expect(created.object.bounds.maxX).toBeGreaterThan(0);
  });

  // Insert and Apply build through here: they stop at 132 x 132 (ADR-386
  // Amendment 2), while output builds 144 x 144 with a Job Review warning.
  it('refuses a Data Matrix value that needs 144 x 144, as Insert and Edit do', async () => {
    const spec = { ...defaultBarcodeSpec('data-matrix'), data: 'Z'.repeat(1305) };
    const created = await createBarcodeObject({
      id: 'b1',
      color: '#000000',
      spec,
      value: spec.data,
      renderCaption: boxCaptions,
    });
    expect(created).toEqual({
      ok: false,
      message:
        'Too much data for a Data Matrix: this text needs 1305 codewords and the largest size ' +
        'KerfDesk makes, 132 × 132, holds 1304. Shorten the text or use a QR Code.',
    });
  });
});
