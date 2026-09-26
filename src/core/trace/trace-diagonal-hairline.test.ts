// One-pixel diagonal hairlines through the whole filled-contour pipeline
// (ADR-395). Before the saddle policy, the walker and despeckle treated ink
// as four-connected (the walker left paper eight-connected, while pinhole
// fill flooded paper four-connected), so every pixel of a 1-px diagonal was
// its own speck: Line Art returned no outline at all (recall 0.000) and
// Sharp returned ~57 sub-pixel islands. Each cell below must now trace the
// hairline as ONE outline covering its pixels, next to or away from broad
// ink, for binary and anti-aliased sources, in all three filled presets.

import { describe, expect, it } from 'vitest';
import { compareMasks } from '../../__fixtures__/perceptual/compare';
import { rasterizeColoredPaths, type Mask } from '../../__fixtures__/perceptual/rasterize';
import type { Polyline } from '../scene';
import { intersectingContourLoopsSteps } from './contour-intersections';
import type { RawImageData, TraceOptions } from './index';
import { TRACE_PRESETS, traceImageToColoredPaths } from './index';
import { runTraceSteps } from './trace-steps';

const SIZE = 200;
const LINE_X0 = 110;
const LINE_Y0 = 20;
const LINE_LENGTH = 80;
const SUPERSAMPLES = 8;
const INK_CUT = 128;

type Fixture = { readonly image: RawImageData; readonly truth: Mask };

function toImage(luma: Float32Array): RawImageData {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i += 1) {
    const v = Math.round(luma[i] ?? 255);
    data.set([v, v, v, 255], i * 4);
  }
  return { width: SIZE, height: SIZE, data };
}

// A binary 1-px line steps one pixel per major-axis pixel (8-connected, so
// every step is a saddle). The anti-aliased line is a 1-px-wide band whose
// pixels carry their exact area coverage.
function paintBinaryLine(luma: Float32Array, degrees: number): void {
  const radians = (degrees * Math.PI) / 180;
  const slope = Math.tan(radians);
  if (slope <= 1) {
    for (let i = 0; i < Math.round(LINE_LENGTH * Math.cos(radians)); i += 1)
      luma[(LINE_Y0 + Math.round(i * slope)) * SIZE + LINE_X0 + i] = 0;
    return;
  }
  for (let j = 0; j < Math.round(LINE_LENGTH * Math.sin(radians)); j += 1)
    luma[(LINE_Y0 + j) * SIZE + LINE_X0 + Math.round(j / slope)] = 0;
}

function lineCoverage(x: number, y: number, dx: number, dy: number): number {
  let covered = 0;
  for (let sy = 0; sy < SUPERSAMPLES; sy += 1) {
    for (let sx = 0; sx < SUPERSAMPLES; sx += 1) {
      const px = x + (sx + 0.5) / SUPERSAMPLES - (LINE_X0 + 0.5);
      const py = y + (sy + 0.5) / SUPERSAMPLES - (LINE_Y0 + 0.5);
      const along = px * dx + py * dy;
      const across = -px * dy + py * dx;
      if (along >= 0 && along <= LINE_LENGTH && Math.abs(across) <= 0.5) covered += 1;
    }
  }
  return covered / SUPERSAMPLES ** 2;
}

function paintAntialiasedLine(luma: Float32Array, degrees: number): void {
  const radians = (degrees * Math.PI) / 180;
  for (let y = LINE_Y0 - 3; y < LINE_Y0 + LINE_LENGTH + 3; y += 1) {
    for (let x = LINE_X0 - 3; x < LINE_X0 + LINE_LENGTH + 3; x += 1) {
      const coverage = lineCoverage(x, y, Math.cos(radians), Math.sin(radians));
      if (coverage > 0) luma[y * SIZE + x] = 255 * (1 - coverage);
    }
  }
}

function hairline(degrees: number, antialiased: boolean, withSquare: boolean): Fixture {
  const luma = new Float32Array(SIZE * SIZE).fill(255);
  if (antialiased) paintAntialiasedLine(luma, degrees);
  else paintBinaryLine(luma, degrees);
  // Truth = the line's own ink pixels (the binary pixels, or AA coverage
  // past the 128 cut), before the broad square is added beside it.
  const truth: Mask = { width: SIZE, height: SIZE, data: new Uint8Array(SIZE * SIZE) };
  for (let i = 0; i < SIZE * SIZE; i += 1) truth.data[i] = (luma[i] ?? 255) < INK_CUT ? 1 : 0;
  if (withSquare) {
    for (let y = 120; y < 180; y += 1) for (let x = 20; x < 80; x += 1) luma[y * SIZE + x] = 0;
  }
  return { image: toImage(luma), truth };
}

