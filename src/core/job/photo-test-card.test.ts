import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { effectiveOperationForObject } from '../effective-output';
import { fitPhotoToneCurve } from '../raster/photo-tone-curve';
import { createLayer, type Layer, type RasterImage } from '../scene';
import { compileRasterGroupsForLayer } from './compile-job-raster';
import { generatePhotoTestCard, photoTestCardAxes, type PhotoTestCard } from './photo-test-card';
import {
  cropPhotoTestPatch,
  photoTestWindow,
  photoTestWindowSizeMm,
  type PhotoTestSource,
} from './photo-test-patch';
import type { RasterGroup } from './job';
import { decodeRasterLuma } from './raster-luma-decode';
import { rasterRow } from './raster-rows';

const CURVE = fitPhotoToneCurve([{ commandedPercent: 50, observedPercent: 80 }], 'Slate');

const PHOTO: Layer = {
  ...createLayer({ id: 'photo', color: '#808080', mode: 'image' }),
  ditherAlgorithm: 'blue-noise',
  linesPerMm: 10,
  power: 40,
  speed: 3000,
  negativeImage: true,
  imageOverscanMm: 7,
  photoToneCurve: CURVE,
};

/** A 200 x 100 px photo placed at 100 x 50 mm: a ramp across, darker down. */
function rampSource(): PhotoTestSource {
  const pixelWidth = 200;
  const pixelHeight = 100;
  const luma = new Uint8Array(pixelWidth * pixelHeight);
  for (let y = 0; y < pixelHeight; y += 1) {
    for (let x = 0; x < pixelWidth; x += 1) luma[y * pixelWidth + x] = Math.max(0, x - y);
  }
  return { luma, pixelWidth, pixelHeight, widthMm: 100, heightMm: 50 };
}

function card(overrides: Partial<Parameters<typeof generatePhotoTestCard>[0]> = {}): PhotoTestCard {
  const source = rampSource();
  const window = photoTestWindow(source, {
    centre: { x: 0.5, y: 0.5 },
    sizeMm: 10,
    linesPerMm: PHOTO.linesPerMm,
  });
  return generatePhotoTestCard({
    rows: 3,
    columns: 4,
    speedMin: 1000,
    speedMax: 3000,
    powerMin: 25,
    powerMax: 100,
    patch: cropPhotoTestPatch(source, window),
    operation: PHOTO,
    tones: { brightness: 5, contrast: 12, gamma: 0.8, sharpenAmount: 30, sharpenRadius: 0.7 },
    ...overrides,
  });
}

function images(result: PhotoTestCard): RasterImage[] {
  return result.scene.objects.filter(
    (object): object is RasterImage => object.kind === 'raster-image',
  );
}

