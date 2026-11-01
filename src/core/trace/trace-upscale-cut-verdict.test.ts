import { describe, expect, it } from 'vitest';
import { prepareContourTraceInput } from './contour-input';
import type { RawImageData } from './trace-image';
import { TRACE_PRESETS } from './trace-presets';
import { prepareUpscaledTraceInput } from './trace-upscale-input';

// ADR-402 Amendments 1 and 2: Smooth judges its automatic cut on its source
// grid (the detail pass) and again on the supersampled grid it traces.
// Bilinear enlargement smooths grain and turns the edges of two-level art
// into grey, so the two could disagree, and only the second reached the
// dialog. The enlarged grid now follows the source grid's verdicts, so the
// decisions that shape the trace are the ones it reports.

const SMOOTH = TRACE_PRESETS['Smooth']!;
const W = 240;
const H = 120;

const inLongBar = (x: number, y: number): boolean => y >= 20 && y < 24 && x >= 20 && x < 200;
const inShortBar = (x: number, y: number): boolean => x >= 40 && x < 44 && y >= 30;
const onLongBarRim = (x: number, y: number): boolean =>
  (y === 19 || y === 24) && x >= 20 && x < 200;

// Two bars at luma 60; `edge` grey pixels along the long bar's sides.
function page(paper: (x: number) => number, edge?: number): RawImageData {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y += 1)
    for (let x = 0; x < W; x += 1) {
      let v = Math.round(paper(x));
      if (inLongBar(x, y) || inShortBar(x, y)) v = 60;
      else if (edge !== undefined && onLongBarRim(x, y)) v = edge;
      data.set([v, v, v, 255], (y * W + x) * 4);
    }
  return { width: W, height: H, data };
}

const lit = (x: number): number => 150 + (100 * x) / (W - 1);
const flat = (): number => 240;

describe('the supersampled grid follows the source grid cut verdicts', () => {
  it.each([
    ['an unevenly lit page', page(lit), true],
    ['flat paper', page(flat), false],
  ] as const)('levels lighting on %s as the source grid did', (_name, image, levelled) => {
    const native = prepareContourTraceInput(image, SMOOTH);
    expect(native.cutVerdict?.lightingLevelled).toBe(levelled);
    const enlarged = prepareUpscaledTraceInput(image, SMOOTH, 2, undefined, native);
    expect(enlarged.options.sourceLightingLevelled).toBe(levelled);
    expect(enlarged.contourInput?.report?.lightingLevelled === true).toBe(levelled);
  });

  it.each([
    ['two-level art', page(flat), false],
    ['anti-aliased art', page(flat, 150), true],
  ] as const)(
    'cuts %s at the plateau mid-level as the source grid did',
    (_name, image, plateau) => {
      const native = prepareContourTraceInput(image, SMOOTH);
      expect(native.cutVerdict?.plateauCut).toBe(plateau);
      const enlarged = prepareUpscaledTraceInput(image, SMOOTH, 2, undefined, native);
      expect(enlarged.options.sourcePlateauCut).toBe(plateau);
    },
  );

  it('levels the enlarged grid when the source grid did, whatever its own pixels say', () => {
    const image = page(flat);
    const native = prepareContourTraceInput(image, SMOOTH);
    const levelled = {
      ...native,
      cutVerdict: { lightingLevelled: true, plateauCut: false },
    };
    const enlarged = prepareUpscaledTraceInput(image, SMOOTH, 2, undefined, levelled);
    expect(enlarged.contourInput?.report).toEqual({ lightingLevelled: true });
  });

  it('leaves a grid with no source verdict to judge itself', () => {
    const enlarged = prepareUpscaledTraceInput(page(lit), SMOOTH, 2);
    expect(enlarged.options.sourceLightingLevelled).toBeUndefined();
    expect(enlarged.options.sourcePlateauCut).toBeUndefined();
  });
});
