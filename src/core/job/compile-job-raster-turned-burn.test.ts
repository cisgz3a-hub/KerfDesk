// Where a turned image's pixels burn (quality audit Q2-P3-3), read back from
// the emitted G-code alone. A small modal G-code reader collects every lit
// run, and its own restatement of the front-left origin and of the object
// transform carries each run back into source pixels. Every source pixel has
// its own grey, so the S value a run burns at names the pixel it read. That
// pins, for an image turned off its scan rows, with and without Use original
// pixels (ADR-492 Amendment 1, ADR-359):
// - position: every run lies on the pixel whose grey it burns, with no bias;
// - pitch: rows sit one image pixel apart (pass-through) or one line interval
//   apart (resampled), not stretched over the box around the turned image;
// - coverage and tone: nearly every pixel burns, and a 50 % checker burns 50 %.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { selectOutputStrategy } from '../output';
import { createLayer, IDENTITY_TRANSFORM, type Layer, type RasterImage } from '../scene';
import { compileJob } from './compile-job';

type Vec = { readonly x: number; readonly y: number };
type Run = { readonly from: Vec; readonly to: Vec; readonly s: number };

const dev = DEFAULT_DEVICE_PROFILE; // front-left, 400 x 400 mm, S1000
const SIDE = 15; // 225 pixels, each with its own grey
const PIXEL_MM = 0.1;
const TWO_FIFTY_FIVE = 255;

const distinctGreys = (): number[] => Array.from({ length: SIDE * SIDE }, (_, k) => k);
const checker = (): number[] =>
  Array.from({ length: SIDE * SIDE }, (_, k) =>
    (Math.floor(k / SIDE) + (k % SIDE)) % 2 === 0 ? 0 : TWO_FIFTY_FIVE,
  );

function image(rotationDeg: number, luma: ReadonlyArray<number>): RasterImage {
  return {
    kind: 'raster-image',
    id: 'R1',
    source: 'dithered.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: SIDE,
    pixelHeight: SIDE,
    bounds: { minX: 0, minY: 0, maxX: SIDE * PIXEL_MM, maxY: SIDE * PIXEL_MM },
    // A fractional placement, so no cell centre sits on a pixel edge by luck.
    transform: { ...IDENTITY_TRANSFORM, x: 100.37, y: 80.63, rotationDeg },
    color: '#808080',
    dither: 'grayscale',
    linesPerMm: 10,
    lumaBase64: Buffer.from(Uint8Array.from(luma)).toString('base64'),
  };
}

function imageLayer(overrides: Partial<Layer>): Layer {
  return {
    ...createLayer({ id: 'image', color: '#808080', mode: 'image' }),
    ditherAlgorithm: 'grayscale',
    power: 100,
    minPower: 0,
    dotWidthCorrectionMm: 0,
    linesPerMm: 10,
    ...overrides,
  };
}

function burnRuns(obj: RasterImage, overrides: Partial<Layer>): Run[] {
  const job = compileJob({ objects: [obj], layers: [imageLayer(overrides)] }, dev);
  return mergedRuns(readBurns(selectOutputStrategy(dev).emit(job, dev)));
}

// --- An independent modal G-code reader (G0/G1, G90/G91, G20/G21, M3/M4/M5, S, X, Y).

type Modal = { pos: Vec; motion: number; s: number; on: boolean; relative: boolean; unit: number };

function word(line: string, letter: string): number | undefined {
  const match = new RegExp(`${letter}(-?\\d*\\.?\\d+)`).exec(line);
  return match === null ? undefined : Number(match[1]);
}

function applyModes(state: Modal, line: string): void {
  for (const g of line.matchAll(/G(\d+)/g)) {
    const code = Number(g[1]);
    if (code === 0 || code === 1) state.motion = code;
    if (code === 90 || code === 91) state.relative = code === 91;
    if (code === 20 || code === 21) state.unit = code === 20 ? 25.4 : 1;
  }
  if (/M[34](?!\d)/.test(line)) state.on = true;
  if (/M5(?!\d)/.test(line)) state.on = false;
  state.s = word(line, 'S') ?? state.s;
}

function readBurns(gcode: string): Run[] {
  const runs: Run[] = [];
  const state: Modal = {
    pos: { x: 0, y: 0 },
    motion: 0,
    s: 0,
    on: false,
    relative: false,
    unit: 1,
  };
  for (const raw of gcode.split('\n')) {
    const line = (raw.split(';')[0] ?? '')
      .replace(/\(.*?\)/g, '')
      .replace(/\s+/g, '')
      .toUpperCase();
    applyModes(state, line);
    const x = word(line, 'X');
    const y = word(line, 'Y');
    if (x === undefined && y === undefined) continue;
    const base = state.relative ? state.pos : { x: 0, y: 0 };
    const next = {
      x: x === undefined ? state.pos.x : base.x + x * state.unit,
      y: y === undefined ? state.pos.y : base.y + y * state.unit,
    };
    if (state.motion === 1 && state.on && state.s > 0)
      runs.push({ from: state.pos, to: next, s: state.s });
    state.pos = next;
  }
  return runs;
}