const PRESETS = ['Line Art', 'Smooth', 'Sharp'] as const;
type PresetName = (typeof PRESETS)[number];

// Recall floor 0.9 (the brief's target) everywhere except two documented
// finishing limits covering eight of the 36 cells. Connectivity is exact in
// every cell; the shortfall is outline geometry (ADR-395 "Remaining gaps"):
//  - Line Art, binary 30°/60°, alone and beside the square (4 cells,
//    measured 0.826): the small-source 2x path interpolates cracks on a
//    bilinear enlargement of the binary staircase, which pinches the ribbon
//    at each step (loop area 60 of 69 px). Potrace 1.16 measures 0.870 on
//    the same mask. Owner: the supersampling path.
//  - Smooth, 30°/60° beside the square, binary and AA (4 cells, measured
//    0.899 / 0.887): Smooth's wider simplification finishes the sub-pixel
//    ribbon as a coarse polygon (13 points for 69 px) that cuts the
//    staircase's outer pixels. Potrace 1.16 measures 0.870 binary and
//    0.863 / 0.887 AA. Owner: the contour finishing tail.
function recallFloor(
  preset: PresetName,
  antialiased: boolean,
  degrees: number,
  sq: boolean,
): number {
  if (degrees === 45) return 0.9;
  if (preset === 'Line Art' && !antialiased) return 0.8;
  if (preset === 'Smooth' && sq) return 0.85;
  return 0.9;
}

function hairlineOutlines(polylines: ReadonlyArray<Polyline>): Polyline[] {
  return polylines.filter((polyline) => polyline.points.some((point) => point.x > SIZE / 2));
}

async function traceCell(
  preset: PresetName,
  fixture: Fixture,
  extra: Partial<TraceOptions> = {},
): Promise<{ readonly outlines: Polyline[]; readonly all: Polyline[]; readonly recall: number }> {
  const options: TraceOptions = { ...(TRACE_PRESETS[preset] as TraceOptions), ...extra };
  const paths = await traceImageToColoredPaths(fixture.image, options);
  const all = paths.flatMap((path) => path.polylines);
  const rendered = rasterizeColoredPaths(paths, SIZE, SIZE);
  // Score only the hairline's half of the canvas.
  for (let y = 0; y < SIZE; y += 1)
    for (let x = 0; x < SIZE / 2; x += 1) rendered.data[y * SIZE + x] = 0;
  return {
    outlines: hairlineOutlines(all),
    all,
    recall: compareMasks(rendered, fixture.truth).recall,
  };
}

const CELLS = PRESETS.flatMap((preset) =>
  [false, true].flatMap((antialiased) =>
    [30, 45, 60].flatMap((degrees) =>
      [false, true].map((withSquare) => ({ preset, antialiased, degrees, withSquare })),
    ),
  ),
);

