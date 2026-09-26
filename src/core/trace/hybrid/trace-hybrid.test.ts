// Line + fill trace (ADR-443): thin pen lines burn once down their centre,
// solid shapes stay filled outlines, and the two meet without a gap.

import { describe, expect, it } from 'vitest';
import type { ColoredPath, Vec2 } from '../../scene';
import type { RawImageData } from '../trace-image';
import { TRACE_PRESETS } from '../trace-presets';
import { clipCurveOutsideRegion } from './clip-stroke-curves';
import { discUnion } from './disc-union';
import { HYBRID_FILL_COLOR, HYBRID_STROKE_COLOR } from './hybrid-paths';
import { traceHybridPaths } from './trace-hybrid';

type Canvas = { readonly width: number; readonly height: number; readonly ink: Uint8Array };

function canvas(width: number, height: number): Canvas {
  return { width, height, ink: new Uint8Array(width * height) };
}

function rect(c: Canvas, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) c.ink[y * c.width + x] = 1;
}

// A pen line of exactly `width` pixels between two centre points.
function pen(c: Canvas, a: Vec2, b: Vec2, width: number): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  for (let y = 0; y < c.height; y += 1)
    for (let x = 0; x < c.width; x += 1) {
      const t = Math.max(0, Math.min(1, ((x + 0.5 - a.x) * dx + (y + 0.5 - a.y) * dy) / len2));
      const d = Math.hypot(x + 0.5 - (a.x + t * dx), y + 0.5 - (a.y + t * dy));
      if (d < width / 2) c.ink[y * c.width + x] = 1;
    }
}

function toImage(c: Canvas): RawImageData {
  const data = new Uint8ClampedArray(c.width * c.height * 4);
  for (let i = 0; i < c.ink.length; i += 1) {
    const v = c.ink[i] === 1 ? 0 : 255;
    data.set([v, v, v, 255], i * 4);
  }
  return { width: c.width, height: c.height, data };
}

const HYBRID = {
  ...TRACE_PRESETS['Centerline']!,
  traceMode: 'hybrid',
  hybridMaxStrokeWidthPx: 4,
} as const;

function strokes(paths: ReadonlyArray<ColoredPath>): ColoredPath[] {
  return paths.filter((p) => p.color === HYBRID_STROKE_COLOR);
}

function fills(paths: ReadonlyArray<ColoredPath>): ColoredPath[] {
  return paths.filter((p) => p.color === HYBRID_FILL_COLOR);
}

function bbox(points: ReadonlyArray<Vec2>): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

describe('disc union', () => {
  it('covers exactly the pixel centres strictly inside each disc', () => {
    const radiusSq = new Float64Array(15 * 15);
    radiusSq[7 * 15 + 7] = 9;
    const covered = discUnion({ width: 15, height: 15, radiusSq });
    for (let y = 0; y < 15; y += 1)
      for (let x = 0; x < 15; x += 1) {
        const inside = (x - 7) ** 2 + (y - 7) ** 2 < 9;
        expect(covered[y * 15 + x] === 1).toBe(inside);
      }
  });
});

describe('stroke clipping', () => {
  it('cuts a line where it enters the region and marks the cut end', () => {
    const inRegion = (p: Vec2): boolean => p.x >= 10;
    const pieces = clipCurveOutsideRegion(
      { start: { x: 0, y: 0 }, segments: [{ kind: 'line', to: { x: 20, y: 0 } }], closed: false },
      inRegion,
    );
    expect(pieces).toHaveLength(1);
    expect(pieces[0]?.startCut).toBe(false);
    expect(pieces[0]?.endCut).toBe(true);
    expect(pieces[0]?.curve.segments.at(-1)?.to.x).toBeCloseTo(10, 1);
  });

  it('keeps a clipped cubic a cubic that still lies on the original curve', () => {
    const pieces = clipCurveOutsideRegion(
      {
        start: { x: 0, y: 0 },
        segments: [
          {
            kind: 'cubic',
            control1: { x: 5, y: 10 },
            control2: { x: 15, y: 10 },
            to: { x: 20, y: 0 },
          },
        ],
        closed: false,
      },
      (p) => p.x > 8 && p.x < 12,
    );
    expect(pieces).toHaveLength(2);
    expect(pieces.every((piece) => piece.curve.segments[0]?.kind === 'cubic')).toBe(true);
    expect(pieces[0]?.curve.segments[0]?.to.x).toBeCloseTo(8, 1);
    expect(pieces[1]?.curve.start.x).toBeCloseTo(12, 1);
  });
});

