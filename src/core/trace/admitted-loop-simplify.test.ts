import { describe, expect, it } from 'vitest';
import type { ColoredPath, Polyline, Vec2 } from '../scene';
import { signedAreaMm2 } from '../geometry/polyline-orientation';
import { simplifyChain } from './centerline';
import {
  ADMITTED_LOOP_MIN_POINTS,
  admittedLoopEpsilon,
  admittedLoopFallback,
} from './admitted-loop-simplify';
import { closeContour, contourRefinement } from './contour-topology';
import type { RawImageData, TraceOptions } from './trace-image';
import { traceImageToColoredPaths } from './trace-to-paths';
import { TRACE_PRESETS } from './trace-presets';

// A closed sliver ring: out along y = 0, back along y = width.
function sliver(length: number, width: number, step = 0.5): Vec2[] {
  const out: Vec2[] = [];
  for (let x = 0; x <= length; x += step) out.push({ x, y: 0 });
  for (let x = length; x >= 0; x -= step) out.push({ x, y: width });
  return out;
}

describe('admittedLoopFallback', () => {
  it('simplifies a thin measured sliver to a polygon that returns to its start', () => {
    const ring = sliver(80, 1);
    expect(simplifyChain(ring, true, 1.8).length).toBeLessThan(ADMITTED_LOOP_MIN_POINTS);
    expect(admittedLoopEpsilon(ring, 1.8)).toBeDefined();
    const kept = admittedLoopFallback(ring, 1.8);
    expect(kept.polyline.points.length).toBeLessThan(10);
    expect(kept.polyline.points.length).toBeGreaterThan(ADMITTED_LOOP_MIN_POINTS);
    expect(kept.polyline.points.at(-1)).toEqual(kept.polyline.points[0]);
    // Topology repair steps toward the raw chain: finer polygons, then it.
    expect(kept.refine(1 / 16).points.length).toBeGreaterThanOrEqual(kept.polyline.points.length);
    expect(kept.baseline).toEqual(closeContour(ring));
  });

  it('keeps the raw chain for a speck the polygon would not shrink', () => {
    const speck = sliver(1, 1);
    expect(admittedLoopEpsilon(speck, 1.8)).toBeUndefined();
    const kept = admittedLoopFallback(speck, 1.8);
    const raw = contourRefinement(speck, () => speck);
    expect(kept.polyline).toEqual(raw.polyline);
    expect(kept.baseline).toEqual(raw.baseline);
  });

  it('keeps the raw chain for a zero-area chain', () => {
    const flat = sliver(80, 0);
    expect(admittedLoopEpsilon(flat, 1.8)).toBeUndefined();
  });

  it('pins both caps, so a slanted sliver keeps width at each end', () => {
    // Out along y = 0, back along y = 1 shifted by 1 px: slanted caps.
    const ring = [...sliver(80, 0).slice(0, 161), ...sliver(81, 1).slice(163)];
    const kept = admittedLoopFallback(ring, 1.8).polyline.points;
    for (const end of [0, 81]) {
      const near = kept.filter((p) => Math.abs(p.x - end) <= 1.5);
      expect(new Set(near.map((p) => `${p.x},${p.y}`)).size).toBeGreaterThanOrEqual(2);
    }
  });
});

// ---- end-to-end: 1 px hairlines through the real presets ----

const SIZE = { width: 200, height: 160 };

function blank(fill: number): RawImageData {
  const data = new Uint8ClampedArray(SIZE.width * SIZE.height * 4).fill(fill);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { ...SIZE, data };
}

function setLuma(image: RawImageData, x: number, y: number, value: number): void {
  image.data.set([value, value, value, 255], 4 * (y * image.width + x));
}

const START = { x: 30, y: 40 };
const RUN = 57; // 57 px per axis: an 80 px 45 degree line.

function binaryDiagonal(image: RawImageData, value: number): void {
  for (let i = 0; i < RUN; i += 1) setLuma(image, START.x + i, START.y + i, value);
}

