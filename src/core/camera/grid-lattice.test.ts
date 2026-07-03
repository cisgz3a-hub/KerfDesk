import { describe, expect, it } from 'vitest';
import { pseudoNoise } from './calibrate-fixtures';
import { groupIntoGrid } from './grid-lattice';
import type { CornerCandidate } from './xcorner';

// Candidates for a rows×cols grid under a mild affine warp, with optional
// jitter and decoy points, shuffled deterministically so input order (the
// detector sorts by strength) cannot be what the grouping relies on.
function latticeCandidates(options: {
  readonly rows: number;
  readonly cols: number;
  readonly spacing: number;
  readonly jitterPx?: number;
  readonly decoys?: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  readonly shear?: number;
}): CornerCandidate[] {
  const jitter = options.jitterPx ?? 0;
  const shear = options.shear ?? 0;
  const points: CornerCandidate[] = [];
  let n = 0;
  for (let r = 0; r < options.rows; r += 1) {
    for (let c = 0; c < options.cols; c += 1) {
      n += 1;
      points.push({
        x: 50 + c * options.spacing + r * shear + jitter * pseudoNoise(n),
        y: 60 + r * options.spacing + jitter * pseudoNoise(n + 1000),
        strength: 100 + pseudoNoise(n + 2000),
      });
    }
  }
  for (const d of options.decoys ?? []) points.push({ ...d, strength: 90 });
  // Deterministic interleave so grid order is not the input order.
  return points
    .map((p, index) => ({ p, sort: pseudoNoise(index + 3000) }))
    .sort((a, b) => a.sort - b.sort)
    .map((entry) => entry.p);
}

function stepLength(
  corners: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  from: number,
  to: number,
): number {
  const a = corners[from];
  const b = corners[to];
  if (a === undefined || b === undefined) return Number.NaN;
  return Math.hypot(b.x - a.x, b.y - a.y);
}

describe('groupIntoGrid', () => {
  it('recovers a clean 4×5 lattice row-major from shuffled candidates', () => {
    const candidates = latticeCandidates({ rows: 4, cols: 5, spacing: 30 });
    const result = groupIntoGrid(candidates, { rows: 4, cols: 5 });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.corners).toHaveLength(20);
    // Row-major: stepping one column moves ~spacing in one direction and
    // stepping one row moves ~spacing in the orthogonal one.
    expect(stepLength(result.corners, 0, 1)).toBeCloseTo(30, 0);
    expect(stepLength(result.corners, 0, 5)).toBeCloseTo(30, 0);
  });

  it('survives jitter, shear, and off-lattice decoys', () => {
    const candidates = latticeCandidates({
      rows: 4,
      cols: 5,
      spacing: 30,
      jitterPx: 1.5,
      shear: 4,
      decoys: [
        { x: 5, y: 5 },
        { x: 260, y: 15 },
        { x: 140, y: 75 + 13 }, // near the lattice but off it
      ],
    });
    const result = groupIntoGrid(candidates, { rows: 4, cols: 5 });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.corners).toHaveLength(20);
    for (const corner of result.corners) {
      // Every returned corner is a lattice point, not a decoy.
      expect(corner.y).toBeGreaterThan(40);
      expect(corner.y).toBeLessThan(180);
    }
  });

  it('fails typed when there are too few candidates', () => {
    const candidates = latticeCandidates({ rows: 2, cols: 3, spacing: 30 });
    expect(groupIntoGrid(candidates, { rows: 4, cols: 5 })).toEqual({
      kind: 'failed',
      reason: 'too-few-corners',
    });
  });

  it('fails typed when candidates do not form the requested grid', () => {
    // A 3×3 lattice cannot satisfy a 2×5 request even though counts allow it.
    const candidates = latticeCandidates({ rows: 3, cols: 3, spacing: 30 });
    const result = groupIntoGrid(candidates, { rows: 2, cols: 5 });
    expect(result.kind).toBe('failed');
  });

  it('finds the grid when rows run along the other lattice axis', () => {
    // A 5-rows × 4-cols request against a lattice laid out 4 down × 5 across.
    const candidates = latticeCandidates({ rows: 4, cols: 5, spacing: 30 });
    const result = groupIntoGrid(candidates, { rows: 5, cols: 4 });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.corners).toHaveLength(20);
  });
});
