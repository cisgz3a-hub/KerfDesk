import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../scene';
import { BridgeQueue, type BridgeEnd, type BridgeGap } from './bridge-queue';

type TestChain = { points: Vec2[]; closed: boolean; alive: boolean };

function endPoint(end: BridgeEnd<TestChain>): Vec2 {
  return (end.atStart ? end.chain.points[0] : end.chain.points.at(-1)) as Vec2;
}

// A gap rule that, like the tracer's, depends on each chain's own geometry
// (its length), so a merge changes the verdicts of the joined chain's pairs.
function lengthGatedGap(reach: number): BridgeGap<TestChain> {
  return (a, b) => {
    if (a.chain === b.chain) return null;
    const pa = endPoint(a);
    const pb = endPoint(b);
    const d = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    if (d >= reach) return null;
    return a.chain.points.length + b.chain.points.length > 5 || d < reach / 2 ? d : null;
  };
}

function merge(a: BridgeEnd<TestChain>, b: BridgeEnd<TestChain>): void {
  if (a.atStart) a.chain.points.reverse();
  if (!b.atStart) b.chain.points.reverse();
  a.chain.points.push(...b.chain.points);
  b.chain.alive = false;
  b.chain.points = [];
}

// The plain rescan the queue replaces: every round, the closest pair, ties
// to the first pair in chain order (start before end).
function rescanBridges(chains: TestChain[], gap: BridgeGap<TestChain>): void {
  for (;;) {
    const ends = chains
      .filter((chain) => chain.alive && !chain.closed && chain.points.length >= 2)
      .flatMap((chain) => [
        { chain, atStart: true },
        { chain, atStart: false },
      ]);
    let best: [BridgeEnd<TestChain>, BridgeEnd<TestChain>] | null = null;
    let bestGap = Infinity;
    for (let i = 0; i < ends.length; i += 1) {
      for (let j = i + 1; j < ends.length; j += 1) {
        const d = gap(ends[i] as BridgeEnd<TestChain>, ends[j] as BridgeEnd<TestChain>);
        if (d === null || d >= bestGap) continue;
        bestGap = d;
        best = [ends[i] as BridgeEnd<TestChain>, ends[j] as BridgeEnd<TestChain>];
      }
    }
    if (best === null) return;
    merge(best[0], best[1]);
  }
}

function queueBridges(chains: TestChain[], gap: BridgeGap<TestChain>, reach: number): void {
  const queue = new BridgeQueue(chains, reach, gap);
  const steps = queue.measureAllSteps();
  for (let step = steps.next(false); !step.done; step = steps.next(false));
  for (let pair = queue.take(); pair !== null; pair = queue.take()) {
    merge(pair[0], pair[1]);
    queue.merged(pair[0].chain, pair[1].chain);
  }
}

function randomChains(seed: number, count: number): TestChain[] {
  let state = seed;
  // Coarse coordinates make equal gaps (tie order) common.
  const random = (): number => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return Math.floor((state / 2147483648) * 40) / 2;
  };
  return Array.from({ length: count }, () => {
    const start = { x: random(), y: random() };
    const points = [start];
    const steps = 1 + (random() % 3);
    for (let k = 0; k < steps; k += 1) points.push({ x: random(), y: random() });
    return { points, closed: false, alive: true };
  });
}

describe('bridge queue', () => {
  it('bridges the same pairs in the same order as a full rescan', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const reach = 1 + (seed % 4);
      const expected = randomChains(seed, 30);
      const actual = randomChains(seed, 30);
      rescanBridges(expected, lengthGatedGap(reach));
      queueBridges(actual, lengthGatedGap(reach), reach);
      expect(actual).toEqual(expected);
    }
  });

  it('falls back to every chain when the reach has no grid', () => {
    const expected = randomChains(7, 20);
    const actual = randomChains(7, 20);
    rescanBridges(expected, lengthGatedGap(Infinity));
    queueBridges(actual, lengthGatedGap(Infinity), Infinity);
    expect(actual).toEqual(expected);
  });
});