describe('ADR-711 photo test patch', () => {
  it('cuts the piece at the photo own scale, centred where asked', () => {
    const source = rampSource();
    const window = photoTestWindow(source, {
      centre: { x: 0.5, y: 0.5 },
      sizeMm: 10,
      linesPerMm: 10,
    });
    // 2 px/mm: 10 mm is 20 stored pixels, none averaged away at 10 lines/mm.
    expect(window).toEqual({ minX: 90, maxX: 110, minY: 40, maxY: 60, stepX: 1, stepY: 1 });
    expect(photoTestWindowSizeMm(source, window)).toEqual({ widthMm: 10, heightMm: 10 });
    const patch = cropPhotoTestPatch(source, window);
    expect(patch).toMatchObject({ pixelWidth: 20, pixelHeight: 20, widthMm: 10, heightMm: 10 });
    expect(patch.luma[0]).toBe(90 - 40);
    expect(patch.luma[19]).toBe(109 - 40);
  });

  it('keeps the piece inside the photo and no larger than it', () => {
    const source = rampSource();
    const corner = photoTestWindow(source, { centre: { x: 1, y: 0 }, sizeMm: 10, linesPerMm: 10 });
    expect(corner).toMatchObject({ minX: 180, maxX: 200, minY: 0, maxY: 20 });
    const huge = photoTestWindow(source, {
      centre: { x: 0.5, y: 0.5 },
      sizeMm: 500,
      linesPerMm: 10,
    });
    expect(huge).toMatchObject({ minX: 0, maxX: 200, minY: 0, maxY: 100 });
    expect(photoTestWindowSizeMm(source, huge)).toEqual({ widthMm: 100, heightMm: 50 });
  });

  it('averages source detail the burn grid cannot hold, keeping the placed size', () => {
    const source = rampSource();
    // 2 lines/mm burns 0.5 mm cells; the 2 px/mm source keeps 2 px a cell...
    const coarse = photoTestWindow(source, {
      centre: { x: 0.5, y: 0.5 },
      sizeMm: 10,
      linesPerMm: 0.5,
    });
    // ...so at 0.5 lines/mm two stored pixels become one.
    expect(coarse).toMatchObject({ stepX: 2, stepY: 2, minX: 90, maxX: 110 });
    const patch = cropPhotoTestPatch(source, coarse);
    expect(patch).toMatchObject({ pixelWidth: 10, pixelHeight: 10, widthMm: 10, heightMm: 10 });
    // Mean of (90,40) (91,40) (90,41) (91,41) on the x - y ramp.
    expect(patch.luma[0]).toBe(50);
  });

  it('mirrors the piece as the placed photo is mirrored', () => {
    const source = rampSource();
    const window = photoTestWindow(source, {
      centre: { x: 0.5, y: 0.5 },
      sizeMm: 10,
      linesPerMm: 10,
    });
    const plain = cropPhotoTestPatch(source, window);
    const mirrored = cropPhotoTestPatch(source, window, { x: true, y: false });
    expect(mirrored.luma[0]).toBe(plain.luma[19]);
    expect(mirrored.luma[19]).toBe(plain.luma[0]);
    const flipped = cropPhotoTestPatch(source, window, { x: false, y: true });
    expect(flipped.luma[0]).toBe(plain.luma[19 * 20]);
  });
});

