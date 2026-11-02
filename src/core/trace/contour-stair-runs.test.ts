import { describe, expect, it } from 'vitest';

import type { Vec2 } from '../scene';
import { relaxStairRuns } from './contour-stair-runs';

// The closed mid-crack chain of a staircase climbing `rise` rows over runs of
// `run` px, closed round the rows below it.
function stairChain(run: number, rise: number): Vec2[] {
  const points: Vec2[] = [];
  for (let step = 0; step < rise; step += 1) {
    for (let k = 0; k < run; k += 1) points.push({ x: step * run + k + 0.5, y: step });
    points.push({ x: (step + 1) * run, y: step + 0.5 });
  }
  const end = rise * run;
  for (let y = rise; y < rise + 40; y += 1) points.push({ x: end, y: y + 0.5 });
  for (let x = end - 1; x >= 0; x -= 1) points.push({ x: x + 0.5, y: rise + 40 });
  for (let y = rise + 39; y >= 0; y -= 1) points.push({ x: 0, y: y + 0.5 });
  return points;
}

describe('relaxStairRuns', () => {
  it('moves the points of a long stair run onto the line the stairs measure', () => {
    const relaxed = relaxStairRuns(stairChain(12, 8), new Set());
    // Past the first stair and short of the last, whose ends turn the corner.
    for (const p of relaxed.slice(13, 13 * 7)) {
      expect(Math.abs(p.y - (p.x - 6) / 12)).toBeLessThan(0.05);
    }
  });

  it('leaves short runs as the same objects', () => {
    const chain = stairChain(3, 8);
    const relaxed = relaxStairRuns(chain, new Set());
    relaxed.slice(0, 4 * 7).forEach((p, i) => expect(p).toBe(chain[i]));
  });

  it('never moves a corner', () => {
    const chain = stairChain(12, 8);
    const corner = chain[20] as Vec2;
    expect(relaxStairRuns(chain, new Set([corner]))[20]).toBe(corner);
  });

  it('keeps a long flat side between short rounded ends flat', () => {
    const chain: Vec2[] = [];
    for (let x = 0; x < 100; x += 1) chain.push({ x: x + 0.5, y: 0 });
    chain.push({ x: 100, y: 0.5 }, { x: 100.5, y: 1 }, { x: 101, y: 1.5 });
    for (let y = 2; y < 60; y += 1) chain.push({ x: 101, y: y + 0.5 });
    for (let x = 100; x >= -1; x -= 1) chain.push({ x: x + 0.5, y: 60 });
    for (let y = 59; y >= 2; y -= 1) chain.push({ x: -1, y: y + 0.5 });
    chain.push({ x: -1, y: 1.5 }, { x: -0.5, y: 1 }, { x: 0, y: 0.5 });
    relaxStairRuns(chain, new Set())
      .slice(0, 100)
      .forEach((p) => expect(p.y).toBe(0));
  });
});
