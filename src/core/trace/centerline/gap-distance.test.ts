import { afterEach, describe, expect, it, vi } from 'vitest';
import { gapFixture, controlFixture } from '../../../__fixtures__/centerline-gap';
import type { ColoredPath, Vec2 } from '../../scene';
import { upscaleBy } from '../auto-upscale';
import { enhanceRegionPaths } from '../region-enhance';
import { TRACE_PRESETS } from '../trace-presets';
import { traceImageToColoredPaths } from '../trace-to-paths';
import { traceScalePlan } from '../trace-upscale-policy';
import type { TraceOptions } from '../trace-image';
import * as assembly from './stroke-chains';
import * as closure from './loop-closure';
import { bridgeNearbyEnds, pairThroughJunctions, type Chain } from './junction-pairing';
import type { StrokeGraph } from './stroke-graph';

const base = TRACE_PRESETS.Centerline!;
const target = (paths: ColoredPath[], kind: 'original' | 'independent') =>
  paths
    .flatMap((p) => p.polylines)
    .filter((p) => p.points.every((q) => (kind === 'original' ? q.y > 50 : q.x > 70)));
const chain = (points: Vec2[], scale = 1): Chain => ({
  points: points.map((p) => ({ x: p.x * scale, y: p.y * scale })),
  closed: false,
  alive: true,
});
afterEach(() => vi.restoreAllMocks());

async function actualWorkingGap(pixelScale: number, sourceGap = 3): Promise<number> {
  const observed = vi.spyOn(assembly, 'assembleStrokePathsSteps');
  await traceImageToColoredPaths(upscaleBy(gapFixture(), 2), {
    ...base,
    autoUpscaleSmallSources: false,
    pixelScale,
    centerlineJoinGapPx: sourceGap,
  });
  expect(observed).toHaveBeenCalledTimes(1);
  const gap = observed.mock.calls[0]![3].joinGapPx;
  observed.mockRestore();
  return gap;
}