// Anti-aliased 1 px wide 45 degree band, `offset` px across the binary
// line's centre: area coverage from an 8x8 supersample of each pixel.
const AA_SUB = 8;
function bandCoverage(x: number, y: number, offset: number): number {
  let inside = 0;
  for (let sy = 0; sy < AA_SUB; sy += 1) {
    for (let sx = 0; sx < AA_SUB; sx += 1) {
      const px = x + (sx + 0.5) / AA_SUB - START.x - 0.5;
      const py = y + (sy + 0.5) / AA_SUB - START.y - 0.5;
      const along = (px + py) / Math.SQRT2;
      const across = (px - py) / Math.SQRT2 - offset;
      if (Math.abs(across) <= 0.5 && along >= 0 && along <= (RUN - 1) * Math.SQRT2) inside += 1;
    }
  }
  return inside / (AA_SUB * AA_SUB);
}

function antiAliasedDiagonal(image: RawImageData, offset: number): void {
  for (let y = START.y - 2; y < START.y + RUN + 2; y += 1) {
    for (let x = START.x - 2; x < START.x + RUN + 2; x += 1) {
      const coverage = bandCoverage(x, y, offset);
      if (coverage > 0) setLuma(image, x, y, Math.round(255 * (1 - coverage)));
    }
  }
}

function rect(image: RawImageData, x0: number, y0: number, w: number, h: number): void {
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) setLuma(image, x, y, 0);
  }
}

// Extent of a loop along the line direction, over the drawn length.
function spanRatio(loop: Polyline): number {
  const along = loop.points.map((p) => (p.x + p.y) / Math.SQRT2);
  return (Math.max(...along) - Math.min(...along)) / (RUN * Math.SQRT2);
}

function onHairline(loop: Polyline): boolean {
  return loop.points.every(
    (p) =>
      Math.abs(p.x - START.x - (p.y - START.y)) < 4 && p.x > START.x - 4 && p.x < START.x + RUN + 4,
  );
}

// Moves a traced ring costs: its canonical curve's segments when the path
// carries one (compact curves reach the scene, ADR-440; the polyline is only
// their sampling), else its polyline's edges.
const curveMoves = new WeakMap<Polyline, number>();

function ringsWithMoves(paths: ReadonlyArray<ColoredPath>): Polyline[] {
  for (const path of paths) {
    path.polylines.forEach((polyline, index) => {
      const curve = path.curves?.[index];
      curveMoves.set(polyline, curve?.segments.length ?? polyline.points.length - 1);
    });
  }
  return paths.flatMap((path) => path.polylines);
}

function moves(loop: Polyline): number {
  return curveMoves.get(loop) ?? loop.points.length - 1;
}

async function hairlineLoops(image: RawImageData, preset: string): Promise<Polyline[]> {
  const options = TRACE_PRESETS[preset] as TraceOptions;
  const loops = ringsWithMoves(await traceImageToColoredPaths(image, options));
  return loops.filter(onHairline);
}

// Spans measured with the raw-crack fallback these loops used to take
// (457, 229 and 221 points at a10013827); the simplified loop must keep the stroke's full length.
// Sharp's case needs the square: it moves the threshold just enough that the
// band's sliver comes out thinner than twice Sharp's tolerance (221 points).
const SPAN_BEFORE = { smoothBinary: 0.9957, smoothSlit: 0.9912, sharpAa: 0.9491 };

// A 1 px binary line at `degrees` from (30, 40), 80 px long, one pixel per
// step along its major axis.
function binaryLine(image: RawImageData, degrees: number): void {
  const c = Math.cos((degrees * Math.PI) / 180);
  const s = Math.sin((degrees * Math.PI) / 180);
  const steps = Math.round(80 * Math.max(Math.abs(c), Math.abs(s)));
  for (let i = 0; i <= steps; i += 1) {
    if (Math.abs(c) >= Math.abs(s)) setLuma(image, 30 + i, Math.round(40 + (i * s) / c), 0);
    else setLuma(image, Math.round(30 + (i * c) / s), 40 + i, 0);
  }
}

function along(loop: Polyline, degrees: number): number[] {
  const c = Math.cos((degrees * Math.PI) / 180);
  const s = Math.sin((degrees * Math.PI) / 180);
  return loop.points.map((p) => p.x * c + p.y * s);
}

