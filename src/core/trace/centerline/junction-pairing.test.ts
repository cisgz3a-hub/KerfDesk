import { describe, expect, it } from 'vitest';
import { minDistanceToPolylines } from '../../../__fixtures__/perceptual/centerline-geometry';
import type { Vec2 } from '../../scene';
import { DEFAULT_TRACE_OPTIONS } from '../trace-image';
import { TRACE_PRESETS } from '../trace-presets';
import { traceImageToColoredPaths } from '../trace-to-paths';
import { bridgeNearbyEnds, pairThroughJunctions, type Chain } from './junction-pairing';
import type { StrokeGraph } from './stroke-graph';

function makeChain(points: ReadonlyArray<Vec2>, reverse = false): Chain {
  return { points: reverse ? [...points].reverse() : [...points], closed: false, alive: true };
}

describe('joining chain endpoints', () => {
  for (const reverseA of [false, true]) {
    for (const reverseB of [false, true]) {
      it(`retains both distinct gap endpoints, reverseA=${reverseA}, reverseB=${reverseB}`, () => {
        const a = [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 2, y: 0 },
        ];
        const b = [
          { x: 4, y: 0 },
          { x: 4, y: 1 },
          { x: 4, y: 2 },
        ];
        const chains = [makeChain(a, reverseA), makeChain(b, reverseB)];
        bridgeNearbyEnds(chains, 3);
        const live = chains.filter((chain) => chain.alive);
        expect(live).toHaveLength(1);
        expect(live[0]?.points).toHaveLength(a.length + b.length);
        expect(live[0]?.points).toEqual(expect.arrayContaining([...a, ...b]));
        const points = live[0]?.points ?? [];
        expect(
          points.some((p, i) => p.x === 2 && points[i + 1]?.x === 4 && points[i + 1]?.y === 0),
        ).toBe(true);
      });
    }
  }

  it('deduplicates the common point when pairing at a real junction', () => {
    const centre = { x: 10, y: 10 };
    const chains = [
      makeChain([{ x: 0, y: 10 }, centre]),
      makeChain([centre, { x: 20, y: 10 }]),
      makeChain([centre, { x: 10, y: 20 }]),
    ];
    const graph: StrokeGraph = {
      nodes: [{ id: 0, kind: 'junction', pos: centre, pixels: [] }],
      chains: [],
    };
    pairThroughJunctions(chains, graph);
    const live = chains.filter((chain) => chain.alive);
    expect(live).toHaveLength(2);
    expect(live[0]?.points).toEqual([{ x: 0, y: 10 }, centre, { x: 20, y: 10 }]);
  });

  it('retains the joined tip within half a pixel through the complete default preset', async () => {
    const width = 128;
    const data = new Uint8ClampedArray(width * width * 4).fill(255);
    const pixel = (x: number, y: number): void => {
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 0;
    };
    // A broad independent stroke selects native tracing for the fine detail.
    for (let y = 10; y < 30; y += 1) for (let x = 10; x < 110; x += 1) pixel(x, y);
    for (let x = 10; x <= 50; x += 1) pixel(x, 60);
    for (let y = 62; y <= 105; y += 1) pixel(52, y);
    const paths = await traceImageToColoredPaths(
      { width, height: width, data },
      TRACE_PRESETS.Centerline ?? DEFAULT_TRACE_OPTIONS,
    );
    const detail = paths
      .flatMap((path) => path.polylines)
      .filter((polyline) => polyline.points.every((point) => point.y > 40));
    expect(detail).toHaveLength(1);
    expect(minDistanceToPolylines({ x: 52.5, y: 62.5 }, detail)).toBeLessThan(0.5);
  });

  it('keeps receding, outside-budget and closed paths separate', () => {
    const parallel = [
      makeChain([
        { x: 0, y: 0 },
        { x: 8, y: 0 },
      ]),
      makeChain([
        { x: 0, y: 2 },
        { x: 8, y: 2 },
      ]),
    ];
    bridgeNearbyEnds(parallel, 3);
    expect(parallel.filter((chain) => chain.alive)).toHaveLength(2);
    const receding = [
      makeChain([
        { x: 0, y: 0 },
        { x: 4, y: 0 },
      ]),
      makeChain([
        { x: 3, y: 0 },
        { x: 8, y: 0 },
      ]),
    ];
    bridgeNearbyEnds(receding, 2);
    expect(receding.filter((chain) => chain.alive)).toHaveLength(2);
    const distant = [
      makeChain([
        { x: 0, y: 0 },
        { x: 2, y: 0 },
      ]),
      makeChain([
        { x: 5, y: 0 },
        { x: 8, y: 0 },
      ]),
    ];
    bridgeNearbyEnds(distant, 3);
    expect(distant.filter((chain) => chain.alive)).toHaveLength(2);
    const ring = {
      ...makeChain([
        { x: 0, y: 0 },
        { x: 2, y: 0 },
      ]),
      closed: true,
    };
    const closed = [
      ring,
      makeChain([
        { x: 3, y: 0 },
        { x: 8, y: 0 },
      ]),
    ];
    bridgeNearbyEnds(closed, 3);
    expect(closed.filter((chain) => chain.alive)).toHaveLength(2);
  });
});
