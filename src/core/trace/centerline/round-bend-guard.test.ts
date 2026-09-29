// A thick stroke drawn round a curve must keep its curve; the same stroke
// drawn round a sharp corner must keep its corner (ADR-558).

import { describe, expect, it } from 'vitest';
import type { Polyline, Vec2 } from '../../scene';
import type { RawImageData, TraceOptions } from '../trace-image';
import { squaredDistanceField, type InkMask } from './distance-field';
import { bendIsRounded } from './round-bend-guard';
import { sharpenChainBends } from './sharpen-bends';
import { traceCenterlineStrokePaths } from './trace-centerline';

const SIZE = 100;
const RADIUS = 6; // a 12 px stroke
const VERTEX: Vec2 = { x: 60, y: 40 };

const CENTERLINE_OPTIONS: TraceOptions = {
  traceMode: 'centerline',
  numberOfColors: 2,
  pathOmit: 0,
  lineTolerance: 1,
  quadraticTolerance: 1,
  blurRadius: 0,
  blurDelta: 0,
  lineFilter: true,
  fixedPalette: ['#ffffff', '#000000'],
  useOtsuThreshold: true,
  despeckleMinPixels: 4,
  centerlineJoinGapPx: 3,
};

// The pen's path: in along +x to the vertex, out along +y, optionally
// rounded with a circular fillet of the given radius.
function penPath(fillet: number): Vec2[] {
  const start = { x: 10, y: VERTEX.y };
  const end = { x: VERTEX.x, y: 88 };
  if (fillet <= 0) return [start, VERTEX, end];
  const centre = { x: VERTEX.x - fillet, y: VERTEX.y + fillet };
  const arc: Vec2[] = [];
  for (let k = 0; k <= 64; k += 1) {
    const angle = -Math.PI / 2 + (k / 64) * (Math.PI / 2);
    arc.push({ x: centre.x + fillet * Math.cos(angle), y: centre.y + fillet * Math.sin(angle) });
  }
  return [start, ...arc, end];
}

function distanceToPath(p: Vec2, path: ReadonlyArray<Vec2>): number {
  let best = Infinity;
  for (let k = 1; k < path.length; k += 1) {
    const a = path[k - 1]!;
    const b = path[k]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

// Ink wherever a round nib of RADIUS following the path covers the pixel centre.
function strokeMask(path: ReadonlyArray<Vec2>): InkMask {
  const ink = new Uint8Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if (distanceToPath({ x: x + 0.5, y: y + 0.5 }, path) <= RADIUS) ink[y * SIZE + x] = 1;
    }
  }
  return { width: SIZE, height: SIZE, ink };
}

function maskToImage(mask: InkMask): RawImageData {
  const data = new Uint8ClampedArray(mask.width * mask.height * 4).fill(255);
  for (let i = 0; i < mask.ink.length; i += 1) {
    if (mask.ink[i] === 1) data.fill(0, i * 4, i * 4 + 3);
  }
  return { width: mask.width, height: mask.height, data };
}

function traceStroke(fillet: number): ReadonlyArray<Polyline> {
  const image = maskToImage(strokeMask(penPath(fillet)));
  return traceCenterlineStrokePaths(image, CENTERLINE_OPTIONS).flatMap((p) => p.polylines);
}

// Worst distance from the traced line to the pen's path around the bend.
function bendError(polylines: ReadonlyArray<Polyline>, path: ReadonlyArray<Vec2>): number {
  let worst = 0;
  for (const polyline of polylines) {
    for (let k = 1; k < polyline.points.length; k += 1) {
      const a = polyline.points[k - 1]!;
      const b = polyline.points[k]!;
      for (let s = 0; s <= 10; s += 1) {
        const p = { x: a.x + ((b.x - a.x) * s) / 10, y: a.y + ((b.y - a.y) * s) / 10 };
        if (Math.hypot(p.x - VERTEX.x, p.y - VERTEX.y) > 20) continue;
        worst = Math.max(worst, distanceToPath(p, path));
      }
    }
  }
  return worst;
}

