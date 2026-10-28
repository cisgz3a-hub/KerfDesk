// The tracer's automatic decisions on the inputs users bring (quality audit
// Q4 and Q5, test gap Q5-P3-4). Every case runs the trace entry the Trace
// dialog uses, traceImageToColoredPaths with the shipped presets, and checks
// the traced output itself:
//   - lone 3x3 dots beside a square on a two-level image (Q4-P1-1: Smooth's
//     tied Otsu cut landed at luma 1 and the small-mark tone test then removed
//     every dot; ADR-402 Amendment 1);
//   - i-dots and full stops of 20-28 px text, 1-bit and anti-aliased (Q4-P2-3:
//     the like-mark rule read them as a stroke's halo; ADR-434 Amendment 2);
//   - the counters of slightly blurred and low-resolution small text (Q5-P2-1:
//     the automatic cut sat far toward the paper; ADR-402 Amendment 1);
//   - the astronaut photo with sensor grain (Q5-P2-3: grain sent Smooth and
//     Sharp onto the uneven-lighting route; ADR-402 Amendment 2).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { TRACE_PRESETS, traceImageToColoredPaths } from '../../core/trace';
import type { RawImageData } from '../../core/trace';
import type { TraceReport, TraceSteps } from '../../core/trace/trace-steps';
import { compareMasks } from './compare';
import {
  gaussianBlur,
  greyImage,
  loadFont,
  lowResolution,
  monoGrain,
  renderText,
} from './degraded-text';
import { decodePng } from './png-decode';
import { rasterizeColoredPaths, type Mask } from './rasterize';

type Font = Awaited<ReturnType<typeof loadFont>>;
type PresetName = 'Line Art' | 'Smooth' | 'Sharp';

let roboto: Font;
beforeAll(async () => {
  roboto = await loadFont();
});

describe('lone dots beside a large shape on a two-level image (Q4-P1-1)', () => {
  // A 40 px square and six 3x3 dots, 2-16 px apart, in two flat tones.
  const DOTS = [
    [60, 10],
    [75, 10],
    [90, 10],
    [60, 60],
    [80, 60],
    [105, 40],
  ] as const;
  const dotsPage = (ink: number, paper: number): RawImageData =>
    greyImage(120, 80, (x, y) => {
      const inSquare = x >= 10 && x < 50 && y >= 20 && y < 60;
      const inDot = DOTS.some(([dx, dy]) => x >= dx && x < dx + 3 && y >= dy && y < dy + 3);
      return inSquare || inDot ? ink : paper;
    });

  it.each([
    [0, 255],
    [40, 230],
    [20, 200],
  ])('Smooth, Line Art and Sharp keep every dot on ink %i / paper %i', async (ink, paper) => {
    const image = dotsPage(ink, paper);
    for (const preset of ['Smooth', 'Line Art', 'Sharp'] as const) {
      const traced = (await traceWithReports(image, preset)).mask;
      const kept = DOTS.filter(([x, y]) => covered(traced, x + 1, y + 1));
      expect(kept, preset).toHaveLength(DOTS.length);
    }
  });

  it('cuts a two-level image between its levels, not at luma 1', async () => {
    const { reports } = await traceWithReports(dotsPage(0, 255), 'Smooth');
    expect(reports).toEqual([{ automaticThresholdLuma: 128 }]);
  });
});

