import { describe, expect, it } from 'vitest';

import { decodeQrModules } from '../../__fixtures__/barcode/qr-decoder';
import {
  defaultBarcodeSpec,
  materializeBarcode,
  type BarcodeShape,
  type BarcodeSymbology,
} from '../../core/barcode';
import { fillHatching } from '../../core/job/fill-hatching';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Layer,
  type Project,
  type ShapeObject,
  type Transform,
} from '../../core/scene';
import { detectBarcodeLineIntervalWarnings } from './barcode-line-interval-warnings';
import { detectMachineJobWarnings } from './machine-job-warnings';

const QR_DATA = 'https://kerfdesk.example/serial/000123';

function code(
  id: string,
  symbology: BarcodeSymbology,
  spec: Partial<BarcodeShape> = {},
  extra: Partial<ShapeObject> = {},
): ShapeObject {
  return {
    kind: 'shape',
    id,
    spec: { ...defaultBarcodeSpec(symbology), ...spec },
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    paths: [],
    operationIds: ['fill'],
    ...extra,
  };
}

function projectWith(objects: ShapeObject[], fill: Partial<Layer> = {}): Project {
  const base = createProject();
  const layer = { ...createLayer({ id: 'fill', color: '#000000', mode: 'fill' }), ...fill };
  return { ...base, scene: { ...base.scene, objects, layers: [layer] } };
}

// Burns the code the way a scanline Fill does (one line every interval, as wide
// as the interval) and reads each module at its centre with the test QR reader,
// which shares nothing with the encoder.
async function burnAndRead(moduleMm: number, intervalMm: number, offsetMm: number) {
  const spec: BarcodeShape = { ...defaultBarcodeSpec('qr'), data: QR_DATA, moduleMm };
  const made = await materializeBarcode(spec, QR_DATA, '#000000', async () => ({
    polylines: [],
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  }));
  if (!made.ok) throw new Error(made.message);
  const placed = (made.barcode.paths[0]?.polylines ?? []).map((polyline) => ({
    ...polyline,
    points: polyline.points.map((point) => ({ x: point.x, y: point.y + offsetMm })),
  }));
  const lines = fillHatching({
    polylines: placed,
    hatchAngleDeg: 0,
    hatchSpacingMm: intervalMm,
    fillRule: 'evenodd',
  }).map((line) => {
    const xs = line.points.map((point) => point.x);
    return { y: line.points[0]?.y ?? 0, from: Math.min(...xs), to: Math.max(...xs) };
  });
  const { layout } = made.barcode;
  const quiet = spec.quietZoneModules;
  const size = Math.round(layout.widthMm / moduleMm) - 2 * quiet;
  const grid = new Uint8Array(size * size);
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const x = (column + quiet + 0.5) * moduleMm;
      const y = (row + quiet + 0.5) * moduleMm + offsetMm;
      const burned = lines.some(
        (line) => Math.abs(line.y - y) <= intervalMm / 2 && x >= line.from && x <= line.to,
      );
      grid[row * size + column] = burned ? 1 : 0;
    }
  }
  return decodeQrModules(grid, size);
}

describe('barcodes whose modules are narrower than the Fill line interval', () => {
  it('a code burned with a line interval wider than its modules does not scan', async () => {
    for (const offset of [0, 0.11, 0.23]) {
      expect(await burnAndRead(0.6, 0.1, offset)).toMatchObject({ ok: true, text: QR_DATA });
      expect((await burnAndRead(0.25, 0.3, offset)).ok).toBe(false);
    }
  });

  it('names a QR Code whose modules are narrower than its line interval', () => {
    const project = projectWith([code('tag', 'qr', { moduleMm: 0.25 })], { hatchSpacingMm: 0.3 });
    const expected =
      'Barcode tag has 0.25 mm modules but a 0.30 mm Fill line interval, so whole rows of ' +
      'modules get no line and the code will not scan. Set the interval to 0.12 mm or less, ' +
      'or make the code larger.';
    expect(detectBarcodeLineIntervalWarnings(project)).toEqual([expected]);
    expect(detectMachineJobWarnings(project)).toContain(expected);
  });

  it('stays quiet at the default sizes and for an interval equal to the module', () => {
    const defaults = projectWith([
      code('qr', 'qr'),
      code('dm', 'data-matrix'),
      code('c', 'code128'),
    ]);
    expect(detectBarcodeLineIntervalWarnings(defaults)).toEqual([]);
    const equal = projectWith([code('tag', 'qr', { moduleMm: 0.3 })], { hatchSpacingMm: 0.3 });
    expect(detectBarcodeLineIntervalWarnings(equal)).toEqual([]);
  });

  it('reads the module as placed and the interval the object actually uses', () => {
    const halfScale: Transform = { ...IDENTITY_TRANSFORM, scaleX: 0.5, scaleY: 0.5 };
    const scaled = projectWith([code('small', 'qr', {}, { transform: halfScale })], {
      hatchSpacingMm: 0.4,
    });
    expect(detectBarcodeLineIntervalWarnings(scaled)).toHaveLength(1);
    const override = projectWith([
      code('own', 'qr', { moduleMm: 0.25 }, { operationOverride: { hatchSpacingMm: 0.3 } }),
    ]);
    expect(detectBarcodeLineIntervalWarnings(override)).toHaveLength(1);
  });

  it('checks a 1D code only when every line runs along its bars', () => {
    const coarse = { hatchSpacingMm: 0.5 };
    const across = projectWith([code('bars', 'code128')], { ...coarse, hatchAngleDeg: 0 });
    expect(detectBarcodeLineIntervalWarnings(across)).toEqual([]);
    const along = projectWith([code('bars', 'code128')], { ...coarse, hatchAngleDeg: 90 });
    expect(detectBarcodeLineIntervalWarnings(along)).toHaveLength(1);
    const crossHatched = projectWith([code('bars', 'code128')], {
      ...coarse,
      hatchAngleDeg: 90,
      fillCrossHatch: true,
    });
    expect(detectBarcodeLineIntervalWarnings(crossHatched)).toEqual([]);
    const turned: Transform = { ...IDENTITY_TRANSFORM, rotationDeg: 90 };
    const rotated = projectWith([code('bars', 'code128', {}, { transform: turned })], {
      ...coarse,
      hatchAngleDeg: 0,
    });
    expect(detectBarcodeLineIntervalWarnings(rotated)).toHaveLength(1);
  });

  it('skips Follow Shape fills, line operations and operations that do not output', () => {
    const small = [code('tag', 'qr', { moduleMm: 0.25 })];
    const coarse = { hatchSpacingMm: 0.3 };
    expect(
      detectBarcodeLineIntervalWarnings(projectWith(small, { ...coarse, fillStyle: 'offset' })),
    ).toEqual([]);
    expect(
      detectBarcodeLineIntervalWarnings(projectWith(small, { ...coarse, mode: 'line' })),
    ).toEqual([]);
    expect(
      detectBarcodeLineIntervalWarnings(projectWith(small, { ...coarse, output: false })),
    ).toEqual([]);
  });

  it('caps the list at four codes', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const many = projectWith(
      ids.map((id) => code(id, 'qr', { moduleMm: 0.25 })),
      { hatchSpacingMm: 0.3 },
    );
    const warnings = detectBarcodeLineIntervalWarnings(many);
    expect(warnings).toHaveLength(5);
    expect(warnings[4]).toBe('2 more barcodes have modules narrower than the Fill line interval.');
  });
});