// Consecutive moves at one power along one line are one run of cells.
function mergedRuns(burns: ReadonlyArray<Run>): Run[] {
  const runs: Run[] = [];
  for (const burn of burns) {
    const last = runs.at(-1);
    if (last !== undefined && last.s === burn.s && near(last.to, burn.from)) {
      runs[runs.length - 1] = { ...last, to: burn.to };
    } else {
      runs.push(burn);
    }
  }
  return runs;
}

const near = (a: Vec, b: Vec): boolean => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;

// --- Back into source pixels: the front-left origin flips Y in the bed, and
// the object transform is scale, then rotation, then translation.

function sourcePixel(p: Vec, obj: RasterImage): Vec {
  const scene = { x: p.x, y: dev.bedHeight - p.y };
  const rad = (obj.transform.rotationDeg * Math.PI) / 180;
  const dx = scene.x - obj.transform.x;
  const dy = scene.y - obj.transform.y;
  const localX = (dx * Math.cos(rad) + dy * Math.sin(rad)) / obj.transform.scaleX;
  const localY = (-dx * Math.sin(rad) + dy * Math.cos(rad)) / obj.transform.scaleY;
  return {
    x: ((localX - obj.bounds.minX) / (obj.bounds.maxX - obj.bounds.minX)) * obj.pixelWidth,
    y: ((localY - obj.bounds.minY) / (obj.bounds.maxY - obj.bounds.minY)) * obj.pixelHeight,
  };
}

// Grayscale burns luma l at S = round(1000 * (255 - l) / 255): about 3.9 S
// apart, so the nearest grey names the pixel.
function pixelIndexOf(s: number): number {
  const luma = TWO_FIFTY_FIVE - (s / dev.maxPowerS) * TWO_FIFTY_FIVE;
  const index = Math.round(luma);
  expect(Math.abs(luma - index)).toBeLessThan(0.3);
  return index;
}

type Placement = {
  readonly runs: number;
  readonly coverage: number;
  readonly maxOffset: Vec;
  readonly meanOffset: Vec;
};

// Every run's midpoint must lie on the pixel whose grey it burns; offsets are
// from that pixel's centre, in source pixels.
function placement(obj: RasterImage, runs: ReadonlyArray<Run>): Placement {
  const read = new Set<number>();
  let sumX = 0;
  let sumY = 0;
  let maxX = 0;
  let maxY = 0;
  for (const run of runs) {
    const index = pixelIndexOf(run.s);
    read.add(index);
    const mid = sourcePixel(
      { x: (run.from.x + run.to.x) / 2, y: (run.from.y + run.to.y) / 2 },
      obj,
    );
    const offX = mid.x - ((index % SIDE) + 0.5);
    const offY = mid.y - (Math.floor(index / SIDE) + 0.5);
    sumX += offX;
    sumY += offY;
    maxX = Math.max(maxX, Math.abs(offX));
    maxY = Math.max(maxY, Math.abs(offY));
  }
  return {
    runs: runs.length,
    coverage: read.size / (SIDE * SIDE),
    maxOffset: { x: maxX, y: maxY },
    meanOffset: { x: sumX / runs.length, y: sumY / runs.length },
  };
}

// Rows run along the scan angle (counter-clockwise from machine X); the pitch
// is the median gap between neighbouring rows across that direction. Points
// of one row differ only by the controller's 0.001 mm grid.
const SAME_ROW_MM = 0.005;

function rowPitchMm(runs: ReadonlyArray<Run>, scanAngleDeg: number): number {
  const rad = (scanAngleDeg * Math.PI) / 180;
  const across = runs
    .map((run) => -Math.sin(rad) * run.from.x + Math.cos(rad) * run.from.y)
    .sort((a, b) => a - b);
  const rows: number[] = [];
  for (const value of across) {
    if (rows.length === 0 || value - (rows.at(-1) ?? 0) > SAME_ROW_MM) rows.push(value);
  }
  const gaps = rows
    .slice(1)
    .map((row, i) => row - (rows[i] ?? row))
    .sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] ?? Number.NaN;
}

// Laser energy per area of the image, as darkness: the beam's width is fixed,
// so rows spread further apart than the image's own pixels burn it lighter.
// A solid image burned at full power, one row per pixel row, reads 1.
function arealDose(runs: ReadonlyArray<Run>): number {
  const dose = runs.reduce(
    (sum, run) =>
      sum + Math.hypot(run.to.x - run.from.x, run.to.y - run.from.y) * (run.s / dev.maxPowerS),
    0,
  );
  return (dose * PIXEL_MM) / (SIDE * PIXEL_MM) ** 2;
}

