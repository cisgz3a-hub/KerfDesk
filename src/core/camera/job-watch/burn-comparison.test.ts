import { describe, expect, it } from 'vitest';
import type { RgbaImage } from '../rgba-image';
import { BurnPixel, burnCheckPicture, checkBurn } from './burn-comparison';
import { changeMask } from './change-mask';
import { maskGrid, routeMaskBuilder, type RouteMasks } from './route-mask';

// A 60 × 40 mm patch of plywood at 4 px/mm, and a job that burns one line
// along y = 20 from x = 10 to x = 50.
const PPM = 4;
const REGION = { x: 0, y: 0, width: 60, height: 40 };
const WIDTH = 240;
const HEIGHT = 160;

function plywood(): RgbaImage {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let i = 0; i < WIDTH * HEIGHT; i += 1) {
    // Grain: a gentle stripe plus a little per-pixel noise.
    const x = i % WIDTH;
    const value = 180 + 8 * Math.sin(x / 7) + (((i * 7919) % 13) - 6);
    data.set([value, value * 0.9, value * 0.7, 255], i * 4);
  }
  return { data, width: WIDTH, height: HEIGHT };
}

function edited(
  image: RgbaImage,
  change: (xMm: number, yMm: number, rgb: [number, number, number]) => void,
): RgbaImage {
  const data = new Uint8ClampedArray(image.data);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const at = (y * WIDTH + x) * 4;
      const rgb: [number, number, number] = [data[at] ?? 0, data[at + 1] ?? 0, data[at + 2] ?? 0];
      change((x + 0.5) / PPM, (y + 0.5) / PPM, rgb);
      data.set(rgb, at);
    }
  }
  return { data, width: WIDTH, height: HEIGHT };
}

function lineMasks(): RouteMasks {
  const grid = maskGrid(REGION, PPM);
  if (grid === null) throw new Error('grid');
  const builder = routeMaskBuilder(grid, 0.2, 1);
  builder.addLine(10, 20, 50, 20);
  return builder.masks();
}

const darken = (rgb: [number, number, number], by: number): void => {
  for (let c = 0; c < 3; c += 1) rgb[c] = Math.max(0, (rgb[c] ?? 0) - by);
};

describe('checkBurn', () => {
  const before = plywood();

  it('sees how much of the path burned, and a stray mark, through an exposure change', () => {
    const after = edited(before, (x, y, rgb) => {
      for (let c = 0; c < 3; c += 1) rgb[c] = (rgb[c] ?? 0) + 12; // the camera exposed a little brighter
      if (x >= 10 && x <= 40 && Math.abs(y - 20) <= 0.3) darken(rgb, 120); // burned 3/4
      if (x >= 20 && x <= 22 && y >= 30 && y <= 32) darken(rgb, 90); // a 2 × 2 mm scorch
      if (Math.abs(x - 30) < 0.2 && Math.abs(y - 8) < 0.2) darken(rgb, 90); // one-pixel speck
    });
    const { report } = checkBurn({ before, after, masks: lineMasks(), pixelsPerMm: PPM });
    expect(report.coverage).toBeGreaterThan(0.72);
    expect(report.coverage).toBeLessThan(0.82);
    expect(report.hiddenShare).toBe(0);
    expect(report.strayMarks).toBe(1);
    expect(report.strayAreaMm2).toBeGreaterThan(3);
    expect(report.strayAreaMm2).toBeLessThan(6);
  });

  it('calls a fully burned path fully burned', () => {
    const after = edited(before, (x, y, rgb) => {
      if (x >= 9.9 && x <= 50.1 && Math.abs(y - 20) <= 0.3) darken(rgb, 100);
    });
    const { report } = checkBurn({ before, after, masks: lineMasks(), pixelsPerMm: PPM });
    expect(report.coverage).toBe(1);
    expect(report.strayMarks).toBe(0);
  });

  it('leaves out the gantry across the picture and the area round the head', () => {
    const after = edited(before, (x, y, rgb) => {
      if (x >= 10 && x <= 50 && Math.abs(y - 20) <= 0.3) darken(rgb, 120);
      if (y >= 2 && y <= 6) rgb.fill(40); // the gantry, edge to edge
    });
    const { report, pixels } = checkBurn({
      before,
      after,
      masks: lineMasks(),
      pixelsPerMm: PPM,
      hiddenDiscs: [{ x: 50 * PPM, y: 20 * PPM, radius: 4 * PPM }],
    });
    expect(report.strayMarks).toBe(0);
    expect(report.coverage).toBe(1);
    // The last 4 mm of the 40 mm line sit under the head.
    expect(report.hiddenShare).toBeGreaterThan(0.08);
    expect(report.hiddenShare).toBeLessThan(0.14);
    expect(pixels[4 * PPM * WIDTH + 30 * PPM]).toBe(BurnPixel.Hidden);
  });

  it('judges nothing where the camera saw no bed', () => {
    const blind = edited(before, () => undefined);
    blind.data.fill(0);
    const { report } = checkBurn({ before, after: blind, masks: lineMasks(), pixelsPerMm: PPM });
    expect(report.coverage).toBeNull();
    expect(report.hiddenShare).toBe(1);
  });
});

describe('changeMask', () => {
  it('takes an exposure change out instead of calling the whole bed changed', () => {
    const after = edited(plywood(), (_x, _y, rgb) => {
      for (let c = 0; c < 3; c += 1) rgb[c] = (rgb[c] ?? 0) + 30;
    });
    const change = changeMask(plywood(), after, null);
    expect(change.brightnessShift).toBeGreaterThan(25);
    expect(change.changed.every((value) => value === 0)).toBe(true);
  });
});

describe('burnCheckPicture', () => {
  it('paints missed path red and stray marks amber over the after picture', () => {
    const after: RgbaImage = {
      data: new Uint8ClampedArray([200, 200, 200, 255, 200, 200, 200, 255, 200, 200, 200, 255]),
      width: 3,
      height: 1,
    };
    const picture = burnCheckPicture(
      after,
      new Uint8Array([BurnPixel.Burned, BurnPixel.Missed, BurnPixel.Stray]),
    );
    expect([...picture.data.slice(0, 4)]).toEqual([200, 200, 200, 255]);
    const missed = [...picture.data.slice(4, 7)];
    expect(missed[0]).toBeGreaterThan(200);
    expect(missed[1]).toBeLessThan(100);
    const stray = [...picture.data.slice(8, 11)];
    expect(stray[0]).toBeGreaterThan(stray[2] ?? 0);
    expect(stray[1]).toBeGreaterThan(stray[2] ?? 0);
  });
});
