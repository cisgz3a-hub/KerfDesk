// Every small mark of text, at any angle (rolling audit v9 R2-P1-2 and R2-P1-3;
// ADR-434 Amendment 4). Amendment 3 kept full stops on a horizontal baseline.
// Turned text has one too (R2-P1-2); a colon's top dot sits on none and vetoed
// its bottom dot (R2-P1-3); a stop after 'p' and 'y' has no baseline letter
// within a small stop's reach. Every case runs the Trace dialog's entry with
// the shipped presets, anti-aliased and 1-bit.

import { describe, expect, it } from 'vitest';
import type { ColoredPath } from '../../core/scene';
import { TRACE_PRESETS, traceImageToColoredPaths, type RawImageData } from '../../core/trace';
import { loadFont, renderTurnedText, type RenderedText } from './degraded-text';
import { lostMarks, smallMarks } from './text-marks';

const PRESETS = ['Line Art', 'Smooth'] as const;
const MODES = [true, false] as const;
// A thin stop traced as a 2 px loop is in the output (the audit's own measure).
const KEPT_SHARE = 0.3;
const ROBOTO = { font: 'Roboto-Regular.ttf' };
const TINOS = { font: 'Tinos-Regular.ttf' };
const LIBERATION = { font: 'LiberationSans-Regular.ttf', dir: 'ui/import/pdf-fonts' };
type Face = { readonly font: string; readonly dir?: string };

type Case = {
  readonly face: Face;
  readonly text: string;
  readonly px: number;
  readonly degrees?: number;
  readonly shear?: number;
};

// The marks a preset lost, one line per case and input form.
async function losses(cases: ReadonlyArray<Case>): Promise<string[]> {
  const out: string[] = [];
  for (const { face, text, px, degrees = 0, shear = 0 } of cases) {
    const font = await loadFont(face.font, face.dir);
    for (const antiAliased of MODES) {
      const rendered = renderTurnedText(font, text, px, {
        antiAliased,
        ink: 0,
        paper: 255,
        degrees,
        shear,
      });
      for (const preset of PRESETS) {
        const lost = lostOn(rendered, await trace(rendered.image, preset));
        const form = antiAliased ? 'anti-aliased' : '1-bit';
        if (lost > 0)
          out.push(`${preset}, ${form}, ${face.font} ${px} px ${degrees}°: "${text}" lost ${lost}`);
      }
    }
  }
  return out;
}

function lostOn(rendered: RenderedText, paths: ReadonlyArray<ColoredPath>): number {
  return lostMarks(rendered, paths, smallMarks(rendered.truth), KEPT_SHARE).length;
}

async function trace(
  image: RawImageData,
  preset: (typeof PRESETS)[number],
): Promise<ColoredPath[]> {
  const options = TRACE_PRESETS[preset];
  if (options === undefined) throw new Error(`missing preset ${preset}`);
  return traceImageToColoredPaths(image, options);
}

function across(
  faces: ReadonlyArray<Face>,
  texts: ReadonlyArray<string>,
  sizes: ReadonlyArray<number>,
  extra: { readonly degrees?: number; readonly shear?: number } = {},
): Case[] {
  return faces.flatMap((face) =>
    texts.flatMap((text) => sizes.map((px) => ({ face, text, px, ...extra }))),
  );
}

// From 24 px nothing may go. Under it a mark can be under a pixel or two of
// ink, where the cut or the size floor decides, and Potrace loses marks too:
// `limit` holds the measured count of failing case, form and preset lines, as
// a ratchet.
function expectKept(lines: ReadonlyArray<string>, limit = 0): void {
  const small = lines.filter((line) => / (18|20|22) px /.test(line));
  expect(lines.filter((line) => !small.includes(line))).toEqual([]);
  expect(small.length, small.join(' / ')).toBeLessThanOrEqual(limit);
}

describe('full stops of turned text (R2-P1-2)', () => {
  const SENTENCES = ['Have a good day.', 'Call us today.', 'Your order is ready.'];
  it.each([
    [5, 0],
    [10, 1],
    [45, 0],
    [90, 0],
    [180, 0],
    [270, 0],
  ])('keeps every stop of a line turned %d°', { timeout: 240_000 }, async (degrees, limit) => {
    const cases = across([ROBOTO, LIBERATION], SENTENCES, [20, 24, 28], { degrees });
    expectKept(await losses(cases), limit);
  });

  it('keeps every stop of a skewed scan', { timeout: 240_000 }, async () => {
    const cases = [
      ...across([ROBOTO, LIBERATION], SENTENCES, [20, 24], { degrees: 3, shear: 0.2 }),
      ...across([ROBOTO, LIBERATION], SENTENCES, [20, 24], { degrees: 8, shear: -0.2 }),
    ];
    expectKept(await losses(cases), 4);
  });
});

describe('a colon keeps both dots (R2-P1-3)', () => {
  it('"Scale 1:10" at 18 to 28 px', { timeout: 240_000 }, async () => {
    const cases = across([TINOS, LIBERATION], ['Scale 1:10'], [18, 20, 22, 24, 26, 28]);
    expectKept(await losses(cases), 0);
  });

  it('on a turned line', { timeout: 240_000 }, async () => {
    const cases = [30, 90, 180].flatMap((degrees) =>
      across([TINOS, LIBERATION], ['Scale 1:10', 'Ratio 2:3'], [20, 24], { degrees }),
    );
    expectKept(await losses(cases), 2);
  });
});

describe('a full stop past descenders (R2-P1-3)', () => {
  it(
    '"spy." and "happy.", whose baseline letter a small stop cannot reach',
    { timeout: 240_000 },
    async () => {
      const cases = across([LIBERATION, TINOS], ['spy.', 'happy.'], [22, 24, 26]);
      expectKept(await losses(cases), 0);
    },
  );

  it('"y." alone', { timeout: 120_000 }, async () => {
    expectKept(await losses(across([LIBERATION, TINOS], ['y.'], [22, 24, 26])), 0);
  });
});

// One test per mark family, every family anti-aliased and 1-bit, 18 to 28 px.
describe('sibling marks at 18 to 28 px', () => {
  const SIZES = [18, 20, 22, 24, 26, 28];
  const FAMILIES = [
    ['colons', 'Time: 12:30 Note: yes:', 4],
    ['semicolons', 'yes; try; day; any;', 4],
    ['commas', 'yes, try, day, any,', 0],
    ['apostrophes', "don't it's you're O'Hara", 3],
    ['quotation marks', '"Yes" "day" said "you"', 1],
    ['exclamation marks', 'Yes! try! Hi! Wow!', 7],
    ['question marks', 'Why? try? You? Who?', 2],
    ['i and j dots', 'mini quiz lit jig fig', 6],
    ['decimals', '1.5 2.75 3.14 19.99 0.5', 6],
    ['stops after descenders', 'spy. jpg. egg. gyp. any.', 8],
    ['rows of dots', 'Wait... day... any...', 8],
  ] as const;

  it.each(FAMILIES)('%s', { timeout: 240_000 }, async (_name, text, limit) => {
    expectKept(await losses(across([ROBOTO, LIBERATION], [text], SIZES)), limit);
  });
});
