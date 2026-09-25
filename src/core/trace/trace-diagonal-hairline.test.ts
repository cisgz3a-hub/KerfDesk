// One-pixel diagonal hairlines through the whole filled-contour pipeline
// (ADR-395). Before the saddle policy, the walker, despeckle and pinhole fill
// all treated ink as four-connected, so every pixel of a 1-px diagonal was
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

// Recall floor 0.9 everywhere except three documented finishing limits
// (connectivity is exact in every cell; ADR-395 "Remaining gaps"):
//  - Line Art, binary 30°/60° (measured 0.826): the small-source 2x path
//    interpolates cracks on a bilinear enlargement of the binary staircase,
//    which pinches the ribbon at each step (loop area 60 of 69 px). Potrace
//    1.16 measures 0.870 on the same mask.
//  - Smooth, AA 30°/60° beside the square (measured 0.887): Smooth's wider
//    simplification tolerance on a sub-pixel-wide ribbon. Potrace 1.16
//    measures 0.863 / 0.887 on the same binarized mask.
function recallFloor(
  preset: PresetName,
  antialiased: boolean,
  degrees: number,
  sq: boolean,
): number {
  if (degrees === 45) return 0.9;
  if (preset === 'Line Art' && !antialiased) return 0.8;
  if (preset === 'Smooth' && antialiased && sq) return 0.85;
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