describe('i-dots and full stops of small text (Q4-P2-3)', () => {
  const TEXT = 'mini quiz. jig, ii. lit.';

  it.each([20, 24, 28])('Line Art and Smooth keep every one at %i px', async (px) => {
    for (const antiAliased of [true, false]) {
      const { image } = renderText(roboto, TEXT, px, { antiAliased, ink: 0, paper: 255 });
      const marks = smallMarks(image);
      expect(marks.length).toBeGreaterThanOrEqual(11);
      for (const preset of ['Line Art', 'Smooth'] as const) {
        const traced = (await traceWithReports(image, preset)).mask;
        const lost = marks.filter((m) => coveredShare(traced, m) < 0.5);
        expect(lost, `${preset}, ${px} px, ${antiAliased ? 'anti-aliased' : '1-bit'}`).toEqual([]);
      }
    }
  });

  it('keeps the dot of a lone "i" at 28 px', async () => {
    const { image } = renderText(roboto, 'i', 28, { antiAliased: true, ink: 0, paper: 255 });
    const [tittle] = smallMarks(image);
    expect(tittle).toBeDefined();
    for (const preset of ['Line Art', 'Smooth'] as const) {
      const traced = (await traceWithReports(image, preset)).mask;
      expect(coveredShare(traced, tittle ?? []), preset).toBeGreaterThanOrEqual(0.5);
    }
  });
});

describe('letter counters of blurred and low-resolution small text (Q5-P2-1)', () => {
  // Roboto 26 px, ink 20 on paper 245: the audit's counters were 'a', 'e',
  // 'q', 'y' and digit bowls of 18-60 px².
  const TEXT = 'quality trace 0123456789 &?';
  let clean: ReturnType<typeof renderText>;
  beforeAll(() => {
    clean = renderText(roboto, TEXT, 26, { antiAliased: true, ink: 20, paper: 245 });
  });

  it.each(['Smooth', 'Sharp'] as const)(
    '%s keeps every counter and the stroke weight on σ 1 blur',
    async (preset) => {
      const { mask } = await traceWithReports(gaussianBlur(clean.image, 1), preset);
      // Before: Smooth kept 6 and Sharp 9 of the 12 counters, strokes about
      // 50% heavy; now 12 and 12, +21% and +13%.
      const counters = truthCounters(clean.truth);
      expect(counters).toHaveLength(12);
      expect(keptCounters(mask, counters, clean.truth)).toBe(counters.length);
      expect(Math.abs(inkArea(mask) / truthArea(clean) - 1)).toBeLessThan(0.25);
    },
  );

  it.each(['Smooth', 'Sharp'] as const)(
    '%s keeps most counters of text enlarged 3x from a low resolution',
    async (preset) => {
      const { mask } = await traceWithReports(lowResolution(clean.image, 3), preset);
      // Before: 1 of 12 counters kept, letters merged, strokes +85%. The
      // strokes never reach the ink level here, so the ink plateau read from
      // them is pale and a few small counters still close (7-9 kept).
      const counters = truthCounters(clean.truth);
      expect(keptCounters(mask, counters, clean.truth)).toBeGreaterThanOrEqual(7);
      expect(Math.abs(inkArea(mask) / truthArea(clean) - 1)).toBeLessThan(0.3);
    },
  );
});

describe('the astronaut photo with sensor grain (Q5-P2-3)', () => {
  const astronaut = decodePng(
    readFileSync(resolve('src/__fixtures__/perceptual/assets/astronaut.png')),
  );

  it.each(['Smooth', 'Sharp'] as const)(
    '%s traces the grainy photo as the clean one and reports a plain cut',
    async (preset) => {
      const base = await traceWithReports(astronaut, preset);
      // Grain draws that each passed the old gate (51-53% paper cells).
      for (const [sigma, seed] of [
        [3, 7],
        [3, 1234],
        [1.5, 1234],
      ] as const) {
        const grainy = await traceWithReports(monoGrain(astronaut, sigma, seed), preset);
        expect(grainy.reports.some((r) => r.lightingLevelled === true)).toBe(false);
        // Before: IoU 0.70-0.73 (121 -> 829 Smooth subpaths).
        expect(compareMasks(grainy.mask, base.mask).iou, `σ ${sigma} #${seed}`).toBeGreaterThan(
          0.95,
        );
      }
    },
    120_000,
  );
});