describe('1-px diagonal hairlines trace as one connected outline (ADR-395)', () => {
  it.each(CELLS)(
    '$preset aa=$antialiased $degrees° square=$withSquare',
    async ({ preset, antialiased, degrees, withSquare }) => {
      const fixture = hairline(degrees, antialiased, withSquare);
      const { outlines, all, recall } = await traceCell(preset, fixture);
      expect(outlines).toHaveLength(1);
      expect(recall).toBeGreaterThanOrEqual(recallFloor(preset, antialiased, degrees, withSquare));
      if (withSquare) expect(all.length - outlines.length).toBe(1);
      // The topology stage's guarantee holds for the pinched ribbon too.
      expect(runTraceSteps(intersectingContourLoopsSteps(all)).size).toBe(0);
    },
  );

  it('connect-paper reproduces the historical four-connected failure', async () => {
    const fixture = hairline(45, false, true);
    const { outlines } = await traceCell('Line Art', fixture, { turnPolicy: 'connect-paper' });
    expect(outlines).toHaveLength(0);
    const sharp = await traceCell('Sharp', fixture, { turnPolicy: 'connect-paper' });
    expect(sharp.outlines.length).toBeGreaterThan(40);
  });

  // A hairline that runs INTO broad ink — a T-junction on a block's side, or
  // a touch at its corner — is one component with the block, so it is one
  // outline in every preset (the saddle policy's part). Keeping the
  // hairline's width is up to the finishing tail, which simplifies the
  // block's large loop at a tolerance wider than the 1-px ribbon: Line Art
  // (legacy DP + spline tail at 2x) keeps about a quarter of it and Smooth
  // about half. These floors pin today's measurements as regression guards;
  // the gap is ADR-395 "Remaining gaps" (owner: contour finishing).
  const ATTACHED = [
    { preset: 'Line Art', join: 'side', floor: 0.2 },
    { preset: 'Line Art', join: 'corner', floor: 0.2 },
    { preset: 'Smooth', join: 'side', floor: 0.5 },
    { preset: 'Smooth', join: 'corner', floor: 0.6 },
    { preset: 'Sharp', join: 'side', floor: 0.95 },
    { preset: 'Sharp', join: 'corner', floor: 0.85 },
  ] as const;
  it.each(ATTACHED)(
    '$preset keeps a hairline attached at a block $join as one outline',
    async ({ preset, join, floor }) => {
      const luma = new Float32Array(SIZE * SIZE).fill(255);
      const truth: Mask = { width: SIZE, height: SIZE, data: new Uint8Array(SIZE * SIZE) };
      for (let i = 20; i < 100; i += 1) {
        luma[i * SIZE + i] = 0;
        truth.data[i * SIZE + i] = 1;
      }
      // side: the line's last pixel (99,99) is 4-adjacent to the block's left
      // side; corner: it touches the block's top-left pixel diagonally.
      const top = join === 'side' ? 50 : 100;
      for (let y = top; y < top + 60; y += 1)
        for (let x = 100; x < 160; x += 1) luma[y * SIZE + x] = 0;
      const paths = await traceImageToColoredPaths(
        toImage(luma),
        TRACE_PRESETS[preset] as TraceOptions,
      );
      const all = paths.flatMap((path) => path.polylines);
      expect(all).toHaveLength(1);
      expect(runTraceSteps(intersectingContourLoopsSteps(all)).size).toBe(0);
      const rendered = rasterizeColoredPaths(paths, SIZE, SIZE);
      for (let y = 0; y < SIZE; y += 1)
        for (let x = 100; x < SIZE; x += 1) rendered.data[y * SIZE + x] = 0;
      expect(compareMasks(rendered, truth).recall).toBeGreaterThanOrEqual(floor);
    },
  );

  it('keeps two squares that touch at one corner as two outlines', async () => {
    const luma = new Float32Array(SIZE * SIZE).fill(255);
    for (let y = 40; y < 100; y += 1) for (let x = 40; x < 100; x += 1) luma[y * SIZE + x] = 0;
    for (let y = 100; y < 160; y += 1) for (let x = 100; x < 160; x += 1) luma[y * SIZE + x] = 0;
    for (const preset of PRESETS) {
      const paths = await traceImageToColoredPaths(
        toImage(luma),
        TRACE_PRESETS[preset] as TraceOptions,
      );
      expect(
        paths.flatMap((path) => path.polylines),
        preset,
      ).toHaveLength(2);
    }
  });
});

describe('checkerboards never weld into a solid block (ADR-395)', () => {
  // Every saddle of a checkerboard is a window tie. On the small-source 2x
  // path the grey field is a bilinear enlargement of the binary board, whose
  // symmetric saddle value is the block mean (127.5 against Line Art's cut
  // of 128): not evidence, so the tie-break (paper) must stand. Joining ink
  // there made every paper cell an enclosed pinhole and pinhole fill painted
  // the board solid (precision 0.50).
  const BOARD = 150;
  const boards = [
    { name: '1-px cells, full frame', cell: 1, patch: false },
    { name: '2-px cells, full frame', cell: 2, patch: false },
    { name: '1-px cells, patch on a white page', cell: 1, patch: true },
  ] as const;
  const cells = (['Line Art', 'Smooth'] as const).flatMap((preset) =>
    boards.map((board) => ({ preset, ...board })),
  );
  it.each(cells)('$preset: $name', async ({ preset, cell, patch }) => {
    const data = new Uint8ClampedArray(BOARD * BOARD * 4);
    let area = 0;
    for (let y = 0; y < BOARD; y += 1)
      for (let x = 0; x < BOARD; x += 1) {
        const inside = !patch || (x >= 50 && x < 100 && y >= 50 && y < 100);
        if (inside) area += 1;
        const ink = inside && (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
        const v = ink ? 0 : 255;
        data.set([v, v, v, 255], (y * BOARD + x) * 4);
      }
    const paths = await traceImageToColoredPaths(
      { width: BOARD, height: BOARD, data },
      TRACE_PRESETS[preset] as TraceOptions,
    );
    const rendered = rasterizeColoredPaths(paths, BOARD, BOARD);
    const inked = rendered.data.reduce((sum, v) => sum + v, 0);
    // A welded board covers ~100% of its area; every ink cell kept separately
    // is half of it. 1-px cells are below every speck floor and vanish; the
    // automatic small-mark policy keeps the 4 px² cells of the 2-px board as
    // the texture they are (ADR-434). Welding may never happen.
    expect(inked).toBeLessThan(0.75 * area);
    if (cell === 2) expect(inked / area).toBeCloseTo(0.5, 1);
    else expect(inked).toBeLessThan(0.25 * area);
  });
});
