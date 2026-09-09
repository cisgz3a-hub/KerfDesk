import { describe, expect, it, vi } from 'vitest';
import type { Vec2 } from '../../scene';
import { pruneSpurs, pruneSpursSteps } from './spur-pruning';
import type { StrokeChain, StrokeGraph, StrokeNode } from './stroke-graph';

function starComponents(count: number, shortArms: boolean): StrokeGraph {
  const nodes: StrokeNode[] = [];
  const chains: StrokeChain[] = [];
  for (let component = 0; component < count; component += 1) {
    const center = nodes.length;
    const pos = { x: 12.5, y: 12.5 };
    nodes.push({ id: center, kind: 'junction', pos, pixels: [156] });
    const reach = shortArms ? 1 : 10;
    for (const delta of [
      { x: -reach, y: 0 },
      { x: reach, y: 0 },
      { x: 0, y: reach },
    ]) {
      const id = nodes.length;
      const tip = { x: pos.x + delta.x, y: pos.y + delta.y };
      nodes.push({ id, kind: 'endpoint', pos: tip, pixels: [] });
      chains.push({ a: center, b: id, points: [pos, tip], closed: false });
    }
  }
  return { nodes, chains, seamJunctions: [{ x: 7.25, y: 9.75 }] };
}

describe('live spur-pruning connectivity', () => {
  it('does not remeasure unchanged real branches when unrelated spurs are removed', () => {
    const real = starComponents(60, false);
    const spurs = starComponents(60, true);
    const offset = real.nodes.length;
    const graph: StrokeGraph = {
      nodes: [...real.nodes, ...spurs.nodes.map((node) => ({ ...node, id: node.id + offset }))],
      chains: [
        ...real.chains,
        ...spurs.chains.map((chain) => ({ ...chain, a: chain.a + offset, b: chain.b + offset })),
      ],
    };
    const hypot = vi.spyOn(Math, 'hypot');
    try {
      const result = pruneSpurs(graph, new Float64Array(32 * 32).fill(4), 32);
      expect(result.chains.map((chain) => chain.points)).toEqual([
        ...real.chains.map((chain) => chain.points),
        ...spurs.chains.filter((_, index) => index % 3 === 2).map((chain) => chain.points),
      ]);
      expect(hypot.mock.calls.length).toBeLessThan(graph.chains.length * 3);
    } finally {
      hypot.mockRestore();
    }
  });

  it('revisits an earlier chain before later candidates when a removal makes it a leaf', () => {
    const positions = [
      { x: 0.5, y: 0.5 },
      { x: 1.5, y: 0.5 },
      { x: 2.5, y: 0.5 },
      { x: 3.5, y: 0.5 },
    ] as const;
    const graph: StrokeGraph = {
      nodes: positions.map((pos, id) => ({ id, pos, kind: 'junction', pixels: [] })),
      chains: (
        [
          [1, 2],
          [0, 1],
          [2, 3],
        ] as const
      ).map(([a, b]) => ({
        a,
        b,
        closed: false,
        points: [positions[a], positions[b]],
      })),
    };
    const result = pruneSpurs(graph, new Float64Array(8).fill(1), 8);
    expect(result.chains).toHaveLength(1);
    expect(result.chains[0]?.points).toEqual([positions[2], positions[3]]);
  });

  it('rechecks a retained leaf after merging it onto a wider junction', () => {
    const positions = [
      { x: 0.5, y: 10.5 },
      { x: 5.5, y: 10.5 },
      { x: 8.5, y: 10.5 },
      { x: 20.5, y: 10.5 },
      { x: 8.5, y: 25.5 },
    ] as const;
    const graph: StrokeGraph = {
      nodes: positions.map((pos, id) => ({ id, pos, kind: 'junction', pixels: [] })),
      chains: (
        [
          [0, 1],
          [1, 2],
          [2, 3],
          [2, 4],
        ] as const
      ).map(([a, b]) => ({
        a,
        b,
        closed: false,
        points: [positions[a], positions[b]],
      })),
    };
    const distances = new Float64Array(32 * 32).fill(4);
    distances[10 * 32] = distances[10 * 32 + 5] = 1;
    distances[10 * 32 + 8] = 16;
    const result = pruneSpurs(graph, distances, 32);
    expect(result.chains).toHaveLength(1);
    expect(result.chains[0]?.points).toEqual([positions[3], positions[2], positions[4]]);
  });

  it('keeps thousands of real branches within a linear cooperative work budget', () => {
    const graph = starComponents(1000, false);
    const steps = pruneSpursSteps(graph, new Float64Array(32 * 32).fill(4), 32);
    // This measures deterministic work checkpoints, not wall-clock speed.
    // Rebuilding all connectivity for each retained leaf exceeds this budget.
    let checkpoints = 0;
    for (;;) {
      const result = steps.next(true);
      checkpoints += 1;
      expect(checkpoints).toBeLessThan(graph.chains.length * 4);
      if (!result.done) continue;
      expect(result.value).toEqual(graph);
      return;
    }
  });

  it('updates each component immediately and retains its original last chain', () => {
    const graph = starComponents(5, true);
    const snapshot = structuredClone(graph);
    const result = pruneSpurs(graph, new Float64Array(32 * 32).fill(1), 32);
    expect(graph).toEqual(snapshot);
    expect(result.chains).toHaveLength(5);
    expect(result.chains.map((chain) => chain.points)).toEqual(
      graph.chains.filter((_, index) => index % 3 === 2).map((chain) => chain.points),
    );
    expect(result.nodes).toHaveLength(10);
    expect(result.nodes.every((node) => node.kind === 'endpoint')).toBe(true);
    expect(result.seamJunctions).toEqual(graph.seamJunctions);
    for (const chain of result.chains) {
      expect(result.nodes[chain.a]?.pos).toEqual(chain.points[0]);
      expect(result.nodes[chain.b]?.pos).toEqual(chain.points.at(-1));
    }
  });

  it('preserves chain order and ring anchor identity when dissolution closes a cycle', () => {
    const positions = [
      { x: 4.5, y: 4.5 },
      { x: 8.5, y: 4.5 },
      { x: 8.5, y: 8.5 },
    ] as const satisfies ReadonlyArray<Vec2>;
    const graph: StrokeGraph = {
      nodes: positions.map((pos, id) => ({ id, kind: 'junction', pos, pixels: [] })),
      chains: (
        [
          [0, 1],
          [1, 2],
          [2, 0],
        ] as const
      ).map(([a, b]) => ({
        a,
        b,
        closed: false,
        points: [positions[a], positions[b]],
      })),
    };
    const result = pruneSpurs(graph, new Float64Array(16 * 16).fill(4), 16);
    expect(result.chains).toEqual([
      {
        a: 0,
        b: 0,
        closed: true,
        points: [positions[2], positions[0], positions[1]],
      },
    ]);
    expect(result.nodes).toEqual([{ id: 0, kind: 'junction', pos: positions[2], pixels: [] }]);
    expect(result.seamJunctions).toEqual(positions);
  });
});
