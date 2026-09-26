// Line + fill trace (ADR-454): thin pen lines burn once down their centre,
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

const HYBRID = { ...TRACE_PRESETS['Centerline'], traceMode: 'hybrid', hybridMaxStrokeWidthPx: 4 } as const;

function strokes(paths: ReadonlyArray<ColoredPath>): ColoredPath[] {
  return paths.filter((p) => p.color === HYBRID_STROKE_COLOR);
}

function fills(paths: ReadonlyArray<ColoredPath>): ColoredPath[] {
  return paths.filter((p) => p.color === HYBRID_FILL_COLOR);
}

function bbox(points: ReadonlyArray<Vec2>): { minX: number; maxX: number; minY: number; maxY: number } {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
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
        segments: [{ kind: 'cubic', control1: { x: 5, y: 10 }, control2: { x: 15, y: 10 }, to: { x: 20, y: 0 } }],
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
    // Reaches the block (its left edge is x = 100) and stops on the fill
    // outline, which bulges at most a pixel into the pen line there.
    const outline = fills(paths).flatMap((p) => p.polylines)[0]?.points ?? [];
    const end = { x: box.maxX, y: 50.5 };
    const gap = Math.min(...outline.map((p) => Math.hypot(p.x - end.x, p.y - end.y)));
    expect(box.maxX).toBeGreaterThanOrEqual(98.5);
    expect(box.maxX).toBeLessThanOrEqual(101);
    expect(gap).toBeLessThan(1);
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
});
