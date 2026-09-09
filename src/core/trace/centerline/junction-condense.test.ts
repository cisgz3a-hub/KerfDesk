import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../scene';
import { TRACE_PRESETS } from '../trace-presets';
import { traceImageToColoredPaths } from '../trace-to-paths';
import { squaredDistanceField, type InkMask } from './distance-field';
import { condenseJunctions } from './junction-condense';
import { thinToMedialAxis } from './medial-thinning';
import { arcLength, pruneSpurs } from './spur-pruning';
import { buildStrokeGraph, type StrokeGraph } from './stroke-graph';

function blank(width: number, height = width): InkMask {
  return { width, height, ink: new Uint8Array(width * height) };
}

function rectangle(mask: InkMask, x: number, y: number, width: number, height: number): void {
  for (let py = y; py < y + height; py += 1)
    for (let px = x; px < x + width; px += 1) mask.ink[py * mask.width + px] = 1;
}

function ring(): InkMask {
  const mask = blank(60);
  rectangle(mask, 15, 15, 25, 25);
  for (let y = 26; y < 29; y += 1)
    for (let x = 26; x < 29; x += 1) mask.ink[y * mask.width + x] = 0;
  return mask;
}

function comb(teeth: number, alternating = false): InkMask {
  const mask = blank(teeth === 23 ? 240 : 80, 160);
  rectangle(mask, 10, 110, mask.width - 20, 10);
  for (let k = 0; k < teeth; k += 1) {
    const y = alternating && k % 2 === 1 ? 110 : 30;
    rectangle(mask, 30 + 8 * k, y, 3, y === 30 ? 90 : 40);
  }
  return mask;
}

function capsule(mask: InkMask, a: Vec2, b: Vec2, radius: number): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy || 1;
  for (let y = 0; y < mask.height; y += 1)
    for (let x = 0; x < mask.width; x += 1) {
      const t = Math.max(0, Math.min(1, ((x + 0.5 - a.x) * dx + (y + 0.5 - a.y) * dy) / lengthSq));
      if (Math.hypot(x + 0.5 - a.x - t * dx, y + 0.5 - a.y - t * dy) <= radius)
        mask.ink[y * mask.width + x] = 1;
    }
}

function crossing(): InkMask {
  const mask = blank(180);
  capsule(mask, { x: 25, y: 90 }, { x: 155, y: 90 }, 2);
  const dy = (65 * Math.sqrt(3)) / 2;
  capsule(mask, { x: 57.5, y: 90 - dy }, { x: 122.5, y: 90 + dy }, 2);
  return mask;
}

// Integer replication and quarter-turns preserve the exact binary drawing.
// These controls keep the result independent of one lattice orientation.
function transform(mask: InkMask, scale: number, rotate: boolean): InkMask {
  const width = mask.width * scale;
  const height = mask.height * scale;
  const result = blank(rotate ? height : width, rotate ? width : height);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const ink = mask.ink[Math.floor(y / scale) * mask.width + Math.floor(x / scale)] ?? 0;
      const px = rotate ? height - 1 - y : x;
      const py = rotate ? x : y;
      result.ink[py * result.width + px] = ink;
    }
  return result;
}

function graphPair(mask: InkMask, cleanSpurs = false): { before: StrokeGraph; after: StrokeGraph } {
  const distances = squaredDistanceField(mask);
  const skeleton = thinToMedialAxis(mask, distances);
  const raw = buildStrokeGraph(skeleton, mask.width, mask.height);
  const before = cleanSpurs ? pruneSpurs(raw, distances, mask.width) : raw;
  return { before, after: condenseJunctions(before, distances, mask.width) };
}

function cycleRank(graph: StrokeGraph): number {
  const neighbours = new Map<number, number[]>();
  for (const chain of graph.chains) {
    if (chain.closed) continue;
    neighbours.set(chain.a, [...(neighbours.get(chain.a) ?? []), chain.b]);
    neighbours.set(chain.b, [...(neighbours.get(chain.b) ?? []), chain.a]);
  }
  let components = 0;
  const seen = new Set<number>();
  for (const id of neighbours.keys()) {
    if (seen.has(id)) continue;
    components += 1;
    const pending = [id];
    seen.add(id);
    while (pending.length > 0) {
      const next = pending.pop();
      if (next === undefined) break;
      for (const neighbour of neighbours.get(next) ?? []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        pending.push(neighbour);
      }
    }
  }
  return graph.chains.length - neighbours.size + components;
}

function image(mask: InkMask) {
  const data = new Uint8ClampedArray(mask.width * mask.height * 4).fill(255);
  for (let i = 0; i < mask.ink.length; i += 1)
    if (mask.ink[i] === 1) data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 0;
  return { width: mask.width, height: mask.height, data };
}

const VARIANTS = [
  { scale: 1, rotate: false },
  { scale: 1, rotate: true },
  { scale: 2, rotate: false },
  { scale: 2, rotate: true },
];

