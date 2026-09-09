import { expect, it } from 'vitest';
import { WeldFootFinder, type WeldChain } from './weld-foot-finder';

it('ignores crowded stale segments after both endpoints change without overflowing the stack', () => {
  const chains: WeldChain[] = Array.from({ length: 50000 }, () => ({
    points: [
      { x: 0.25, y: 0.25 },
      { x: 0.75, y: 0.75 },
    ],
    alive: true,
    closed: false,
  }));
  const own = chains[0];
  if (own === undefined) throw new Error('Missing query owner');
  const finder = new WeldFootFinder(chains, 4);
  const query = { x: 0.5, y: 0.5 };
  expect(finder.nearestFootOnOthers(query, own, 4)).toEqual(query);
  for (const chain of chains) {
    chain.points[0] = { x: 0.25, y: 1.25 };
    finder.endpointChanged(chain, 'start');
    chain.points[1] = { x: 0.75, y: 1.75 };
    finder.endpointChanged(chain, 'end');
  }
  // The closest old segment is stale. The current segment's first endpoint
  // is the exact projection, and the appended index must agree with a rebuild.
  const expected = { x: 0.25, y: 1.25 };
  expect(finder.nearestFootOnOthers(query, own, 4)).toEqual(expected);
  expect(new WeldFootFinder(chains, 4).nearestFootOnOthers(query, own, 4)).toEqual(expected);
});
