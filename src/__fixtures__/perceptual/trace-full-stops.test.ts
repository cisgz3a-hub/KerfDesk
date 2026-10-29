// Full stops and i-dots of everyday text (rolling audit v8 N8-P2-1 and
// N8-P2-2; ADR-434 Amendment 3). Q4-P2-3's test sentence put every full stop
// beside an 'i' or a 'z'; these put them where ordinary text does:
//   - at a sentence's end after a letter with no ink at its foot ('y', '7',
//     'V'), in Roboto, Tinos and the Arial-metric Liberation Sans, anti-aliased
//     (the stop was read as a lone speck and vetoed itself, or failed the pen
//     width on the 2x grid);
//   - after each of 61 letters and digits;
//   - in a 1-bit word small enough for the 3x small-source route (the i-dot's
//     coverage summed to 26.999999999999989 against a floor of 27, and the
//     dropped dot then counted as dust against the stop beside it).
// Every case runs the Trace dialog's entry, traceImageToColoredPaths with the
// shipped presets. An anti-aliased mark is judged on its own ink: the trace
// must cover at least half of the glyph's 4 x 4 samples inside the mark, so a
// 2 px stop at a half-pixel phase is not judged on which pixel centres it
// happens to cover. A 1-bit mark is judged on its own pixels.

import { describe, expect, it } from 'vitest';
import type { ColoredPath } from '../../core/scene';
import { TRACE_PRESETS, traceImageToColoredPaths, type RawImageData } from '../../core/trace';
import { loadFont, renderText, type RenderedText } from './degraded-text';
import { rasterizeColoredPaths, type Mask } from './rasterize';

const PRESETS = ['Line Art', 'Smooth'] as const;
const SIZES = [20, 24, 28] as const;
// Each sentence's final stop was dropped by Line Art and Smooth on main
// 33bc394c6 at 20, 24 and 28 px, except where a font's own row says otherwise.
const SENTENCES = [
  { font: 'Roboto-Regular.ttf', text: ['Have a good day.', 'Call us today.', 'Opens at 7.'] },
  { font: 'Tinos-Regular.ttf', text: ['Opens at 7.', 'Turn left at TV.'] },
  {
    font: 'LiberationSans-Regular.ttf',
    dir: 'ui/import/pdf-fonts',
    text: ['Call us today.', 'Opens at 7.'],
  },
] as const;
const SAMPLES = 4;

describe('the final full stop of everyday sentences (N8-P2-1)', () => {
  it.each(SENTENCES)(
    '$font keeps it at 20, 24 and 28 px',
    { timeout: 60_000 },
    async ({ font, text, ...rest }) => {
      const face = await loadFont(font, 'dir' in rest ? rest.dir : undefined);
      for (const sentence of text) {
        for (const px of SIZES) {
          const rendered = renderText(face, sentence, px, {
            antiAliased: true,
            ink: 0,
            paper: 255,
          });
          const marks = smallMarks(rendered.truth);
          expect(marks, `"${sentence}" ${px} px`).toHaveLength(1);
          for (const preset of PRESETS) {
            const lost = lostMarks(rendered, await trace(rendered.image, preset), marks);
            expect(lost, `${preset}, "${sentence}" ${px} px`).toEqual([]);
          }
        }
      }
    },
  );
});

describe('a full stop after each of 61 letters and digits (N8-P2-1)', () => {
  const STRIP = 'abcdefghjklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    .split('')
    .map((c) => `so ${c}.`)
    .join('  ');
  const CASES = ['Roboto-Regular.ttf', 'Tinos-Regular.ttf'].flatMap((font) =>
    SIZES.map((px) => ({ font, px })),
  );

  it.each(CASES)('$font at $px px keeps every one', { timeout: 120_000 }, async ({ font, px }) => {
    const rendered = renderText(await loadFont(font), STRIP, px, {
      antiAliased: true,
      ink: 0,
      paper: 255,
    });
    const marks = smallMarks(rendered.truth);
    expect(marks).toHaveLength(62); // 61 stops and the 'j' dot
    for (const preset of PRESETS) {
      const lost = lostMarks(rendered, await trace(rendered.image, preset), marks);
      expect(lost, `${preset}, lost at x =`).toEqual([]);
    }
  });
});