function distanceToRing(p: Vec2, ring: ReadonlyArray<Vec2>): number {
  let best = Infinity;
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length] ?? a;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(
      0,
      Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)),
    );
    best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  });
  return best;
}

function insideRing(p: Vec2, ring: ReadonlyArray<Vec2>): boolean {
  let inside = false;
  ring.forEach((a, i) => {
    const b = ring[(i + ring.length - 1) % ring.length] ?? a;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  });
  return inside;
}

// Paper between a stroke end and the fill outline, in px (0 when the end
// touches or lies inside the outline; a hair of tolerance for the fit).
function junctionGap(p: Vec2, ring: ReadonlyArray<Vec2>): number {
  if (insideRing(p, ring)) return 0;
  const d = distanceToRing(p, ring);
  return d <= 0.1 ? 0 : d;
}

describe('Line + fill trace', () => {
  // A solid 40 px logo block with a 3 px pen line running into its left
  // side (a T-junction), a free 1 px hairline and a 2 px vertical line.
  function mixedDrawing(): Canvas {
    const c = canvas(170, 120);
    rect(c, 100, 30, 140, 70);
    pen(c, { x: 12, y: 50.5 }, { x: 110, y: 50.5 }, 3);
    pen(c, { x: 15.5, y: 90 }, { x: 80.5, y: 110 }, 1.2);
    pen(c, { x: 60, y: 8 }, { x: 60, y: 40 }, 2);
    return c;
  }

  it('traces the pen lines as single strokes and the logo as one outline', () => {
    const paths = traceHybridPaths(toImage(mixedDrawing()), HYBRID);
    const outlines = fills(paths).flatMap((p) => p.polylines);
    expect(outlines).toHaveLength(1);
    const box = bbox(outlines[0]?.points ?? []);
    // The junction may carry the fill a pixel into the pen line (see below).
    expect(box.minX).toBeGreaterThan(98);
    expect(box.minX).toBeLessThan(100.5);
    expect(box.maxX).toBeCloseTo(140, 0);
    expect(box.minY).toBeCloseTo(30, 0);
    expect(box.maxY).toBeCloseTo(70, 0);
    const lines = strokes(paths).flatMap((p) => p.polylines);
    expect(lines).toHaveLength(3);
    expect(lines.every((line) => !line.closed)).toBe(true);
  });

  it('ends the T-junction stroke on the fill edge: no gap, at most a cap of overlap', () => {
    const paths = traceHybridPaths(toImage(mixedDrawing()), HYBRID);
    const horizontal = strokes(paths)
      .flatMap((p) => p.polylines)
      .find((line) => line.points.every((p) => Math.abs(p.y - 50.5) < 2));
    expect(horizontal).toBeDefined();
    const box = bbox(horizontal?.points ?? []);
    expect(box.minX).toBeLessThan(13);
    // Reaches the block (its left edge is x = 100) and ends inside the fill
    // outline, at most the junction reach (1 px) plus half the pen deep.
    const outline = fills(paths).flatMap((p) => p.polylines)[0]?.points ?? [];
    const end = horizontal?.points.reduce((a, b) => (b.x > a.x ? b : a)) ?? { x: 0, y: 0 };
    expect(box.maxX).toBeGreaterThanOrEqual(99.5);
    expect(box.maxX).toBeLessThanOrEqual(102.5);
    expect(junctionGap(end, outline)).toBe(0);
    expect(distanceToRing(end, outline)).toBeLessThanOrEqual(2.5);
  });

  // A pen line meets a solid block end-on at several angles: the stroke end
  // must touch or enter the fill outline (no strip of paper between them),
  // and never run deeper than the reach plus half its pen.
  it.each([1, 2, 3, 4])('closes the junction of a %i px pen line at any angle', (width) => {
    for (const angle of [0, 20, 45, 70]) {
      const c = canvas(220, 220);
      rect(c, 110, 110, 200, 200);
      const r = (angle * Math.PI) / 180;
      const end = { x: 130, y: 130 };
      const start = { x: end.x - 110 * Math.cos(r), y: end.y - 110 * Math.sin(r) };
      pen(c, { x: Math.max(2, start.x), y: Math.max(2, start.y) }, end, width);
      const paths = traceHybridPaths(toImage(c), HYBRID);
      const outline = fills(paths).flatMap((p) => p.polylines)[0]?.points ?? [];
      const ends = strokes(paths)
        .flatMap((p) => p.polylines)
        .flatMap((line) => [line.points[0], line.points.at(-1)])
        .filter((p): p is Vec2 => p !== undefined);
      if (ends.length === 0) continue; // a 1 px axis line the cleanup absorbs
      const tip = ends.reduce((a, b) => (b.x + b.y > a.x + a.y ? b : a));
      expect(junctionGap(tip, outline), `${width} px at ${angle} deg`).toBe(0);
      expect(distanceToRing(tip, outline)).toBeLessThanOrEqual(1 + width / 2 + 0.25);
    }
  });

  it('gives each constant-width pen line its measured width', () => {
    const paths = traceHybridPaths(toImage(mixedDrawing()), HYBRID);
    const widths = strokes(paths)
      .filter((p) => p.strokeWidthMm !== undefined)
      .flatMap((p) => p.polylines.map(() => p.strokeWidthMm ?? 0))
      .sort((a, b) => a - b);
    expect(widths).toHaveLength(3);
    expect(widths[0]).toBeGreaterThan(0.75);
    expect(widths[0]).toBeLessThan(1.75);
    expect(widths[1]).toBeGreaterThan(1.5);
    expect(widths[1]).toBeLessThan(2.75);
    expect(widths[2]).toBeGreaterThan(2.5);
    expect(widths[2]).toBeLessThan(3.75);
  });

  it('keeps a tapering stroke without a width', () => {
    const c = canvas(120, 40);
    for (let x = 10; x < 110; x += 1) {
      const half = 0.5 + ((x - 10) / 100) * 1.5;
      for (let y = 0; y < 40; y += 1) if (Math.abs(y + 0.5 - 20) < half) c.ink[y * c.width + x] = 1;
    }
    const paths = traceHybridPaths(toImage(c), HYBRID);
    expect(fills(paths)).toHaveLength(0);
    expect(strokes(paths).flatMap((p) => p.polylines)).toHaveLength(1);
    expect(strokes(paths).every((p) => p.strokeWidthMm === undefined)).toBe(true);
  });

  it('turns a pen line wider than the gate into a fill', () => {
    const c = canvas(120, 40);
    pen(c, { x: 10, y: 20 }, { x: 110, y: 20 }, 8);
    const paths = traceHybridPaths(toImage(c), HYBRID);
    expect(strokes(paths)).toHaveLength(0);
    expect(fills(paths).flatMap((p) => p.polylines)).toHaveLength(1);
  });

  // A 5 or 6 px line's centre ridge sits exactly on a pixel-centre radius of
  // 3, short of the 0.5 px seed margin, yet the line is wider than the 4 px
  // gate all along: its long ridge makes it wide.
  it.each([
    { label: '5 px horizontal', y: 20.5, width: 5, angle: 0 },
    { label: '6 px horizontal', y: 20, width: 6, angle: 0 },
    { label: '5 px at 30 degrees', y: 30, width: 5, angle: 30 },
  ])('turns a $label line just over the gate into a fill', ({ y, width, angle }) => {
    const c = canvas(140, 80);
    const r = (angle * Math.PI) / 180;
    const a = { x: 70 - 55 * Math.cos(r), y: y - 55 * Math.sin(r) * 0.4 };
    const b = { x: 70 + 55 * Math.cos(r), y: y + 55 * Math.sin(r) * 0.4 };
    pen(c, a, b, width);
    const paths = traceHybridPaths(toImage(c), HYBRID);
    expect(strokes(paths)).toHaveLength(0);
    expect(fills(paths).flatMap((p) => p.polylines)).toHaveLength(1);
  });

  it('keeps a pen line with a one-pixel blot a single stroke', () => {
    const c = canvas(120, 40);
    rect(c, 10, 18, 110, 22);
    rect(c, 59, 17, 62, 18);
    const paths = traceHybridPaths(toImage(c), HYBRID);
    expect(fills(paths)).toHaveLength(0);
    expect(strokes(paths).flatMap((p) => p.polylines)).toHaveLength(1);
  });
});