async function traceWithReports(
  image: RawImageData,
  preset: PresetName,
): Promise<{ readonly mask: Mask; readonly reports: TraceReport[] }> {
  const reports: TraceReport[] = [];
  const run = <T>(steps: TraceSteps<T>): T => {
    for (;;) {
      const step = steps.next(false);
      if (step.done) return step.value;
      if (step.value !== undefined) reports.push(step.value);
    }
  };
  const options = TRACE_PRESETS[preset];
  if (options === undefined) throw new Error(`missing preset ${preset}`);
  const paths = await traceImageToColoredPaths(image, options, run);
  return { mask: rasterizeColoredPaths(paths, image.width, image.height), reports };
}

// Eight-connected ink marks under 12 px² in the image's own luma <= 128
// mask: the i-dots, full stops and comma tails the audit counted.
function smallMarks(image: RawImageData): number[][] {
  const ink = new Uint8Array(image.width * image.height);
  for (let p = 0; p < ink.length; p += 1) ink[p] = (image.data[p * 4] ?? 255) <= 128 ? 1 : 0;
  return components(ink, image.width, image.height, 1, 8).filter((c) => c.length < 12);
}

function coveredShare(mask: Mask, pixels: ReadonlyArray<number>): number {
  if (pixels.length === 0) return 0;
  return pixels.filter((p) => mask.data[p] === 1).length / pixels.length;
}

function covered(mask: Mask, x: number, y: number): boolean {
  return mask.data[y * mask.width + x] === 1;
}

function inkArea(mask: Mask): number {
  return mask.data.reduce((sum, v) => sum + v, 0);
}

// The glyphs' own ink area in pixels (their 4 x 4 samples / 16).
function truthArea(rendered: { readonly truth: Mask; readonly image: RawImageData }): number {
  const samples = (rendered.truth.width / rendered.image.width) ** 2;
  return inkArea(rendered.truth) / samples;
}

// The glyphs' counters: enclosed paper regions (four-connected paper that
// does not reach the border, the dual of eight-connected ink) of the 4 x 4
// sample truth.
function truthCounters(fine: Mask): number[][] {
  const paper = fine.data.map((v) => (v === 1 ? 0 : 1));
  return components(paper, fine.width, fine.height, 1, 4).filter(
    (c) =>
      !c.some((p) => {
        const x = p % fine.width;
        const y = (p - x) / fine.width;
        return x === 0 || y === 0 || x === fine.width - 1 || y === fine.height - 1;
      }),
  );
}

// A counter is kept when at least half of it stays paper in the trace (the
// audit's rule), read at the trace's pixel resolution.
function keptCounters(mask: Mask, counters: ReadonlyArray<number[]>, fine: Mask): number {
  const k = fine.width / mask.width;
  return counters.filter((counter) => {
    const paper = counter.filter((q) => {
      const x = Math.floor((q % fine.width) / k);
      const y = Math.floor(Math.floor(q / fine.width) / k);
      return mask.data[y * mask.width + x] !== 1;
    });
    return paper.length * 2 >= counter.length;
  }).length;
}

function components(
  values: Uint8Array,
  width: number,
  height: number,
  value: number,
  connectivity: 4 | 8,
): number[][] {
  const seen = new Uint8Array(values.length);
  const out: number[][] = [];
  for (let start = 0; start < values.length; start += 1) {
    if (seen[start] === 1 || values[start] !== value) continue;
    const pixels: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const p = stack.pop() ?? 0;
      pixels.push(p);
      for (const q of neighbours(p, width, height, connectivity)) {
        if (seen[q] === 1 || values[q] !== value) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    out.push(pixels);
  }
  return out;
}

const STEPS_4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
const STEPS_8 = [...STEPS_4, [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

function neighbours(p: number, width: number, height: number, connectivity: 4 | 8): number[] {
  const x = p % width;
  const y = (p - x) / width;
  return (connectivity === 4 ? STEPS_4 : STEPS_8)
    .map(([dx, dy]) => [x + dx, y + dy] as const)
    .filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < width && ny < height)
    .map(([nx, ny]) => ny * width + nx);
}
