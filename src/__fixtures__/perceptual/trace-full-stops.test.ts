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
import { loadFont, renderText } from './degraded-text';
import { rasterizeColoredPaths } from './rasterize';
import { inkMask, lostMarks, smallMarks } from './text-marks';

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
