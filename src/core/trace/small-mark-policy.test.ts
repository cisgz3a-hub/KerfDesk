// Automatic small-mark policy (ADR-409): tiny ink marks and tiny paper holes
// are judged on evidence, not a fixed area. The fixtures mirror the bake-off
// cases that forced the design: stipple and paper holes in hatching are the
// same size as the speckle fixture's noise, so area alone cannot separate them.

import { describe, expect, it } from 'vitest';
import { createSmallMarkClassifier } from './small-mark-policy';
import { preprocessForTrace, type RawImageData, type TraceOptions } from './trace-image';
import { TRACE_PRESETS } from './trace-presets';
import { traceImageToColoredPaths } from './trace-to-paths';

const LINE_ART = TRACE_PRESETS['Line Art'] as TraceOptions;
const LEGACY: TraceOptions = { ...LINE_ART, despeckleMinPixels: 12, fillPinholeCracks: true };

type Grey = { readonly width: number; readonly height: number; readonly luma: Float64Array };

function page(width: number, height: number, paper = 255): Grey {
  return { width, height, luma: new Float64Array(width * height).fill(paper) };
}

function paint(g: Grey, x0: number, y0: number, w: number, h: number, luma: number): void {
  for (let y = y0; y < y0 + h; y += 1)
    for (let x = x0; x < x0 + w; x += 1) g.luma[y * g.width + x] = luma;
}

function rgba(g: Grey, noise?: () => number): RawImageData {
  const data = new Uint8ClampedArray(g.width * g.height * 4);
  for (let p = 0; p < g.luma.length; p += 1) {
    for (let c = 0; c < 3; c += 1) data[p * 4 + c] = (g.luma[p] ?? 255) + (noise?.() ?? 0);
    data[p * 4 + 3] = 255;
  }
  return { width: g.width, height: g.height, data };
}

// Deterministic PRNG (mulberry32) for the noise fixtures.
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function inkAt(image: RawImageData, x: number, y: number): boolean {
  return (image.data[(y * image.width + x) * 4] ?? 255) < 128;
}

function inkCount(image: RawImageData, x0 = 0, y0 = 0, w = image.width, h = image.height): number {
  let n = 0;
  for (let y = y0; y < y0 + h; y += 1)
    for (let x = x0; x < x0 + w; x += 1) if (inkAt(image, x, y)) n += 1;
  return n;
}

// Eight-connected ink components (enough to count separate marks here).
function components(image: RawImageData): number {
  const { width, height } = image;
  const seen = new Uint8Array(width * height);
  let count = 0;
  for (let start = 0; start < seen.length; start += 1) {
    if (seen[start] === 1 || !inkAt(image, start % width, Math.floor(start / width))) continue;
    count += 1;
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const p = stack.pop() ?? 0;
      for (const q of inkNeighbours(image, p)) {
        if (seen[q] === 1) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
  }
  return count;
}

function inkNeighbours(image: RawImageData, p: number): number[] {
  const x = p % image.width;
  const y = (p - x) / image.width;
  const out: number[] = [];
  for (let dy = -1; dy <= 1; dy += 1)
    for (let dx = -1; dx <= 1; dx += 1) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= image.width || ny >= image.height) continue;
      if (inkAt(image, nx, ny)) out.push(ny * image.width + nx);
    }
  return out;
}

function onPaper(g: Grey, x0: number, y0: number, size: number): boolean {
  for (let y = y0; y < y0 + size; y += 1)
    for (let x = x0; x < x0 + size; x += 1) if ((g.luma[y * g.width + x] ?? 0) < 200) return false;
  return true;
}

// Rows of 2×2 dots on a 5-px pitch: the owl's stipple / a dotted row.
function stipple(g: Grey, x0: number, y0: number, cols: number, rows: number, luma = 0): void {
  for (let r = 0; r < rows; r += 1)
    for (let c = 0; c < cols; c += 1) paint(g, x0 + c * 5, y0 + r * 5, 2, 2, luma);
}