// Loops left of the square (x >= 120): the hairline's.
async function loopsBesideSquare(image: RawImageData, preset: string): Promise<Polyline[]> {
  const options = TRACE_PRESETS[preset] as TraceOptions;
  const loops = ringsWithMoves(await traceImageToColoredPaths(image, options));
  return loops.filter((loop) => loop.points.every((p) => p.x < 115));
}

// Spans (px along the line) of the raw-crack loops at a10013827: 465 points
// for the diagonal beside the square, 457 for the 52 degree line.
const SPAN_BESIDE_SQUARE_BEFORE = { diagonal: 81.388, deg52: 80.5927 };

describe('admitted hairline loops keep a compact outline (ADR-458)', () => {
  it('Smooth: a 1 px binary 45 degree diagonal is one loop of < 40 points', async () => {
    const image = blank(255);
    binaryDiagonal(image, 0);
    const loops = await hairlineLoops(image, 'Smooth');
    expect(loops).toHaveLength(1);
    expect(moves(loops[0]!)).toBeLessThan(40);
    expect(Math.abs(signedAreaMm2(loops[0]!.points))).toBeGreaterThan(0);
    expect(Math.abs(spanRatio(loops[0]!) - SPAN_BEFORE.smoothBinary)).toBeLessThanOrEqual(0.02);
  });

  it('Smooth: a white 1 px slit in black is one hole loop of < 40 points', async () => {
    const image = blank(255);
    rect(image, 10, 10, 180, 140);
    binaryDiagonal(image, 255);
    const loops = await hairlineLoops(image, 'Smooth');
    expect(loops).toHaveLength(1);
    expect(moves(loops[0]!)).toBeLessThan(40);
    expect(Math.abs(spanRatio(loops[0]!) - SPAN_BEFORE.smoothSlit)).toBeLessThanOrEqual(0.02);
  });

  it('Smooth: a 1 px binary diagonal next to a square is one loop of < 40 points', async () => {
    // The square makes Smooth's 2x sliver beaded; no whole halving of the
    // tolerance between "collapsed" and "every bead" keeps its area.
    const image = blank(255);
    binaryLine(image, 45);
    rect(image, 120, 30, 60, 60);
    const loops = await loopsBesideSquare(image, 'Smooth');
    expect(loops).toHaveLength(1);
    expect(moves(loops[0]!)).toBeLessThan(40);
    const span = along(loops[0]!, 45);
    const ratio = (Math.max(...span) - Math.min(...span)) / SPAN_BESIDE_SQUARE_BEFORE.diagonal;
    expect(Math.abs(ratio - 1)).toBeLessThanOrEqual(0.02);
  });

  it('Smooth: a 52 degree hairline next to a square keeps both ends (no wedge)', async () => {
    const image = blank(255);
    binaryLine(image, 52);
    rect(image, 120, 30, 60, 60);
    const loops = await loopsBesideSquare(image, 'Smooth');
    expect(loops).toHaveLength(1);
    const loop = loops[0]!;
    // Geometry-core's compact fit (ADR-440) spends 57 cubics on this beaded
    // 2x sliver (the raw-crack chain it replaced was 457 moves); the no-wedge
    // ends below are the invariant, the bound pins today's cost.
    expect(moves(loop)).toBeLessThan(64);
    const span = along(loop, 52);
    const lo = Math.min(...span);
    const hi = Math.max(...span);
    expect(Math.abs((hi - lo) / SPAN_BESIDE_SQUARE_BEFORE.deg52 - 1)).toBeLessThanOrEqual(0.02);
    for (const end of [lo, hi]) {
      const near = loop.points.filter((_, i) => Math.abs(span[i]! - end) <= 2);
      expect(new Set(near.map((p) => `${p.x},${p.y}`)).size).toBeGreaterThanOrEqual(2);
    }
  });

  it('Sharp: an anti-aliased 1 px diagonal next to a square is one loop of < 40 points', async () => {
    const image = blank(255);
    antiAliasedDiagonal(image, 0);
    rect(image, 120, 30, 60, 60);
    const loops = await hairlineLoops(image, 'Sharp');
    expect(loops).toHaveLength(1);
    expect(moves(loops[0]!)).toBeLessThan(40);
    expect(Math.abs(spanRatio(loops[0]!) - SPAN_BEFORE.sharpAa)).toBeLessThanOrEqual(0.02);
  });
});
