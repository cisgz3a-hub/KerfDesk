import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../scene';
import { runTraceSteps } from '../trace-steps';
import { fairChainAlongArc } from './arc-fairing';
import { applyChainLoopClosure, retainChainAttachmentsSteps } from './chain-attachments';
import { smoothChainCurvature } from './chain-smoothing';
import { refineChainForOutput } from './curve-refine';
import type { Chain } from './junction-pairing';
import { sharpenChainBends } from './sharpen-bends';
import { simplifyChain } from './stroke-chains';

const chain = (points: Vec2[], closed = false): Chain => ({ points, closed, alive: true });
const distSq = new Float64Array(200 * 200).fill(9);

function finish(input: Chain, anchors: ReadonlySet<Vec2>): Vec2[] {
  const sharpened = sharpenChainBends(input.points, input.closed, distSq, 200, anchors);
  const pinned = new Set([...anchors, ...sharpened.corners]);
  const smooth = smoothChainCurvature(sharpened.points, input.closed, pinned);
  const fair = fairChainAlongArc(smooth, input.closed, pinned);
  const simple = simplifyChain(fair, input.closed, 0.45, anchors);
  // An attachment interpolates smoothly; only actual corners split the spline.
  return refineChainForOutput(simple, input.closed, sharpened.corners, 0.45);
}

function ringPoints(): Vec2[] {
  return Array.from({ length: 72 }, (_, index) => {
    const angle = (index / 72) * 2 * Math.PI;
    return { x: 50 + 20 * Math.cos(angle), y: 50 + 20 * Math.sin(angle) };
  });
}

describe('shared attachment constraints', () => {
  for (const [sx, sy] of [
    [1, 1],
    [2, 2],
    [1.5, 0.75],
    [-1, 1],
  ]) {
    it(`retains a ring's interior-segment attachment through every finishing stage at ${sx}/${sy}`, () => {
      const transform = (p: Vec2): Vec2 => ({ x: 80 + sx! * (p.x - 50), y: 80 + sy! * (p.y - 50) });
      const points = ringPoints();
      const a = points[0]!;
      const b = points[1]!;
      const contact = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const ring = chain(points.map(transform), true);
      const branch = chain([transform(contact), transform({ x: contact.x + 15, y: contact.y })]);
      const constraints = runTraceSteps(retainChainAttachmentsSteps([ring, branch]));
      const anchor = branch.points[0]!;
      expect(ring.points).toContain(anchor);
      expect(constraints.get(ring)).toContain(anchor);
      const output = finish(ring, constraints.get(ring)!);
      expect(output).toContain(anchor);
      expect(finish(branch, constraints.get(branch)!)[0]).toBe(anchor);
      // The original smooth ring should still follow its ellipse, including
      // either side of the attachment; preserving contact must not flatten it.
      const radialError = output.map((p) =>
        Math.abs(Math.hypot((p.x - 80) / sx!, (p.y - 80) / sy!) - 20),
      );
      expect(Math.max(...radialError)).toBeLessThan(0.5);
    });
  }

  it('unifies several contacts at a target vertex into one shared anchor', () => {
    const through = chain([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ]);
    const above = chain([
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
    const below = chain([
      { x: 10, y: -10 },
      { x: 10, y: 0 },
    ]);
    const constraints = runTraceSteps(retainChainAttachmentsSteps([through, above, below]));
    const anchor = through.points[1]!;
    expect(above.points[0]).toBe(anchor);
    expect(below.points[1]).toBe(anchor);
    expect(constraints.get(through)?.size).toBe(1);
    for (const input of [through, above, below])
      expect(finish(input, constraints.get(input)!)).toContain(anchor);
  });

  it('preserves a self-attachment when a ring and its branch use one open chain', () => {
    const points = ringPoints();
    const first = points[0]!;
    const input = chain([...points, { ...first }, { x: first.x + 15, y: first.y }]);
    const constraints = runTraceSteps(retainChainAttachmentsSteps([input]));
    const anchor = input.points[0]!;
    const output = finish(input, constraints.get(input)!);
    expect(output.filter((point) => point === anchor)).toHaveLength(2);
    expect(output.at(-1)).toEqual({ x: first.x + 15, y: first.y });
  });

  it('leaves positive gaps, nearby parallel strokes and internal crossings untouched', () => {
    const inputs = [
      chain([
        { x: 0, y: 0 },
        { x: 20, y: 0 },
      ]),
      chain([
        { x: 10, y: 1e-7 },
        { x: 10, y: 10 },
      ]),
      chain([
        { x: 0, y: -1e-7 },
        { x: 20, y: -1e-7 },
      ]),
      chain([
        { x: 5, y: -10 },
        { x: 5, y: 10 },
      ]),
    ];
    const original = structuredClone(inputs);
    expect(runTraceSteps(retainChainAttachmentsSteps(inputs)).size).toBe(0);
    expect(inputs).toEqual(original);
  });

  it('does not let simplification remove a shallow attached vertex', () => {
    const anchor = { x: 10, y: 0.1 };
    const points = [{ x: 0, y: 0 }, anchor, { x: 20, y: 0 }];
    expect(simplifyChain(points, false, 0.45)).not.toContain(anchor);
    expect(simplifyChain(points, false, 0.45, new Set([anchor]))).toContain(anchor);
  });

  it('retains an attachment inside the chamfer a corner rebuild would remove', () => {
    const anchor = { x: 19, y: 1 };
    const points: Vec2[] = [
      ...Array.from({ length: 19 }, (_, x) => ({ x, y: 0 })),
      anchor,
      ...Array.from({ length: 19 }, (_, y) => ({ x: 20, y: y + 2 })),
    ];
    const unconstrained = sharpenChainBends(points, false, distSq, 200);
    expect(unconstrained.corners.size).toBeGreaterThan(0);
    expect(unconstrained.points).not.toContain(anchor);
    expect(sharpenChainBends(points, false, distSq, 200, new Set([anchor])).points).toContain(
      anchor,
    );
  });

  it("inserts an attachment in a closed chain's wrap segment", () => {
    const points = ringPoints();
    const a = points.at(-1)!;
    const b = points[0]!;
    const anchor = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const ring = chain(points, true);
    const branch = chain([anchor, { x: anchor.x + 15, y: anchor.y }]);
    const constraints = runTraceSteps(retainChainAttachmentsSteps([ring, branch]));
    expect(ring.points.at(-1)).toBe(anchor);
    expect(finish(ring, constraints.get(ring)!)).toContain(anchor);
  });

  it('keeps a distinct attached endpoint when touching ends close a loop', () => {
    const last = { x: 0, y: 1 };
    const input = chain([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, last]);
    applyChainLoopClosure(
      input,
      { touchGapPx: 1.5, cornerGapPx: 1.5, alignedGapPx: 1.5 },
      new Set([last]),
    );
    expect(input.closed).toBe(true);
    expect(input.points.at(-1)).toBe(last);
  });
});
