import { describe, expect, it } from 'vitest';
import { bedPoint, projectWorldPoint } from './camera-model';
import { overheadPose, wideLens } from './model-fixtures';
import {
  measureViewShift,
  MIN_MATCH_SCORE,
  surroundMask,
  viewShiftOnBedMm,
  viewThumbnail,
  type ViewThumbnail,
} from './view-shift';

const W = 384;
const H = 216;

// A machine-like surround: bars and blocks at fixed places, seen through a
// window that can slide, with whatever is on the bed in the middle.
function scene(shiftX: number, shiftY: number, bed: (x: number, y: number) => number) {
  const data = new Uint8Array(W * H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const sx = x - shiftX;
      const sy = y - shiftY;
      let value = 90 + 30 * Math.sin(sx * 0.21) * Math.cos(sy * 0.17);
      if (Math.floor(sx / 13) % 3 === 0) value += 60;
      if (Math.floor(sy / 9) % 4 === 1) value -= 40;
      if (x > 40 && x < 150 && y > 20 && y < 88) value = bed(x, y);
      data[y * W + x] = Math.max(0, Math.min(255, Math.round(value)));
    }
  }
  return { width: W, height: H, data } satisfies ViewThumbnail;
}

// The surround: everything outside the bed's box, as surroundMask gives it.
function boxMask(): Uint8Array {
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      mask[y * W + x] = x > 35 && x < 155 && y > 15 && y < 93 ? 0 : 1;
    }
  }
  return mask;
}

const sheet = () => 200;
const parts = (x: number, y: number) => ((Math.floor(x / 7) + Math.floor(y / 5)) % 2 ? 40 : 220);

describe('measureViewShift', () => {
  it('finds no move when only the material on the bed changed', () => {
    const shift = measureViewShift(scene(0, 0, sheet), scene(0, 0, parts), boxMask());
    expect(shift?.score).toBeGreaterThan(MIN_MATCH_SCORE);
    expect(Math.abs(shift?.dxPx ?? 9)).toBeLessThan(0.2);
    expect(Math.abs(shift?.dyPx ?? 9)).toBeLessThan(0.2);
  });

  it('measures a camera that slid, to a fraction of a pixel', () => {
    const shift = measureViewShift(scene(0, 0, sheet), scene(3, -2, parts), boxMask());
    expect(shift?.score).toBeGreaterThan(MIN_MATCH_SCORE);
    expect(shift?.dxPx).toBeCloseTo(3, 0);
    expect(shift?.dyPx).toBeCloseTo(-2, 0);
  });

  it('reads a move of part of a pixel', () => {
    // Smooth shapes, so the picture itself moves by part of a pixel too.
    const smooth = (shiftX: number, shiftY: number): ViewThumbnail => {
      const data = new Uint8Array(W * H);
      for (let y = 0; y < H; y += 1) {
        for (let x = 0; x < W; x += 1) {
          const sx = x - shiftX;
          const sy = y - shiftY;
          const value =
            128 +
            40 * Math.sin(0.19 * sx + 0.07 * sy) +
            35 * Math.cos(0.13 * sy - 0.05 * sx) +
            25 * Math.sin(0.31 * sx) * Math.cos(0.23 * sy);
          data[y * W + x] = Math.round(value);
        }
      }
      return { width: W, height: H, data };
    };
    const shift = measureViewShift(smooth(0, 0), smooth(1.5, 0.5), boxMask());
    expect(Math.abs((shift?.dxPx ?? 9) - 1.5)).toBeLessThan(0.3);
    expect(Math.abs((shift?.dyPx ?? 9) - 0.5)).toBeLessThan(0.3);
    const diagonal = measureViewShift(smooth(0, 0), smooth(-0.6, 0.9), boxMask());
    expect(Math.abs((diagonal?.dxPx ?? 9) + 0.6)).toBeLessThan(0.3);
    expect(Math.abs((diagonal?.dyPx ?? 9) - 0.9)).toBeLessThan(0.3);
  });

  it('reads a brighter room as no move', () => {
    const reference = scene(0, 0, sheet);
    const brighter = {
      ...reference,
      data: reference.data.map((value) => Math.min(255, Math.round(value * 1.2 + 15))),
    };
    const shift = measureViewShift(reference, brighter, boxMask());
    expect(Math.abs(shift?.dxPx ?? 9)).toBeLessThan(0.2);
    expect(Math.abs(shift?.dyPx ?? 9)).toBeLessThan(0.2);
  });

  it('says nothing about a surround too small or too plain to compare', () => {
    const none = new Uint8Array(W * H);
    expect(measureViewShift(scene(0, 0, sheet), scene(0, 0, sheet), none)).toBeNull();
    const plain = { width: W, height: H, data: new Uint8Array(W * H).fill(120) };
    expect(measureViewShift(plain, plain, boxMask())).toBeNull();
  });

  it('does not compare thumbnails of different sizes', () => {
    const other = { width: W / 2, height: H / 2, data: new Uint8Array((W / 2) * (H / 2)) };
    expect(measureViewShift(scene(0, 0, sheet), other, boxMask())).toBeNull();
  });
});

describe('viewThumbnail', () => {
  it('averages the frame down to the thumbnail width, keeping its shape', () => {
    const width = 1280;
    const height = 720;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i += 1)
      data.fill(i % width < 640 ? 0 : 255, i * 4, i * 4 + 3);
    const thumb = viewThumbnail({ width, height, data });
    expect(thumb.width).toBe(384);
    expect(thumb.height).toBe(216);
    expect(thumb.data[0]).toBe(0);
    expect(thumb.data[383]).toBe(255);
  });
});

describe('surroundMask and viewShiftOnBedMm', () => {
  const lens = wideLens();
  const pose = overheadPose();

  it('leaves the bed out and keeps what the camera sees beyond it', () => {
    const mask = surroundMask({
      lens,
      pose,
      thumbWidth: 192,
      thumbHeight: 108,
      bedWidthMm: 400,
      bedHeightMm: 400,
    });
    const centre = projectWorldPoint(lens, pose, bedPoint(200, 200));
    if (centre === null) throw new Error('bed centre off the picture');
    const tx = Math.floor(((centre.x + 0.5) * 192) / lens.imageWidth);
    const ty = Math.floor(((centre.y + 0.5) * 108) / lens.imageHeight);
    expect(mask[ty * 192 + tx]).toBe(0);
    expect(mask.reduce((sum, value) => sum + value, 0)).toBeGreaterThan(0);
  });

  it('turns a view shift into millimetres at the middle of the bed', () => {
    const centre = projectWorldPoint(lens, pose, bedPoint(200, 200));
    if (centre === null) throw new Error('bed centre off the picture');
    const mm = viewShiftOnBedMm({
      lens,
      pose,
      thumbWidth: 192,
      thumbHeight: 108,
      bedCentreMm: { x: 200, y: 200 },
      centrePx: centre,
      shift: { dxPx: 1, dyPx: 0, score: 1 },
    });
    // One thumbnail pixel is 1280 / 192 camera pixels, a few millimetres here.
    expect(mm).toBeGreaterThan(1);
    expect(mm).toBeLessThan(10);
  });
});