describe('ADR-711 photo test card', () => {
  it('runs power low to high across and speed fast to slow down', () => {
    const result = card();
    expect(result.powers).toEqual([25, 50, 75, 100]);
    expect(result.speeds).toEqual([3000, 2000, 1000]);
    expect(result.cells).toHaveLength(12);
    expect(result.cells[0]).toMatchObject({ row: 0, column: 0, power: 25, speed: 3000 });
    expect(result.cells[11]).toMatchObject({ row: 2, column: 3, power: 100, speed: 1000 });
    expect(photoTestCardAxes({ ...OPTIONS_RANGE, rows: 99, columns: 0 })).toMatchObject({
      speedAxis: { values: { length: 8 } },
      powerAxis: { values: [25] },
    });
  });

  it('burns every square with the photo settings, changing only power and speed', () => {
    const result = card();
    const cells = images(result);
    expect(cells).toHaveLength(12);
    for (const cell of result.cells) {
      const image = cells.find((candidate) => candidate.id === cell.objectId);
      const layer = result.scene.layers.find((candidate) => candidate.id === cell.layerId);
      if (image === undefined || layer === undefined) throw new Error('Missing square');
      const effective = effectiveOperationForObject(layer, image);
      expect(effective).toMatchObject({
        mode: 'image',
        ditherAlgorithm: 'blue-noise',
        linesPerMm: 10,
        negativeImage: true,
        passThrough: false,
        imageOverscanMm: 7,
        photoToneCurve: CURVE,
        power: cell.power,
        speed: cell.requestedSpeed,
      });
      expect(image).toMatchObject({
        source: 'photo-test-card-cell',
        brightness: 5,
        contrast: 12,
        gamma: 0.8,
        sharpenAmount: 30,
        sharpenRadius: 0.7,
      });
      expect(image.powerScale).toBeUndefined();
    }
  });

  it('gives every square the same pixels at the same placed size', () => {
    const result = card();
    const [first, ...rest] = images(result);
    if (first === undefined) throw new Error('No squares');
    expect(first.bounds).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
    expect(decodeRasterLuma(first)).toHaveLength(400);
    for (const image of rest) {
      expect(image.lumaBase64).toBe(first.lumaBase64);
      expect(image.dataUrl).toBe(first.dataUrl);
      expect(image.bounds).toEqual(first.bounds);
    }
    expect(first.dataUrl?.startsWith('data:image/bmp;base64,')).toBe(true);
  });

  it('lays the squares out clear of each other, right of the runway, with burned labels', () => {
    const result = card({ gapMm: 3 });
    const first = result.cells[0];
    const next = result.cells[1];
    const below = result.cells[4];
    if (first === undefined || next === undefined || below === undefined) throw new Error('cells');
    // The operation's 7 mm laser-off runway fits left of the first column.
    expect(first.bounds.minX).toBeGreaterThanOrEqual(7);
    expect(next.bounds.minX - first.bounds.maxX).toBeCloseTo(3, 9);
    expect(below.bounds.minY - first.bounds.maxY).toBeCloseTo(3, 9);
    const labels = result.scene.objects.filter((object) => object.kind === 'imported-svg');
    expect(labels).toHaveLength(4 + 3);
    expect(labels.every((label) => label.id.startsWith('photo-test-'))).toBe(true);
    expect(new Set(result.scene.objects.map((object) => object.id)).size).toBe(12 + 7);
    expect(new Set(result.scene.layers.map((layer) => layer.color)).size).toBe(4);
  });

  it('labels and records a row at the feed the machine can run', () => {
    const result = card({ maxFeedMmPerMin: 2500 });
    expect(result.speeds).toEqual([2500, 2000, 1000]);
    expect(result.cells[0]).toMatchObject({ speed: 2500, requestedSpeed: 3000 });
    expect(result.scene.layers[0]?.name).toBe('Photo test 2500 mm/min');
  });

  it('writes no sharpening fields for an unsharpened photo', () => {
    const [image] = images(card({ tones: { brightness: 0, contrast: 0, gamma: 1 } }));
    expect(image).not.toHaveProperty('sharpenAmount');
    expect(image).not.toHaveProperty('sharpenRadius');
  });

  it('compiles each square to the same dots, whatever its power and speed', () => {
    const result = card({ operation: { ...PHOTO, photoToneCurve: undefined } });
    const rows = result.scene.layers.filter((layer) => layer.mode === 'image');
    const groups = rows.flatMap(
      (layer) =>
        compileRasterGroupsForLayer(result.scene.objects, layer, DEFAULT_DEVICE_PROFILE).groups,
    );
    expect(groups.map((group) => [group.power, group.speed])).toEqual(
      result.cells.map((cell) => [cell.power, cell.speed]),
    );
    const dots = groups.map((group) => ({
      size: [group.pixelWidth, group.pixelHeight],
      fired: firedPattern(group),
    }));
    expect(dots).toHaveLength(12);
    expect(dots[0]?.size).toEqual([100, 100]);
    expect(dots[0]?.fired.includes('1')).toBe(true);
    expect(dots[0]?.fired.includes('0')).toBe(true);
    for (const cell of dots) expect(cell).toEqual(dots[0]);
  });
});

const OPTIONS_RANGE = { speedMin: 1000, speedMax: 3000, powerMin: 25, powerMax: 100 } as const;

function firedPattern(group: RasterGroup): string {
  let out = '';
  for (let y = 0; y < group.pixelHeight; y += 1) {
    out += Array.from(rasterRow(group, y), (value) => (value > 0 ? '1' : '0')).join('');
  }
  return out;
}
