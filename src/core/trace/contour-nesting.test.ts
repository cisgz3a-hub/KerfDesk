import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import { traceBoundaryLoops } from './contour-boundary';
import {
  forestDepths,
  keptForest,
  latticeLoopParents,
  preOrderForest,
  type LatticeLoop,
} from './contour-nesting';
import { createSaddleResolver } from './saddle-connectivity';

type Mask = { readonly width: number; readonly height: number; readonly ink: Uint8Array };

function maskOf(width: number, height: number, ink: (x: number, y: number) => boolean): Mask {
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data[y * width + x] = ink(x, y) ? 1 : 0;
  }
  return { width, height, ink: data };
}

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Independent reference: a loop's probe is the midpoint of one of its
// vertical cracks (on no other loop), tested by ray casting against every
// larger loop; the parent is the smallest loop that contains it.
function bruteForceParents(loops: ReadonlyArray<LatticeLoop>): number[] {
  const probeOf = (points: ReadonlyArray<Vec2>): Vec2 => {
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i] as Vec2;
      const b = points[(i + 1) % points.length] as Vec2;
      if (a.x === b.x) return { x: a.x, y: (a.y + b.y) / 2 };
    }
    throw new Error('loop without a vertical crack');
  };
  const inside = (p: Vec2, ring: ReadonlyArray<Vec2>): boolean => {
    let odd = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const a = ring[j] as Vec2;
      const b = ring[i] as Vec2;
      if (a.x !== b.x || a.y > p.y === b.y > p.y) continue;
      if (a.x > p.x) odd = !odd;
    }
    return odd;
  };
  return loops.map((loop, index) => {
    const probe = probeOf(loop.points);
    let parent = -1;
    loops.forEach((other, candidate) => {
      if (candidate === index || !inside(probe, other.points)) return;
      const smaller = parent < 0 || Math.abs(other.area) < Math.abs(loops[parent]!.area);
      if (smaller) parent = candidate;
    });
    return parent;
  });
}

describe('latticeLoopParents', () => {
  it('nests six alternating square bands one inside the next', () => {
    const size = 60;
    const mask = maskOf(size, size, (x, y) => {
      const band = Math.floor(Math.max(Math.abs(x + 0.5 - 30), Math.abs(y + 0.5 - 30)) / 4);
      return band <= 5 && band % 2 === 1;
    });
    const loops = traceBoundaryLoops(mask);
    expect(loops).toHaveLength(6);
    const parents = latticeLoopParents(loops);
    expect(parents).not.toBeNull();
    const depths = forestDepths(parents!)!;
    expect([...depths].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    // Depth parity is orientation: outers positive (clockwise on screen).
    loops.forEach((loop, index) => expect(loop.area > 0).toBe(depths[index]! % 2 === 0));
  });

  it('keeps diagonally touching pixels apart under both saddle policies', () => {
    // A checkerboard block: every interior corner is a saddle.
    const mask = maskOf(
      12,
      12,
      (x, y) => x >= 2 && x < 10 && y >= 2 && y < 10 && (x + y) % 2 === 0,
    );
    for (const policy of ['connect-ink', 'connect-paper'] as const) {
      const loops = traceBoundaryLoops(mask, createSaddleResolver(mask, policy));
      const parents = latticeLoopParents(loops);
      expect(parents).not.toBeNull();
      expect([...parents!]).toEqual(bruteForceParents(loops));
    }
  });

  it('matches a brute-force containment reference on random blob fields', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const next = random(seed);
      const blobs = Array.from({ length: 40 }, () => ({
        x: next() * 96,
        y: next() * 96,
        r: 2 + next() * 14,
        hole: next() * 0.7,
      }));
      const mask = maskOf(96, 96, (x, y) => {
        let covers = 0;
        for (const blob of blobs) {
          const d = Math.hypot(x + 0.5 - blob.x, y + 0.5 - blob.y);
          if (d < blob.r && d >= blob.r * blob.hole) covers += 1;
        }
        return covers % 2 === 1;
      });
      for (const policy of ['connect-ink', 'connect-paper', 'auto'] as const) {
        const loops = traceBoundaryLoops(mask, createSaddleResolver(mask, policy));
        const parents = latticeLoopParents(loops);
        expect(parents).not.toBeNull();
        expect([...parents!]).toEqual(bruteForceParents(loops));
      }
    }
  });

  it('refuses loops that are not a lattice boundary set', () => {
    expect(latticeLoopParents([{ points: [{ x: 0.5, y: 0 }], area: 1 }])).toBeNull();
    // Two unit squares that overlap by a column: their spans interleave.
    const unit = (x: number): LatticeLoop => ({
      points: [
        { x, y: 0 },
        { x: x + 1, y: 0 },
        { x: x + 2, y: 0 },
        { x: x + 2, y: 1 },
        { x: x + 1, y: 1 },
        { x, y: 1 },
      ],
      area: 2,
    });
    expect(latticeLoopParents([unit(0), unit(1)])).toBeNull();
  });
});

describe('forest helpers', () => {
  it('re-parents kept loops to their nearest kept ancestor', () => {
    // 0 ⊃ 1 ⊃ 2 ⊃ 3; loop 1 dropped.
    expect([...keptForest([-1, 0, 1, 2], [0, 2, 3])]).toEqual([-1, 0, 1]);
    expect([...keptForest([-1, 0, 1, 2], [2, 3])]).toEqual([-1, 0]);
  });

  it('orders every parent before its children, siblings in input order', () => {
    // Scan order: a hole (2) listed before its outer (3), a second root (1).
    const { order, parents } = preOrderForest([-1, -1, 3, -1, 2]);
    expect([...order]).toEqual([0, 1, 3, 2, 4]);
    expect([...parents]).toEqual([-1, -1, -1, 2, 3]);
    parents.forEach((parent, at) => expect(parent).toBeLessThan(at));
  });
});