describe('Centerline source-distance gap bridging', () => {
  it.each(['original', 'independent'] as const)(
    'joins the %s interrupted stroke with or without broad context',
    async (kind) => {
      for (const broad of [false, true]) {
        const image = gapFixture(kind, broad),
          before = image.data.slice(),
          plan = traceScalePlan(image, base);
        expect(plan).toEqual(broad ? { kind: 'native' } : { kind: 'upscale', factor: 2 });
        const paths = await traceImageToColoredPaths(image, base),
          selected = target(paths, kind);
        expect(selected).toHaveLength(1);
        expect(selected[0]!.closed).toBe(false);
        expect(image.data.every((v, i) => v === before[i])).toBe(true);
      }
    },
  );

  it.each([undefined, 0, 2.5, 3])(
    'preserves omitted/default/zero/nondefault source distance %s',
    async (gap) => {
      const { centerlineJoinGapPx: _omitted, ...rest } = base;
      const options: TraceOptions =
        gap === undefined ? rest : { ...rest, centerlineJoinGapPx: gap };
      for (const kind of ['original', 'independent'] as const)
        for (const broad of [false, true]) {
          const selected = target(
            await traceImageToColoredPaths(gapFixture(kind, broad), options),
            kind,
          );
          expect(selected).toHaveLength(gap === 0 ? 2 : 1);
          expect(selected.every((p) => !p.closed)).toBe(true);
        }
    },
  );

  it.each([
    [1, 3],
    [2, 3],
    [1, 2.5],
    [2, 2.5],
  ])('keeps strict source thresholds at scale %s and gap %s', async (scale, sourceGap) => {
    const workingGap = await actualWorkingGap(scale, sourceGap);
    for (const delta of [-0.001, 0, 0.001]) {
      const gap = sourceGap + delta,
        chains = [
          chain(
            [
              { x: -20, y: 0 },
              { x: 0, y: 0 },
            ],
            scale,
          ),
          chain(
            [
              { x: gap, y: 0 },
              { x: gap + 20, y: 0 },
            ],
            scale,
          ),
        ];
      bridgeNearbyEnds(chains, workingGap);
      expect(chains.filter((c) => c.alive)).toHaveLength(delta < 0 ? 1 : 2);
      expect(chains.every((c) => !c.closed)).toBe(true);
    }
  });

  it.each([1, 2])('retains first-candidate tie order at scale %s', async (scale) => {
    const workingGap = await actualWorkingGap(scale);
    for (const firstSide of [1, -1]) {
      const a = chain(
          [
            { x: -20, y: 0 },
            { x: 0, y: 0 },
          ],
          scale,
        ),
        b = chain(
          [
            { x: 2, y: 1.5 * firstSide },
            { x: 22, y: 11.5 * firstSide },
          ],
          scale,
        ),
        c = chain(
          [
            { x: 2, y: -1.5 * firstSide },
            { x: 22, y: -11.5 * firstSide },
          ],
          scale,
        ),
        expected = [...a.points, b.points[1]!];
      bridgeNearbyEnds([a, b, c], workingGap);
      expect(a.points).toEqual(expected);
      expect(b.alive).toBe(false);
      expect(c.alive).toBe(true);
    }
  });

  it.each([1, 2])(
    'does not bridge receding tips or separated parallel strokes at scale %s',
    async (scale) => {
      const workingGap = await actualWorkingGap(scale);
      const pairs = [
        [
          chain(
            [
              { x: 0, y: 0 },
              { x: 20, y: 0 },
            ],
            scale,
          ),
          chain(
            [
              { x: 2, y: 0 },
              { x: -18, y: 0 },
            ],
            scale,
          ),
        ],
        [
          chain(
            [
              { x: 0, y: 0 },
              { x: 20, y: 0 },
            ],
            scale,
          ),
          chain(
            [
              { x: 0, y: 4 },
              { x: 20, y: 4 },
            ],
            scale,
          ),
        ],
      ];
      for (const chains of pairs) {
        const before = structuredClone(chains);
        bridgeNearbyEnds(chains, workingGap);
        expect(chains).toEqual(before);
      }
    },
  );

  it.each([
    [0, 1],
    [-1, 1],
    [0.5, 1],
    [Number.NaN, 1],
    [Infinity, 1],
    [2, 2],
    [2.5, 2.5],
  ])('uses existing validated scale semantics for %s', async (input, scale) => {
    expect(await actualWorkingGap(input)).toBe(3 * scale);
  });

  it('leaves independent ring closure reach unchanged when the bridge scales', async () => {
    const observed = vi.spyOn(closure, 'decideLoopClosure');
    expect(await actualWorkingGap(2)).toBe(6);
    expect(observed.mock.calls.length).toBeGreaterThan(0);
    for (const [, options] of observed.mock.calls)
      expect(options).toEqual({ touchGapPx: 1.5, cornerGapPx: 1.5, alignedGapPx: 1.5 });
  });

  it('zero gap still permits true-junction pairing and preserves an existing ring', async () => {
    const workingGap = await actualWorkingGap(2, 0);
    const a = chain([
        { x: -20, y: 0 },
        { x: 0, y: 0 },
      ]),
      b = chain([
        { x: 0, y: 0 },
        { x: 20, y: 0 },
      ]),
      c = chain([
        { x: 0, y: 0 },
        { x: 0, y: 20 },
      ]);
    const ring: Chain = {
      points: [
        { x: 40, y: 40 },
        { x: 50, y: 40 },
        { x: 50, y: 50 },
        { x: 40, y: 40 },
      ],
      alive: true,
      closed: true,
    };
    const graph: StrokeGraph = {
      nodes: [{ id: 0, pos: { x: 0, y: 0 }, kind: 'junction', pixels: [] }],
      chains: [],
    };
    pairThroughJunctions([a, b, c, ring], graph);
    bridgeNearbyEnds([a, b, c, ring], workingGap);
    expect(a.points).toEqual([
      { x: -20, y: 0 },
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ]);
    expect(b.alive).toBe(false);
    expect(c.alive).toBe(true);
    expect(ring.closed).toBe(true);
    expect(ring.points).toHaveLength(4);
  });

  it.each(['parallel', 'intentional'] as const)(
    'preserves the %s raster as two independent open paths',
    async (kind) => {
      const paths = await traceImageToColoredPaths(controlFixture(kind), base),
        polys = paths.flatMap((p) => p.polylines);
      expect(polys).toHaveLength(2);
      expect(polys.every((p) => !p.closed)).toBe(true);
    },
  );

  it('scales a region gap once while leaving the unrelated broad stroke intact', async () => {
    const image = gapFixture('original', true),
      full = await traceImageToColoredPaths(image, base),
      observed = vi.spyOn(assembly, 'assembleStrokePathsSteps'),
      calls: TraceOptions[] = [];
    const result = await enhanceRegionPaths({
      image,
      options: base,
      region: { x: 8, y: 52, width: 112, height: 24 },
      fullTracePaths: full,
      trace: async (im, options) => {
        calls.push(options);
        return traceImageToColoredPaths(im, options);
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      pixelScale: 2,
      centerlineJoinGapPx: 3,
      autoUpscaleSmallSources: false,
    });
    expect(observed).toHaveBeenCalledTimes(1);
    expect(observed.mock.calls[0]![3].joinGapPx).toBe(6);
    expect(target(result, 'original')).toHaveLength(1);
    const upper = (paths: ColoredPath[]) =>
      paths.flatMap((p) => p.polylines).filter((p) => p.points.every((q) => q.y < 50));
    expect(upper(result)).toEqual(upper(full));
  });
});
