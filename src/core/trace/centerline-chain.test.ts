import { describe, expect, it } from 'vitest';
import { chainBranches } from './centerline-chain';

type P = { readonly x: number; readonly y: number };

function horiz(x0: number, x1: number, y: number): P[] {
  const out: P[] = [];
  const step = x0 <= x1 ? 1 : -1;
  for (let x = x0; x !== x1 + step; x += step) out.push({ x, y });
  return out;
}

function vert(y0: number, y1: number, x: number): P[] {
  const out: P[] = [];
  const step = y0 <= y1 ? 1 : -1;
  for (let y = y0; y !== y1 + step; y += step) out.push({ x, y });
  return out;
}

describe('chainBranches', () => {
  it('keeps a lone branch as one polyline', () => {
    expect(chainBranches([horiz(0, 5, 0)]).length).toBe(1);
  });

  it('chains two branches that share a node into one connected polyline', () => {
    const chains = chainBranches([horiz(0, 5, 0), horiz(5, 10, 0)]);
    expect(chains).toHaveLength(1);
    expect(chains[0]!.length).toBeGreaterThan(8);
  });

  it('pairs the straight-through edges at a cross — two strokes, not four stubs', () => {
    const chains = chainBranches([
      horiz(5, 0, 5), // left arm  (start at centre 5,5)
      horiz(5, 10, 5), // right arm
      vert(5, 0, 5), // up arm
      vert(5, 10, 5), // down arm
    ]);
    expect(chains).toHaveLength(2);
  });

  it('bridges a multi-pixel junction cluster (adjacent, not identical, end pixels)', () => {
    // Ends (5,0) and (6,0) are 1px apart — the Zhang-Suen cluster case.
    const chains = chainBranches([horiz(0, 5, 0), horiz(6, 11, 0)]);
    expect(chains).toHaveLength(1);
  });
});