describe('centreline bends keep the shape the pen drew', () => {
  it('keeps a rounded bend in a thick stroke round', () => {
    // Fillet of 1.5 stroke radii: its tangent corner stands 3.7 px outside
    // the pen path, where the sharpener used to put a vertex.
    const path = penPath(1.5 * RADIUS);
    const traced = traceStroke(1.5 * RADIUS);
    expect(traced).toHaveLength(1);
    expect(bendError(traced, path)).toBeLessThan(1);
  });

  it('still rebuilds the sharp corner of the same stroke', () => {
    const traced = traceStroke(0);
    expect(traced).toHaveLength(1);
    const nearest = Math.min(
      ...traced[0]!.points.map((p) => Math.hypot(p.x - VERTEX.x, p.y - VERTEX.y)),
    );
    expect(nearest).toBeLessThan(1);
    expect(bendError(traced, penPath(0))).toBeLessThan(1);
  });
});

describe('keepRoundedBends', () => {
  // One chamfered chain (the shape thinning leaves at any concentrated bend)
  // laid over two inks: only the ink tells a drawn corner from a curve.
  function chamferedChain(): Vec2[] {
    const cut = 2;
    const chain: Vec2[] = [];
    for (let x = 10; x <= VERTEX.x - cut; x += 0.5) chain.push({ x, y: VERTEX.y });
    for (let s = 0.5; s < cut; s += 0.5) chain.push({ x: VERTEX.x - cut + s, y: VERTEX.y + s });
    for (let y = VERTEX.y + cut; y <= 88; y += 0.5) chain.push({ x: VERTEX.x, y });
    return chain;
  }

  function cornerOffsets(corners: ReadonlySet<Vec2>): number[] {
    return [...corners].map((c) => Math.hypot(c.x - VERTEX.x, c.y - VERTEX.y));
  }

  it('rebuilds a drawn corner with or without the guard', () => {
    const distSq = squaredDistanceField(strokeMask(penPath(0)));
    for (const options of [undefined, { keepRoundedBends: true }]) {
      const sharpened = sharpenChainBends(
        chamferedChain(),
        false,
        distSq,
        SIZE,
        undefined,
        options,
      );
      expect(cornerOffsets(sharpened.corners)).toHaveLength(1);
      expect(cornerOffsets(sharpened.corners)[0]).toBeLessThan(0.1);
    }
  });

  it('keeps a curve round only when asked', () => {
    // The same corner over the ink of a 1.5-radius fillet stands 3.7 px out
    // on the curve's outside, where the ink is thin.
    const distSq = squaredDistanceField(strokeMask(penPath(1.5 * RADIUS)));
    const plain = sharpenChainBends(chamferedChain(), false, distSq, SIZE);
    const guarded = sharpenChainBends(chamferedChain(), false, distSq, SIZE, undefined, {
      keepRoundedBends: true,
    });
    expect(plain.corners.size).toBe(1);
    expect(guarded.corners.size).toBe(0);
    expect(guarded.points).toEqual(chamferedChain());
  });
});