describe('junction condensation preserves the drawn network', () => {
  it.each(VARIANTS)(
    'preserves a retained hole at $scale×, rotated=$rotate',
    ({ scale, rotate }) => {
      const { before, after } = graphPair(transform(ring(), scale, rotate));
      expect(cycleRank(before)).toBe(1);
      expect(cycleRank(after)).toBe(1);
    },
  );

  it.each([
    { teeth: 2, alternating: false },
    { teeth: 2, alternating: true },
    { teeth: 23, alternating: false },
  ])(
    'keeps $teeth separate tooth intersections, alternating=$alternating',
    ({ teeth, alternating }) => {
      for (const { scale, rotate } of VARIANTS) {
        const mask = transform(comb(teeth, alternating), scale, rotate);
        const { before, after } = graphPair(mask);
        for (let k = 0; k < teeth; k += 1) {
          const expected = (31.5 + 8 * k) * scale;
          const root = after.nodes.find((node) => {
            if (node.kind !== 'junction') return false;
            const along = rotate ? node.pos.y : node.pos.x;
            const across = rotate ? 160 * scale - node.pos.x : node.pos.y;
            return (
              Math.abs(along - expected) <= scale && across >= 110 * scale && across <= 120 * scale
            );
          });
          expect(
            root,
            `missing distinct root ${k}, scale ${scale}, rotate ${rotate}`,
          ).toBeDefined();
        }
        const length = (g: StrokeGraph) =>
          g.chains.reduce((sum, c) => sum + arcLength(c.points), 0);
        expect(length(after)).toBeLessThanOrEqual(length(before) + 2 * scale);
        expect(cycleRank(after)).toBe(0);
      }
    },
  );

  it.each(VARIANTS)(
    'still condenses one thick crossing at $scale×, rotated=$rotate',
    ({ scale, rotate }) => {
      const { before, after } = graphPair(transform(crossing(), scale, rotate), true);
      const nearCentre = (graph: StrokeGraph) =>
        graph.nodes.filter(
          (n) =>
            n.kind === 'junction' &&
            Math.hypot(n.pos.x - 90 * scale, n.pos.y - 90 * scale) < 8 * scale,
        );
      expect(nearCentre(before).length).toBeGreaterThan(1);
      expect(nearCentre(after).length).toBeLessThan(nearCentre(before).length);
      expect(cycleRank(after)).toBe(0);
    },
  );

  it('emits a closed path around the retained hole through the public default preset', async () => {
    const paths = await traceImageToColoredPaths(image(ring()), TRACE_PRESETS.Centerline!);
    const polylines = paths.flatMap((path) => path.polylines);
    expect(polylines).toHaveLength(1);
    expect(polylines[0]?.closed).toBe(true);
  });

  it.each(VARIANTS)(
    'emits two through-strokes for the thick crossing at $scale×, rotated=$rotate',
    async ({ scale, rotate }) => {
      const paths = await traceImageToColoredPaths(
        image(transform(crossing(), scale, rotate)),
        TRACE_PRESETS.Centerline!,
      );
      const polylines = paths.flatMap((path) => path.polylines);
      expect(polylines).toHaveLength(2);
      expect(polylines.every((path) => !path.closed)).toBe(true);
    },
  );

  it.each([2, 23])(
    'does not retrace the common trunk between %i neighbouring intersections',
    async (teeth) => {
      for (const { scale, rotate } of VARIANTS) {
        const mask = transform(comb(teeth), scale, rotate);
        const paths = await traceImageToColoredPaths(image(mask), TRACE_PRESETS.Centerline!);
        const polylines = paths.flatMap((path) => path.polylines);
        expect(polylines).toHaveLength(teeth + 1);
        const totalLength = polylines.reduce((sum, path) => sum + arcLength(path.points), 0);
        const trunkLength = (teeth === 23 ? 220 : 60) * scale;
        expect(totalLength).toBeLessThan(trunkLength + teeth * 90 * scale);
      }
    },
  );

  it('preserves an attached closed loop when an unrelated crossing changes node IDs', () => {
    const mask = crossing();
    const { before } = graphPair(mask, true);
    const anchor = before.nodes.at(-1)!;
    const graph = {
      ...before,
      chains: [
        ...before.chains,
        {
          a: anchor.id,
          b: anchor.id,
          closed: true,
          points: [
            anchor.pos,
            { x: anchor.pos.x + 1, y: anchor.pos.y },
            { x: anchor.pos.x, y: anchor.pos.y + 1 },
          ],
        },
      ],
    };
    const result = condenseJunctions(graph, squaredDistanceField(mask), mask.width);
    expect(result.nodes.length).toBeLessThan(graph.nodes.length);
    const loop = result.chains.find((chain) => chain.closed)!;
    expect(loop.a).toBe(loop.b);
    expect(result.nodes[loop.a]?.pos).toEqual(anchor.pos);
    expect(loop.points).toEqual(graph.chains.at(-1)?.points);
  });

  it('keeps the exact node of a ring attachment out of a nearby crossing contraction', () => {
    const mask = crossing();
    const { before } = graphPair(mask, true);
    const anchor = before.nodes.find((node) => node.kind === 'junction')!;
    const graph = {
      ...before,
      chains: [
        ...before.chains,
        { a: anchor.id, b: anchor.id, closed: true, points: [anchor.pos] },
      ],
    };
    expect(condenseJunctions(graph, squaredDistanceField(mask), mask.width)).toBe(graph);
  });
});