describe('automatic small-mark policy (Line Art and Smooth default)', () => {
  it('keeps stipple dots the fixed 12 px² despeckle erased', () => {
    const g = page(80, 60);
    stipple(g, 10, 10, 10, 8);
    const image = rgba(g);
    expect(inkCount(preprocessForTrace(image, LINE_ART))).toBe(80 * 4);
    expect(inkCount(preprocessForTrace(image, LEGACY))).toBe(0);
  });

  it.each(['Line Art', 'Smooth'])(
    '%s still removes lone specks and keeps genuine dots (the speckle fixture)',
    (preset) => {
      const g = page(160, 120);
      paint(g, 60, 40, 40, 30, 0); // the "ellipse": one big shape
      const dots = [
        [12, 12],
        [140, 12],
        [12, 100],
      ] as const;
      for (const [x, y] of dots) paint(g, x, y, 5, 4, 0); // 20 px² dots
      const specks = [
        [40, 14, 1],
        [120, 100, 1],
        [30, 60, 2],
        [130, 60, 2],
        [80, 100, 2],
      ] as const;
      for (const [x, y, s] of specks) paint(g, x, y, s, s, 0);
      // Smooth's old fixed 24 px² despeckle erased the 20 px² dots too.
      const cleaned = preprocessForTrace(rgba(g), TRACE_PRESETS[preset] as TraceOptions);
      expect(components(cleaned)).toBe(1 + dots.length);
      for (const [x, y] of dots) expect(inkCount(cleaned, x, y, 5, 4)).toBe(20);
      for (const [x, y, s] of specks) expect(inkCount(cleaned, x, y, s, s)).toBe(0);
    },
  );

  it('keeps a lone 3×3 dot but not a lone 2×2 speck', () => {
    const g = page(60, 40);
    paint(g, 10, 10, 3, 3, 0);
    paint(g, 40, 10, 2, 2, 0);
    const cleaned = preprocessForTrace(rgba(g), LINE_ART);
    expect(inkCount(cleaned, 10, 10, 3, 3)).toBe(9);
    expect(inkCount(cleaned, 40, 10, 2, 2)).toBe(0);
  });

  it('removes faint threshold noise in a mid-tone area even where it is dense', () => {
    // A light-grey patch just above the cut with ±8 noise: every mark it
    // throws below 128 is threshold noise, packed close together.
    const random = seeded(7);
    const g = page(120, 120);
    for (let y = 20; y < 100; y += 1)
      for (let x = 20; x < 100; x += 1) g.luma[y * 120 + x] = 138 + (random() * 2 - 1) * 12;
    const image = rgba(g);
    const raw = preprocessForTrace(image, { ...LINE_ART, despeckleMinPixels: 0 });
    expect(components(raw)).toBeGreaterThan(20);
    const cleaned = preprocessForTrace(image, LINE_ART);
    expect(components(cleaned)).toBeLessThanOrEqual(components(preprocessForTrace(image, LEGACY)));
    expect(components(cleaned)).toBe(0);
  });

  it('adds no specks to a noisy JPEG-like scan (±8 colour noise, faint specks)', () => {
    const random = seeded(11);
    const g = page(200, 140, 244);
    paint(g, 20, 20, 160, 6, 10); // strokes
    paint(g, 20, 20, 6, 100, 10);
    paint(g, 60, 60, 90, 40, 12); // a solid block
    stipple(g, 110, 30, 8, 3, 25); // dark stipple next to the stroke
    // Faint scan specks: dust too light to be ink, some beside the art.
    for (let i = 0; i < 60; i += 1) {
      const x = 2 + Math.floor(random() * 190);
      const y = 2 + Math.floor(random() * 130);
      const size = 1 + Math.floor(random() * 3);
      const tone = 150 + random() * 70;
      if (onPaper(g, x - 1, y - 1, size + 2)) paint(g, x, y, size, size, tone);
    }
    const noise = (): number => Math.round((random() * 2 - 1) * 8);
    const image = rgba(g, noise);
    // The colour noise routes Line Art through local-contrast detection,
    // which does flag the faint specks as ink: with no speck cleanup they
    // are all there.
    const raw = components(preprocessForTrace(image, { ...LINE_ART, despeckleMinPixels: 0 }));
    const legacy = components(preprocessForTrace(image, LEGACY));
    const cleaned = components(preprocessForTrace(image, LINE_ART));
    expect(raw).toBeGreaterThan(legacy + 24 + 20);
    // Strokes + block + the 24 stipple dots (legacy erased the dots), and
    // not one faint speck.
    expect(legacy).toBe(2);
    expect(cleaned).toBe(legacy + 24);
  });

  it('keeps bright paper holes in solid ink and fills faint threshold cracks', () => {
    // Scanned black (luma 40); the cracks sit just above Line Art's cut of
    // 128, as the Arch House H-stem crack does (reach 0.38-0.49 of the span).
    const g = page(80, 50);
    paint(g, 5, 5, 70, 40, 40);
    paint(g, 12, 12, 2, 2, 255); // genuine 4 px² paper hole
    paint(g, 22, 12, 1, 12, 255); // genuine 1-px slot
    paint(g, 32, 12, 1, 1, 255); // 1 px² pinhole: below the floor
    paint(g, 42, 12, 1, 14, 136); // threshold crack (the H-stem defect)
    paint(g, 52, 12, 2, 2, 140); // threshold tick hole
    const image = rgba(g);
    const cleaned = preprocessForTrace(image, LINE_ART);
    expect(inkCount(cleaned, 12, 12, 2, 2)).toBe(0);
    expect(inkCount(cleaned, 22, 12, 1, 12)).toBe(0);
    expect(inkCount(cleaned, 32, 12, 1, 1)).toBe(1);
    expect(inkCount(cleaned, 42, 12, 1, 14)).toBe(14);
    expect(inkCount(cleaned, 52, 12, 2, 2)).toBe(4);
    // The fixed fill painted every one of them.
    expect(inkCount(preprocessForTrace(image, LEGACY))).toBe(70 * 40);
  });

  it('honours explicit speck and hole values exactly', () => {
    const g = page(80, 60);
    stipple(g, 10, 10, 6, 2);
    paint(g, 10, 30, 60, 20, 0);
    paint(g, 20, 38, 2, 2, 255);
    paint(g, 40, 36, 1, 10, 136);
    const image = rgba(g);
    const erased = preprocessForTrace(image, { ...LINE_ART, despeckleMinPixels: 12 });
    expect(inkCount(erased, 0, 0, 80, 25)).toBe(0);
    const filled = preprocessForTrace(image, { ...LINE_ART, fillPinholeCracks: true });
    expect(inkCount(filled, 10, 30, 60, 20)).toBe(60 * 20);
    expect(inkCount(filled, 0, 0, 80, 25)).toBe(12 * 4); // ink stage stays automatic
    const open = preprocessForTrace(image, { ...LINE_ART, fillPinholeCracks: false });
    expect(inkCount(open, 40, 36, 1, 10)).toBe(0);
    expect(inkCount(open, 20, 38, 2, 2)).toBe(0);
  });

  it('measures areas in source pixels on a supersampled mask', () => {
    // The same 2×2 lone speck and 3×3 lone dot, drawn 2x with areaScale 4.
    const width = 60;
    const height = 30;
    const ink = new Uint8Array(width * height);
    const put = (x0: number, y0: number, s: number): number[] => {
      const region: number[] = [];
      for (let y = y0; y < y0 + s; y += 1)
        for (let x = x0; x < x0 + s; x += 1) {
          ink[y * width + x] = 1;
          region.push(y * width + x);
        }
      return region;
    };
    const speck = put(5, 5, 4);
    const dot = put(30, 5, 6);
    const at = (areaScale: number) =>
      createSmallMarkClassifier({ width, height, ink, field: null, areaScale });
    expect(at(4).keepInkMark(speck, ink)).toBe(false);
    expect(at(4).keepInkMark(dot, ink)).toBe(true);
    // Read as native pixels, the 16 px² speck is no candidate at all.
    expect(speck.length).toBeGreaterThanOrEqual(at(1).inkCandidateAreaPx);
    expect(at(4).inkCandidateAreaPx).toBe(48);
  });

  it('traces the kept stipple as one outline per dot', async () => {
    const g = page(80, 60);
    stipple(g, 10, 10, 10, 8);
    const paths = await traceImageToColoredPaths(rgba(g), LINE_ART);
    const loops = paths.flatMap((path) => path.polylines).filter((p) => p.closed);
    expect(loops).toHaveLength(80);
  });
});