describe('the dots of a small 1-bit word at the size floor (N8-P2-2)', () => {
  // 'lit.' at 20 px traces on the 3x small-source grid, where the tittle's
  // ink summed to 26.999999999999989 against the 27 floor.
  it('keeps the tittle and the full stop of "lit." at 20 px', { timeout: 60_000 }, async () => {
    const { image } = renderText(await loadFont(), 'lit.', 20, {
      antiAliased: false,
      ink: 0,
      paper: 255,
    });
    // A 1-bit image is already quantised, so its marks are its own ink
    // pixels: the tittle, the 'i' stem (1 px wide at this size) and the stop.
    const marks = smallMarks(inkMask(image), 1);
    expect(marks).toHaveLength(3);
    for (const preset of PRESETS) {
      const traced = rasterizeColoredPaths(await trace(image, preset), image.width, image.height);
      const lost = marks.filter((m) => m.filter((p) => traced.data[p] === 1).length * 2 < m.length);
      expect(lost, preset).toEqual([]);
    }
  });
});

async function trace(
  image: RawImageData,
  preset: (typeof PRESETS)[number],
): Promise<ColoredPath[]> {
  const options = TRACE_PRESETS[preset];
  if (options === undefined) throw new Error(`missing preset ${preset}`);
  return traceImageToColoredPaths(image, options);
}

// Small marks (i-dots, full stops): eight-connected components under 12 px²
// of ink, on a grid of `samples` x `samples` per pixel.
function smallMarks(mask: Mask, samples = SAMPLES): number[][] {
  return components(mask).filter((c) => c.length < 12 * samples * samples);
}

// The image's own ink, luma <= 128.
function inkMask(image: RawImageData): Mask {
  const data = new Uint8Array(image.width * image.height);
  for (let p = 0; p < data.length; p += 1) data[p] = (image.data[p * 4] ?? 255) <= 128 ? 1 : 0;
  return { width: image.width, height: image.height, data };
}

// The marks the trace covers less than half of, as each mark's leftmost x
// (image px), with the trace rasterised on the truth's own sample grid.
function lostMarks(
  rendered: RenderedText,
  paths: ReadonlyArray<ColoredPath>,
  marks: ReadonlyArray<number[]>,
): number[] {
  const fine = rasterizeColoredPaths(
    paths.map((path) => ({
      ...path,
      polylines: path.polylines.map((pl) => ({
        ...pl,
        points: pl.points.map((p) => ({ x: p.x * SAMPLES, y: p.y * SAMPLES })),
      })),
    })),
    rendered.truth.width,
    rendered.truth.height,
  );
  return marks
    .filter((m) => m.filter((q) => fine.data[q] === 1).length * 2 < m.length)
    .map((m) => Math.floor(Math.min(...m.map((q) => q % fine.width)) / SAMPLES));
}

// Eight-connected components of the mask's ink.
function components(mask: Mask): number[][] {
  const seen = new Uint8Array(mask.data.length);
  const out: number[][] = [];
  for (let start = 0; start < mask.data.length; start += 1) {
    if (seen[start] === 1 || mask.data[start] !== 1) continue;
    const pixels: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const p = stack.pop() ?? 0;
      pixels.push(p);
      for (const q of neighbours(mask, p)) {
        if (seen[q] === 1 || mask.data[q] !== 1) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    out.push(pixels);
  }
  return out;
}

function neighbours(mask: Mask, p: number): number[] {
  const x = p % mask.width;
  const y = (p - x) / mask.width;
  const out: number[] = [];
  for (let ny = Math.max(0, y - 1); ny <= Math.min(mask.height - 1, y + 1); ny += 1)
    for (let nx = Math.max(0, x - 1); nx <= Math.min(mask.width - 1, x + 1); nx += 1)
      if (nx !== x || ny !== y) out.push(ny * mask.width + nx);
  return out;
}
