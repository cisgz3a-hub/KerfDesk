// ADR-393: the automatic (Line Art) detail mask fills light solids that the
// local-contrast test alone would hollow, without filling paper, counters or
// outlined colour fills, and colour promotion needs spatially coherent colour.
import { describe, expect, it } from 'vitest';
import { blank, components, rect } from '../../__fixtures__/auto-detail-trace';
import { rasterizeColoredPaths } from '../../__fixtures__/perceptual/rasterize';
import { shouldUseSketchTrace } from './auto-sketch-trace';
import { prepareTraceForContour, type RawImageData } from './trace-image';
import { TRACE_PRESETS } from './trace-presets';
import { traceImageToColoredPaths } from './trace-to-paths';

const LINE_ART = TRACE_PRESETS['Line Art']!;
const SIZE = 280;
const SQUARE = { x: 40, y: 40, side: 200 };

type Rgb = readonly [number, number, number];

function lcg(seed: number): () => number {
  let state = seed;
  return () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 2 ** 32;
}

function square(rgb: Rgb, noise = 0, seed = 1): RawImageData {
  const image = blank(SIZE, SIZE);
  const rnd = lcg(seed);
  for (let y = SQUARE.y; y < SQUARE.y + SQUARE.side; y++)
    for (let x = SQUARE.x; x < SQUARE.x + SQUARE.side; x++)
      for (let c = 0; c < 3; c++)
        image.data[4 * (y * SIZE + x) + c] = rgb[c]! + Math.round(rnd() * 2 * noise - noise);
  return image;
}

function coverageDisc(rgb: Rgb, radius: number, size: number): RawImageData {
  const image = blank(size, size);
  const c = size / 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++)
          if (Math.hypot(x + (sx + 0.5) / 4 - c, y + (sy + 0.5) / 4 - c) <= radius) hits++;
      const t = hits / 16;
      for (let k = 0; k < 3; k++)
        image.data[4 * (y * size + x) + k] = Math.round(255 * (1 - t) + rgb[k]! * t);
    }
  return image;
}

async function traceSummary(image: RawImageData) {
  const paths = await traceImageToColoredPaths(image, LINE_ART);
  const mask = rasterizeColoredPaths(paths, image.width, image.height);
  let ink = 0;
  for (const v of mask.data) ink += v;
  return { contours: paths.flatMap((p) => p.polylines).length, ink };
}

describe('automatic detail mask fills light solids (ADR-393)', () => {
  // Luma: red 87, blue 67, black 0 already sit in the 0..128 band; gold 160,
  // orange 158, tan 185 and light blue 205 used to trace as a ~7 px ring.
  it.each([
    ['red', [220, 30, 30], 0],
    ['blue', [30, 60, 200], 0],
    ['black', [0, 0, 0], 0],
    ['gold', [212, 160, 23], 0],
    ['orange', [255, 140, 0], 0],
    ['tan', [210, 180, 140], 0],
    ['light blue', [173, 216, 230], 0],
    ['dark grey ±8 noise', [60, 60, 60], 8],
    ['tan ±8 noise', [210, 180, 140], 8],
  ] as const)('%s 200 px square traces as one filled contour', async (_name, rgb, noise) => {
    const { contours, ink } = await traceSummary(square(rgb, noise));
    expect(contours).toBe(1);
    const truth = SQUARE.side * SQUARE.side;
    expect(Math.abs(ink - truth) / truth).toBeLessThan(0.02);
  });

  it('places anti-aliased light solid edges at half coverage', async () => {
    const radius = 60;
    const { contours, ink } = await traceSummary(coverageDisc([212, 160, 23], radius, 180));
    expect(contours).toBe(1);
    const truth = Math.PI * radius * radius;
    expect(Math.abs(ink - truth) / truth).toBeLessThan(0.01);
    const image = coverageDisc([173, 216, 230], radius, 180);
    const { prepared, crackField } = prepareTraceForContour(image, LINE_ART);
    expect(crackField).not.toBeNull();
    for (let y = 0; y < image.height; y++)
      for (let x = 0; x < image.width; x++)
        expect(crackField!.lumaAt(x, y) <= crackField!.thresholdAt(x, y)).toBe(
          prepared.data[4 * (y * image.width + x)]! < 128,
        );
  });

  it('treats a near-paper tint (luma above 245) as paper', async () => {
    const image = square([250, 248, 244]);
    expect(shouldUseSketchTrace(image, LINE_ART)).toBe(false);
    expect((await traceSummary(image)).contours).toBe(0);
  });

  it('keeps paper counters and outlined colour fills open', () => {
    // A thick gold ring: its paper counter must stay a hole.
    const ring = square([212, 160, 23]);
    rect(ring, 100, 100, 80, 80, 255);
    const ringMask = prepareTraceForContour(ring, LINE_ART).prepared;
    expect(components(ringMask, [100, 100, 80, 80], true).pixels).toBe(0);
    expect(components(ringMask, [40, 40, 200, 200], true).pixels).toBe(40000 - 6400);
    // A gold fill inside a black outline stays a hole, as under a global
    // brightness threshold: nothing marks it as a solid on paper.
    const outlined = blank(SIZE, SIZE);
    rect(outlined, 40, 40, 200, 200, 0);
    rect(outlined, 46, 46, 188, 188, [212, 160, 23, 255]);
    const outlinedMask = prepareTraceForContour(outlined, LINE_ART).prepared;
    expect(components(outlinedMask, [60, 60, 160, 160], true).pixels).toBe(0);
  });

  it('does not fill vignetted, noisy paper enclosed by pencil lines', () => {
    const width = 240;
    const image = blank(width, width);
    const rnd = lcg(11);
    for (let y = 0; y < width; y++)
      for (let x = 0; x < width; x++) {
        const shade = 40 * Math.max(0, 1 - Math.hypot(x - 180, y - 180) / 160);
        const line = Math.abs(Math.hypot(x - 160, y - 160) - 50) < 1.2;
        const base = line ? [150, 145, 140] : [245 - shade, 240 - shade, 228 - shade];
        for (let c = 0; c < 3; c++)
          image.data[4 * (y * width + x) + c] = base[c]! + Math.round(rnd() * 24 - 12);
      }
    expect(shouldUseSketchTrace(image, LINE_ART)).toBe(true);
    const { prepared } = prepareTraceForContour(image, LINE_ART);
    let filled = 0;
    for (let y = 0; y < width; y++)
      for (let x = 0; x < width; x++)
        if (Math.hypot(x - 160, y - 160) < 45 && prepared.data[4 * (y * width + x)]! < 128)
          filled++;
    expect(filled).toBe(0);
  });
});

describe('automatic colour promotion needs spatially coherent colour (ADR-393)', () => {
  it('ignores per-pixel chroma noise on grey art', () => {
    for (const grey of [60, 185, 230]) {
      expect(shouldUseSketchTrace(square([grey, grey, grey], 8, grey), LINE_ART)).toBe(false);
    }
  });

  it('still promotes coherent colour patches, strokes and thin lines', () => {
    expect(shouldUseSketchTrace(square([210, 180, 140]), LINE_ART)).toBe(true);
    const line = blank(200, 60);
    rect(line, 10, 30, 190, 1, [212, 160, 23, 255]);
    expect(shouldUseSketchTrace(line, LINE_ART)).toBe(true);
  });
});
