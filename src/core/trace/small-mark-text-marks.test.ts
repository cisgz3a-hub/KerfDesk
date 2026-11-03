// Text marks at any angle, and dust that merely lines up with something
// (ADR-434 Amendment 4). Mirrors small-mark-policy.test.ts: synthetic pages
// through the mask cleanup, so each rule is pinned on its own.

import { describe, expect, it } from 'vitest';
import { preprocessForTrace, type RawImageData, type TraceOptions } from './trace-image';
import { TRACE_PRESETS } from './trace-presets';

const LINE_ART = TRACE_PRESETS['Line Art'] as TraceOptions;

type Grey = { readonly width: number; readonly height: number; readonly luma: Float64Array };

function page(width: number, height: number): Grey {
  return { width, height, luma: new Float64Array(width * height).fill(255) };
}

function paint(g: Grey, x0: number, y0: number, w: number, h: number, luma: number): void {
  for (let y = y0; y < y0 + h; y += 1)
    for (let x = x0; x < x0 + w; x += 1) g.luma[y * g.width + x] = luma;
}

function rgba(g: Grey): RawImageData {
  const data = new Uint8ClampedArray(g.width * g.height * 4);
  for (let p = 0; p < g.luma.length; p += 1) {
    for (let c = 0; c < 3; c += 1) data[p * 4 + c] = g.luma[p] ?? 255;
    data[p * 4 + 3] = 255;
  }
  return { width: g.width, height: g.height, data };
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

type Rect = readonly [x: number, y: number, w: number, h: number];

// Turned about (0, 0), then moved to the page's middle.
function toPage(g: { readonly width: number; readonly height: number }, degrees: number) {
  const c = Math.cos((degrees * Math.PI) / 180);
  const s = Math.sin((degrees * Math.PI) / 180);
  const reach = 40;
  return {
    // Line coordinates of a page pixel's centre.
    line: (px: number, py: number): readonly [number, number] => {
      const dx = px + 0.5 - (g.width / 2 - reach * c);
      const dy = py + 0.5 - (g.height / 2 - reach * s);
      return [dx * c + dy * s, -dx * s + dy * c];
    },
  };
}

function paintTurned(g: Grey, degrees: number, x: number, y: number, w: number, h: number): void {
  const { line } = toPage(g, degrees);
  for (let py = 0; py < g.height; py += 1)
    for (let px = 0; px < g.width; px += 1) {
      const [lx, ly] = line(px, py);
      if (lx >= x && lx < x + w && ly >= y && ly < y + h) g.luma[py * g.width + px] = 0;
    }
}

function inkCountTurned(image: RawImageData, degrees: number, [x, y, w, h]: Rect): number {
  const { line } = toPage(image, degrees);
  let n = 0;
  for (let py = 0; py < image.height; py += 1)
    for (let px = 0; px < image.width; px += 1) {
      const [lx, ly] = line(px, py);
      if (lx >= x && lx < x + w && ly >= y && ly < y + h && inkAt(image, px, py)) n += 1;
    }
  return n;
}

describe('text marks at any angle, and dust that lines up', () => {
  // Letters 10 tall and a dot, drawn upright around (0, 0) and turned about
  // it: x runs along the line, y down from the baseline's foot at y = 0.
  const LETTERS = [0, 9, 18, 27, 36, 45];
  const turned = (degrees: number, marks: ReadonlyArray<Rect>): RawImageData => {
    const g = page(160, 160);
    for (const x of LETTERS) paintTurned(g, degrees, x, -10, 6, 10);
    for (const [x, y, w, h] of marks) paintTurned(g, degrees, x, y, w, h);
    return rgba(g);
  };
  const inkOfMark = (image: RawImageData, degrees: number, mark: Rect): number =>
    inkCountTurned(image, degrees, mark);
  const STOP: Rect = [58, -2.7, 2.7, 2.7];

  it.each([5, 30, 45, 90, 135, 180, 270])('keeps a stop on a line turned %d°', (degrees) => {
    const cleaned = preprocessForTrace(turned(degrees, [STOP]), LINE_ART);
    expect(inkOfMark(cleaned, degrees, STOP)).toBeGreaterThanOrEqual(4);
  });

  it.each([0, 5, 30, 45, 90, 180])('removes a speck off the line at %d°', (degrees) => {
    // The same dot 6 px below the baseline and 6 px above the letters' heads.
    for (const speck of [
      [58, 3, 2, 3],
      [58, -19, 2, 3],
    ] as const) {
      const cleaned = preprocessForTrace(turned(degrees, [speck]), LINE_ART);
      expect(inkOfMark(cleaned, degrees, speck)).toBe(0);
    }
  });

  it.each([0, 30, 90])('removes a line of specks with no letters at %d°', (degrees) => {
    const g = page(200, 200);
    const specks: Rect[] = [0, 1, 2, 3, 4, 5, 6].map((i) => [i * 20, 0, 2, 3]);
    for (const [x, y, w, h] of specks) paintTurned(g, degrees, x, y, w, h);
    expect(inkCount(preprocessForTrace(rgba(g), LINE_ART))).toBe(0);
  });

  it('removes a row of specks that lines up with a baseline out of reach', () => {
    // Past the last letter by more than a dozen dot heights.
    const specks: Rect[] = [100, 120, 140].map((x) => [x, -3, 2, 3]);
    const g = page(240, 40);
    for (const x of LETTERS) paint(g, 10 + x, 10, 6, 10, 0);
    for (const [x] of specks) paint(g, 10 + x, 17, 2, 3, 0);
    const cleaned = preprocessForTrace(rgba(g), LINE_ART);
    for (const [x] of specks) expect(inkCount(cleaned, 10 + x, 17, 2, 3)).toBe(0);
  });

  it.each([0, 30, 90, 180])('keeps both dots of a colon at %d°', (degrees) => {
    const dots: Rect[] = [
      [58, -2.7, 2.7, 2.7],
      [58, -12, 2.7, 2.7],
    ];
    const cleaned = preprocessForTrace(turned(degrees, dots), LINE_ART);
    for (const dot of dots) expect(inkOfMark(cleaned, degrees, dot)).toBeGreaterThanOrEqual(4);
  });

  it('removes two stacked specks with no baseline to stand on', () => {
    const g = page(120, 60);
    paint(g, 60, 20, 2, 3, 0);
    paint(g, 60, 31, 2, 3, 0);
    expect(inkCount(preprocessForTrace(rgba(g), LINE_ART))).toBe(0);
  });

  it('removes a speck above a stop, too far above to be its colon', () => {
    const dots: Rect[] = [
      [58, -3, 2, 3],
      [58, -30, 2, 3],
    ];
    const cleaned = preprocessForTrace(turned(0, dots), LINE_ART);
    expect(inkOfMark(cleaned, 0, [58, -30, 2, 3])).toBe(0);
  });

  // A 'p': bowl over the baseline, one thin stem on below it, and a stop
  // past it with no baseline letter in reach. The same box with no narrowing
  // (a tall block) holds no baseline at the dot's foot.
  const beside = (letter: (g: Grey) => void): RawImageData => {
    const g = page(70, 50);
    letter(g);
    paint(g, 21, 25, 2, 2, 0);
    return rgba(g);
  };
  const PEE = (g: Grey): void => {
    paint(g, 10, 15, 9, 12, 0);
    paint(g, 10, 27, 2, 6, 0);
  };
  const BLOCK = (g: Grey): void => paint(g, 10, 15, 9, 18, 0);

  it('keeps a stop just past a descender, not the same dot past a block', () => {
    expect(inkCount(preprocessForTrace(beside(PEE), LINE_ART), 21, 25, 2, 2)).toBe(4);
    expect(inkCount(preprocessForTrace(beside(BLOCK), LINE_ART), 21, 25, 2, 2)).toBe(0);
  });

  // A letter's own sub-floor piece (a 1-bit tittle, a tail's tip) is not dust
  // against the stop beside it; a sub-floor speck out on the paper is.
  it('counts a sub-floor speck as dust only away from letters', () => {
    const draw = (speckX: number, speckY: number): RawImageData => {
      const g = page(120, 60);
      for (const x of [10, 19, 28]) paint(g, x, 20, 6, 10, 0);
      paint(g, 40, 27, 2, 3, 0);
      paint(g, speckX, speckY, 2, 1, 0);
      return rgba(g);
    };
    const stop = (image: RawImageData): number =>
      inkCount(preprocessForTrace(image, LINE_ART), 40, 27, 2, 3);
    expect(stop(draw(19, 17))).toBe(6); // two px above a letter
    expect(stop(draw(48, 40))).toBe(0); // clean paper
  });
});
