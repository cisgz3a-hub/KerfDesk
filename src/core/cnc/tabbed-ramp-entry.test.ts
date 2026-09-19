import { describe, expect, it } from 'vitest';
import type { CncPath3dPass } from '../job';
import { applyRampEntry } from './motion-polish';
import { rampTabbedPath } from './tabbed-ramp-entry';

function ring(scale = 1): CncPath3dPass {
  return {
    kind: 'path3d',
    closed: false,
    points: [
      { x: 0, y: 0, z: -2 },
      { x: 5 * scale, y: 0, z: -2 },
      { x: 5 * scale, y: 0, z: -4 },
      { x: 10 * scale, y: 0, z: -4 },
      { x: 10 * scale, y: 10 * scale, z: -4 },
      { x: 0, y: 10 * scale, z: -4 },
      { x: 0, y: 0, z: -4 },
      { x: 0, y: 0, z: -2 },
    ],
  };
}

describe('ramp composition with rectangular tabs', () => {
  it('starts a lateral descent after a tab covering the entry seam', () => {
    const tangent = Math.tan((5 * Math.PI) / 180);
    const output = rampTabbedPath(ring(), -2, tangent);
    const index = output.points.findIndex((point) => point.z < -2);
    const a = output.points[index - 1]!;
    const b = output.points[index]!;
    expect(a).toEqual({ x: 5, y: 0, z: -2 });
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(0);
    expect((a.z - b.z) / Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(tangent, 9);
    expect(output.points.at(-1)?.z).toBe(-4);
  });

  it('continues around a small ring until the requested angle reaches depth', () => {
    const tangent = Math.tan((0.5 * Math.PI) / 180);
    const output = rampTabbedPath(ring(0.1), -2, tangent);
    expect(output.points.length).toBeGreaterThan(400);
    const atDepth = output.points.findIndex((point) => point.z === -4);
    for (let index = 1; index <= atDepth; index += 1) {
      const a = output.points[index - 1]!;
      const b = output.points[index]!;
      const run = Math.hypot(b.x - a.x, b.y - a.y);
      if (run > 0 && b.z < a.z) expect((a.z - b.z) / run).toBeLessThanOrEqual(tangent + 1e-10);
    }
    const fullLoop = output.points.slice(atDepth);
    const length = fullLoop.slice(1).reduce((sum, b, index) => {
      const a = fullLoop[index]!;
      return sum + Math.hypot(b.x - a.x, b.y - a.y);
    }, 0);
    expect(length).toBeCloseTo(4, 8);
  });

  it('carries tabbed depth history into the next pass', () => {
    const first = ring();
    const second: CncPath3dPass = {
      ...first,
      points: first.points.map((point) => ({ ...point, z: point.z === -4 ? -6 : point.z })),
    };
    const passes = applyRampEntry([first, second], 5, true);
    const pass = passes[1];
    if (pass?.kind !== 'path3d') throw new Error('tabbed pass missing');
    // Entry is on a raised tab; the first low span must resume at the
    // already-cleared -4 level, not plunge to -6 or restart at stock top.
    expect(pass.points[2]?.z).toBe(-4);
  });

  it('requires explicit tab ownership before transforming a path3d', () => {
    const pass = ring();
    expect(applyRampEntry([pass], 5)[0]).toBe(pass);
    const variable: CncPath3dPass = {
      ...pass,
      points: [
        { x: 0, y: 0, z: -2 },
        { x: 5, y: 0, z: -4 },
        { x: 0, y: 0, z: -2 },
      ],
    };
    expect(rampTabbedPath(variable, 0, 0.1)).toBe(variable);
  });

  it('does not remove an all-tab ring or invent a deeper pass', () => {
    const pass = ring();
    const allTabs = { ...pass, points: pass.points.map((point) => ({ ...point, z: -2 })) };
    expect(rampTabbedPath(allTabs, -2, 0.1)).toBe(allTabs);
  });

  it('reports an unmaterializable array instead of iterating an unrepresentable ramp', () => {
    expect(() => rampTabbedPath(ring(0.1), 1e20, 0.01)).toThrow('ECMAScript Array length limit');
  });
});