// Rows are spread evenly over the box (KNOWN 20-K-6): about 20 rows here, so
// the fit moves the pitch by up to half a row in 20, 2.5 %. Never by the
// 8-41 % stretch of Q2-P1-1.
function expectPitch(pitchMm: number, expectedMm: number): void {
  expect(Math.abs(pitchMm / expectedMm - 1)).toBeLessThan(0.03);
}
// Half a pixel, plus the controller's three-decimal grid.
const ON_PIXEL = 0.5 + 0.01;
const NO_BIAS = 0.05;

describe('a pass-through image burns its own pixels at their own pitch (Q2-P1-1)', () => {
  it('upright: every pixel once, at its exact centre (the twin)', () => {
    const obj = image(0, distinctGreys());
    const runs = burnRuns(obj, { passThrough: true });
    const found = placement(obj, runs);
    expect(found.coverage).toBe(1);
    expect(found.runs).toBe(SIDE * SIDE);
    expect(found.maxOffset.x).toBeLessThan(0.01);
    expect(found.maxOffset.y).toBeLessThan(0.01);
    expect(rowPitchMm(runs, 0)).toBeCloseTo(PIXEL_MM, 3);
  });

  it('turned with the scan: every pixel once, at its exact centre', () => {
    // Front-left flips one axis, so an image turned -37 degrees lines up with a 37 degree scan.
    const obj = image(-37, distinctGreys());
    const runs = burnRuns(obj, { passThrough: true, imageScanAngleDeg: 37 });
    const found = placement(obj, runs);
    expect(found.coverage).toBe(1);
    expect(found.maxOffset.x).toBeLessThan(0.02);
    expect(found.maxOffset.y).toBeLessThan(0.02);
    expect(rowPitchMm(runs, 37)).toBeCloseTo(PIXEL_MM, 2);
  });

  it.each([
    ['turned 5 degrees', 5, 0],
    ['turned 37 degrees', 37, 0],
    ['turned exactly 45 degrees', 45, 0],
    ['turned 60 degrees', 60, 0],
    ['upright, scanned at 37 degrees', 0, 37],
  ])('%s: rows one pixel apart, every run on its own pixel', (_, rotationDeg, scanAngleDeg) => {
    const obj = image(rotationDeg, distinctGreys());
    const runs = burnRuns(obj, { passThrough: true, imageScanAngleDeg: scanAngleDeg });
    const found = placement(obj, runs);
    expectPitch(rowPitchMm(runs, scanAngleDeg), PIXEL_MM);
    expect(found.maxOffset.x).toBeLessThan(ON_PIXEL);
    expect(found.maxOffset.y).toBeLessThan(ON_PIXEL);
    expect(Math.abs(found.meanOffset.x)).toBeLessThan(NO_BIAS);
    expect(Math.abs(found.meanOffset.y)).toBeLessThan(NO_BIAS);
    // Nearest-pixel cells read about 82 % at 45 and 60 degrees, all at 37; the
    // stretched grid read 51 % (37), 38 % (45) and 54 % (60).
    expect(found.coverage).toBeGreaterThan(0.75);
  });

  it.each([
    ['turned 37 degrees', 37, 0],
    ['turned exactly 45 degrees', 45, 0],
    ['upright, scanned at 37 degrees', 0, 37],
  ])(
    '%s: a pre-dithered half-tone checker still burns half dark',
    (_, rotationDeg, scanAngleDeg) => {
      const runs = burnRuns(image(rotationDeg, checker()), {
        passThrough: true,
        imageScanAngleDeg: scanAngleDeg,
      });
      // The stretched grid burned it at 0.36 (37 degrees), or 0.18-0.71 at 45 by placement.
      expect(Math.abs(arealDose(runs) - 0.5)).toBeLessThan(0.06);
    },
  );
});

describe('a turned, resampled image burns each cell on the pixel it reads (ADR-359)', () => {
  it.each([
    ['at 1:1', 10],
    ['upsampled 1.37 times', 13.7],
    ['upsampled 2.5 times', 25],
  ])('turned 37 degrees %s', (_, linesPerMm) => {
    const obj = image(37, distinctGreys());
    const runs = burnRuns(obj, { passThrough: false, linesPerMm });
    const found = placement(obj, runs);
    expectPitch(rowPitchMm(runs, 0), 1 / linesPerMm);
    expect(found.maxOffset.x).toBeLessThan(ON_PIXEL);
    expect(found.maxOffset.y).toBeLessThan(ON_PIXEL);
    expect(Math.abs(found.meanOffset.x)).toBeLessThan(NO_BIAS);
    expect(Math.abs(found.meanOffset.y)).toBeLessThan(NO_BIAS);
    // A source no denser than the grid is read untouched, one pixel per cell:
    // nearly every pixel at 1:1, and every one once the cells are smaller.
    expect(found.coverage).toBeGreaterThan(linesPerMm > 10 ? 0.97 : 0.75);
  });
});