describe('Line + fill review fixes', () => {
  // Every pen width a trace carries, in px.
  function widths(paths: ReadonlyArray<ColoredPath>): Array<number | undefined> {
    return strokes(paths).flatMap((p) => p.polylines.map(() => p.strokeWidthMm));
  }

  it('keeps the width of steady 3 px strokes that meet at a T or an I', () => {
    for (const stem of [30, 60, 100]) {
      const t = canvas(120, 140);
      pen(t, { x: 10, y: 20.5 }, { x: 110, y: 20.5 }, 3);
      pen(t, { x: 60.5, y: 20.5 }, { x: 60.5, y: 20.5 + stem }, 3);
      const got = widths(traceHybridPaths(toImage(t), HYBRID));
      expect(got.length).toBeGreaterThanOrEqual(2);
      for (const w of got) expect(w).toBeCloseTo(3, 0);
    }
    const i = canvas(120, 140);
    pen(i, { x: 10, y: 15.5 }, { x: 110, y: 15.5 }, 3);
    pen(i, { x: 10, y: 125.5 }, { x: 110, y: 125.5 }, 3);
    pen(i, { x: 60.5, y: 15.5 }, { x: 60.5, y: 125.5 }, 3);
    const got = widths(traceHybridPaths(toImage(i), HYBRID));
    expect(got.length).toBeGreaterThanOrEqual(3);
    for (const w of got) expect(w).toBeCloseTo(3, 0);
  });

  it('never burns a round dot wider than the gate as an open dash', () => {
    for (const r of [2.5, 2.6, 2.7, 2.8, 2.9, 3.0]) {
      for (const offset of [0, 0.25, 0.5, 0.75]) {
        const c = canvas(20, 20);
        const centre = { x: 10 + offset, y: 10 + offset / 2 };
        pen(c, centre, centre, 2 * r);
        const paths = traceHybridPaths(toImage(c), HYBRID);
        const open = strokes(paths).flatMap((p) => p.polylines.filter((pl) => !pl.closed));
        expect(open, `r=${r} offset=${offset}`).toEqual([]);
        expect(paths.length, `r=${r} offset=${offset}`).toBeGreaterThan(0);
      }
    }
  });

  it('decides a line just over the gate the same way alone and running into a shape', () => {
    for (const deg of [0, 15, 30, 45]) {
      const kinds: string[] = [];
      for (const attached of [false, true]) {
        const c = canvas(140, 100);
        const a = (deg * Math.PI) / 180;
        const end = { x: 20 + 60 * Math.cos(a), y: 50 + 60 * Math.sin(a) };
        pen(c, { x: 20, y: 50 }, end, 4.5);
        if (attached) {
          const ex = Math.round(end.x);
          const ey = Math.round(end.y);
          rect(c, ex - 5, ey - 20, ex + 25, ey + 20);
        }
        const paths = traceHybridPaths(toImage(c), HYBRID);
        for (const w of widths(paths)) if (w !== undefined) expect(w).toBeLessThanOrEqual(4.25);
        kinds.push(strokes(paths).length > 0 ? 'stroke' : 'fill');
      }
      expect(kinds[0], `${deg} deg`).toBe(kinds[1]);
    }
  });

  it('centres a width-carrying stroke on its ink, not on a pixel row', () => {
    for (const [w, centreY] of [
      [2, 45],
      [3, 45.5],
      [4, 45],
    ] as const) {
      const c = canvas(90, 90);
      pen(c, { x: 15, y: centreY }, { x: 75, y: centreY }, w);
      const [path] = strokes(traceHybridPaths(toImage(c), HYBRID));
      expect(path?.strokeWidthMm).toBe(w);
      for (const p of path?.polylines[0]?.points ?? [])
        expect(Math.abs(p.y - centreY)).toBeLessThan(0.2);
      for (const curve of path?.curves ?? []) {
        expect(Math.abs(curve.start.y - centreY)).toBeLessThan(0.2);
      }
    }
  });
});