describe('keepRoundedBends on a ring', () => {
  // A square drawn with the 12 px pen, round at two corners and sharp at the
  // other two, and the chain thinning leaves: every corner cut by the same
  // chamfer, so only the ink says which to rebuild.
  const CORNERS: ReadonlyArray<Vec2> = [
    { x: 25, y: 25 },
    { x: 75, y: 25 },
    { x: 75, y: 75 },
    { x: 25, y: 75 },
  ];
  const ROUND = [false, true, false, true];

  function squarePen(): Vec2[] {
    const path: Vec2[] = [];
    CORNERS.forEach((corner, k) => {
      const before = CORNERS[(k + 3) % 4]!;
      const after = CORNERS[(k + 1) % 4]!;
      if (!ROUND[k]) {
        path.push(corner);
        return;
      }
      // A fillet of 1.5 radii between the two sides.
      const fillet = 1.5 * RADIUS;
      const inDir = { x: Math.sign(corner.x - before.x), y: Math.sign(corner.y - before.y) };
      const outDir = { x: Math.sign(after.x - corner.x), y: Math.sign(after.y - corner.y) };
      const centre = {
        x: corner.x - inDir.x * fillet + outDir.x * fillet,
        y: corner.y - inDir.y * fillet + outDir.y * fillet,
      };
      const start = Math.atan2(
        corner.y - inDir.y * fillet - centre.y,
        corner.x - inDir.x * fillet - centre.x,
      );
      const end = Math.atan2(
        corner.y + outDir.y * fillet - centre.y,
        corner.x + outDir.x * fillet - centre.x,
      );
      let sweep = end - start;
      if (sweep > Math.PI) sweep -= 2 * Math.PI;
      if (sweep < -Math.PI) sweep += 2 * Math.PI;
      for (let s = 0; s <= 32; s += 1) {
        const angle = start + (sweep * s) / 32;
        path.push({
          x: centre.x + fillet * Math.cos(angle),
          y: centre.y + fillet * Math.sin(angle),
        });
      }
    });
    return [...path, path[0]!];
  }

  function chamferedRing(): Vec2[] {
    const cut = 2;
    const ring: Vec2[] = [];
    CORNERS.forEach((corner, k) => {
      const next = CORNERS[(k + 1) % 4]!;
      const dir = { x: Math.sign(next.x - corner.x), y: Math.sign(next.y - corner.y) };
      const nextDir = {
        x: Math.sign(CORNERS[(k + 2) % 4]!.x - next.x),
        y: Math.sign(CORNERS[(k + 2) % 4]!.y - next.y),
      };
      for (let t = cut; t <= 50 - cut; t += 0.5) {
        ring.push({ x: corner.x + dir.x * t, y: corner.y + dir.y * t });
      }
      // The chamfer across the next corner.
      for (let s = 0.5; s < cut; s += 0.5) {
        ring.push({
          x: next.x - dir.x * (cut - s) + nextDir.x * s,
          y: next.y - dir.y * (cut - s) + nextDir.y * s,
        });
      }
    });
    return ring;
  }

  it('rebuilds the drawn corners only, wherever the ring starts', () => {
    const distSq = squaredDistanceField(strokeMask(squarePen()));
    const ring = chamferedRing();
    const key = (p: Vec2): string => `${p.x.toFixed(6)},${p.y.toFixed(6)}`;
    const guarded = (points: ReadonlyArray<Vec2>): string[] =>
      [
        ...sharpenChainBends(points, true, distSq, SIZE, undefined, { keepRoundedBends: true })
          .corners,
      ]
        .map(key)
        .sort();
    const reference = guarded(ring);
    expect(reference).toEqual([key(CORNERS[0]!), key(CORNERS[2]!)].sort());
    expect(sharpenChainBends(ring, true, distSq, SIZE).corners.size).toBe(4);
    for (const offset of [1, 95, 97, Math.floor(ring.length / 2)]) {
      expect(guarded([...ring.slice(offset), ...ring.slice(0, offset)])).toEqual(reference);
    }
  });
});

describe('bendIsRounded', () => {
  it('never rounds a bend sharper than 120 degrees, where the ink thins toward any tip', () => {
    // A 4 px stroke along y = 50 and a vertex just off its ink: the ink alone
    // reads as a rounded bend, which a 90 degree turn keeps, but a letter's
    // apex (an A's top, an N's foot) turns about 140 degrees and keeps its point.
    const ink = new Uint8Array(SIZE * SIZE);
    for (let y = 48; y <= 51; y += 1) ink.fill(1, y * SIZE + 5, y * SIZE + 95);
    const distSq = squaredDistanceField({ width: SIZE, height: SIZE, ink });
    const chain: Vec2[] = [];
    for (let x = 10; x <= 90; x += 1) chain.push({ x, y: 50 });
    const vertex = { x: 43, y: 52.5 };
    const judge = (degrees: number): boolean =>
      bendIsRounded(chain, 31, 35, { vertex, turnRad: (degrees * Math.PI) / 180 }, distSq, SIZE);
    expect(judge(90)).toBe(true);
    expect(judge(120)).toBe(true);
    expect(judge(121)).toBe(false);
    expect(judge(145)).toBe(false);
  });
});
