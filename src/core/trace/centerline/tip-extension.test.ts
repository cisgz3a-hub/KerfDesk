import { describe, expect, it } from 'vitest';
import { minDistanceToPolylines } from '../../../__fixtures__/perceptual/centerline-geometry';
import type { Vec2 } from '../../scene';
import { DEFAULT_TRACE_OPTIONS } from '../trace-image';
import { TRACE_PRESETS } from '../trace-presets';
import { traceImageToColoredPaths } from '../trace-to-paths';
import { squaredDistanceField, type InkMask } from './distance-field';
import { condenseJunctions } from './junction-condense';
import { thinToMedialAxis } from './medial-thinning';
import { pruneSpurs } from './spur-pruning';
import { buildStrokeGraph, type StrokeGraph } from './stroke-graph';

function flatBar(thickness: number, vertical: boolean, reflected: boolean) {
  const width = 128;
  const ink = new Uint8Array(width * width);
  const data = new Uint8ClampedArray(width * width * 4).fill(255);
  const y0 = Math.round(58.5 - thickness / 2);
  const transform = (p: Vec2): Vec2 => {
    const x = reflected ? width - p.x : p.x;
    return vertical ? { x: p.y, y: x } : { x, y: p.y };
  };
  for (let y = y0; y < y0 + thickness; y += 1) {
    for (let x = 18; x < 110; x += 1) {
      const p = transform({ x: x + 0.5, y: y + 0.5 });
      const index = Math.floor(p.y) * width + Math.floor(p.x);
      ink[index] = 1;
      data[index * 4] = data[index * 4 + 1] = data[index * 4 + 2] = 0;
    }
  }
  return {
    image: { width, height: width, data },
    mask: { width, height: width, ink } satisfies InkMask,
    targets: [18, 110].map((x) => transform({ x, y: y0 + thickness / 2 })),
  };
}

describe('Centerline cap recovery after spur pruning', () => {
  for (const thickness of [5, 17]) {
    for (const vertical of [false, true]) {
      for (const reflected of [false, true]) {
        it(`reaches ${thickness}px flat caps, vertical=${vertical}, reflected=${reflected}`, async () => {
          const fixture = flatBar(thickness, vertical, reflected);
          const paths = await traceImageToColoredPaths(
            fixture.image,
            TRACE_PRESETS.Centerline ?? DEFAULT_TRACE_OPTIONS,
          );
          const polylines = paths.flatMap((path) => path.polylines);
          expect(polylines).toHaveLength(1);
          expect(polylines[0]?.closed).toBe(false);
          for (const target of fixture.targets) {
            expect(minDistanceToPolylines(target, polylines)).toBeLessThan(0.6);
          }
        });
      }
    }
  }

  it('returns current endpoint roles and only incident nodes without mutating the input graph', () => {
    const { mask } = flatBar(17, false, false);
    const distance = squaredDistanceField(mask);
    const skeleton = thinToMedialAxis(mask, distance);
    const graph = condenseJunctions(buildStrokeGraph(skeleton, 128, 128), distance, 128);
    const original = structuredClone(graph);
    const result = pruneSpurs(graph, distance, 128);
    expect(graph).toEqual(original);
    expect(result.chains).toHaveLength(1);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes.map((node) => node.kind)).toEqual(['endpoint', 'endpoint']);
    for (const chain of result.chains) {
      expect(result.nodes[chain.a]?.id).toBe(chain.a);
      expect(result.nodes[chain.b]?.id).toBe(chain.b);
    }
  });

  it('keeps a branch attached when passthrough dissolution closes its ring', () => {
    const attachment = { x: 30.5, y: 20.5 };
    const opposite = { x: 10.5, y: 20.5 };
    const tip = { x: 50.5, y: 20.5 };
    const graph: StrokeGraph = {
      nodes: [
        { id: 0, kind: 'junction', pos: attachment, pixels: [1310] },
        { id: 1, kind: 'endpoint', pos: tip, pixels: [1330] },
        { id: 2, kind: 'junction', pos: opposite, pixels: [1290] },
      ],
      chains: [
        { a: 0, b: 2, closed: false, points: [attachment, { x: 20.5, y: 10.5 }, opposite] },
        { a: 2, b: 0, closed: false, points: [opposite, { x: 20.5, y: 30.5 }, attachment] },
        { a: 0, b: 1, closed: false, points: [attachment, tip] },
      ],
    };
    const result = pruneSpurs(graph, new Float64Array(64 * 64).fill(9), 64);
    expect(result.chains).toHaveLength(2);
    expect(result.nodes.map((node) => node.kind)).toEqual(['junction', 'endpoint']);
    const ring = result.chains.find((chain) => chain.closed);
    expect(ring).toBeDefined();
    expect(ring?.a).toBe(ring?.b);
    expect(result.nodes[ring!.a]?.pos).toEqual(attachment);
    expect(result.chains.find((chain) => !chain.closed)?.a).toBe(ring?.a);
  });
});
