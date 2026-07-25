import { describe, expect, it } from 'vitest';
import type { Toolpath } from '../job';
import { toolpathMoves3d } from './toolpath-moves-3d';

function toolpath(steps: Toolpath['steps'], totalLength = 0): Toolpath {
  return { steps, totalLength };
}

describe('toolpathMoves3d', () => {
  it('holds a flat contour pass at one depth', () => {
    const moves = toolpathMoves3d(
      toolpath([
        {
          kind: 'cut',
          color: '#000',
          polyline: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
          ],
          length: 20,
          z: { from: -3, to: -3 },
        },
      ]),
    );

    expect(moves[0]?.kind).toBe('cut');
    expect(moves[0]?.points.map((p) => p.z)).toEqual([-3, -3, -3]);
  });

  it('ramps Z along a cut by chord length, not by vertex index', () => {
    // Vertices are deliberately unevenly spaced: a naive index-based ramp would
    // put the midpoint at -1 instead of the correct -0.2.
    const moves = toolpathMoves3d(
      toolpath([
        {
          kind: 'cut',
          color: '#000',
          polyline: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 10, y: 0 },
          ],
          length: 10,
          z: { from: 0, to: -2 },
        },
      ]),
    );

    expect(moves[0]?.points.map((p) => p.z)).toEqual([0, -0.2, -2]);
  });

  it('treats travel without an explicit motion as rapid', () => {
    const moves = toolpathMoves3d(
      toolpath([{ kind: 'travel', from: { x: 0, y: 0 }, to: { x: 5, y: 0 }, length: 5 }]),
    );

    expect(moves[0]?.kind).toBe('rapid');
  });

  it('distinguishes feed travel from rapid travel', () => {
    const moves = toolpathMoves3d(
      toolpath([
        { kind: 'travel', from: { x: 0, y: 0 }, to: { x: 5, y: 0 }, length: 5, motion: 'feed' },
      ]),
    );

    expect(moves[0]?.kind).toBe('feed-travel');
  });

  it('separates a downward plunge from an upward retract', () => {
    const moves = toolpathMoves3d(
      toolpath([
        { kind: 'plunge', at: { x: 1, y: 2 }, fromZ: 5, toZ: -3, length: 8 },
        { kind: 'plunge', at: { x: 1, y: 2 }, fromZ: -3, toZ: 5, length: 8 },
      ]),
    );

    expect(moves.map((m) => m.kind)).toEqual(['plunge', 'retract']);
  });

  it('emits a plunge as a vertical pair at a fixed XY', () => {
    const moves = toolpathMoves3d(
      toolpath([{ kind: 'plunge', at: { x: 1, y: 2 }, fromZ: 5, toZ: -3, length: 8 }]),
    );

    expect(moves[0]?.points).toEqual([
      { x: 1, y: 2, z: 5 },
      { x: 1, y: 2, z: -3 },
    ]);
  });

  it('accumulates startMm from step.length verbatim, never from its own geometry', () => {
    // This step's declared length (100) deliberately disagrees with its chord
    // sum (10), exactly as arc and helical steps do. The next move must start
    // at 100 — measuring the drawn polyline instead would desync the 3D reveal
    // from the 2D scrubber.
    const moves = toolpathMoves3d(
      toolpath([
        {
          kind: 'cut',
          color: '#000',
          polyline: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
          ],
          length: 100,
        },
        { kind: 'travel', from: { x: 10, y: 0 }, to: { x: 20, y: 0 }, length: 7 },
      ]),
    );

    expect(moves[0]?.startMm).toBe(0);
    expect(moves[0]?.lengthMm).toBe(100);
    expect(moves[1]?.startMm).toBe(100);
  });

  it('places Z-less laser steps at the stock top instead of producing NaN', () => {
    const moves = toolpathMoves3d(
      toolpath([
        {
          kind: 'cut',
          color: '#f00',
          polyline: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
          length: 1.4,
        },
      ]),
    );

    expect(moves[0]?.points.every((p) => Number.isFinite(p.z))).toBe(true);
    expect(moves[0]?.points.map((p) => p.z)).toEqual([0, 0]);
  });

  it('survives a degenerate zero-length polyline without dividing by zero', () => {
    const moves = toolpathMoves3d(
      toolpath([
        {
          kind: 'cut',
          color: '#000',
          polyline: [
            { x: 4, y: 4 },
            { x: 4, y: 4 },
          ],
          length: 0,
          z: { from: 0, to: -2 },
        },
      ]),
    );

    expect(moves[0]?.points.every((p) => Number.isFinite(p.z))).toBe(true);
  });

  it('preserves program order across mixed step kinds', () => {
    const moves = toolpathMoves3d(
      toolpath([
        { kind: 'travel', from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, length: 1 },
        { kind: 'plunge', at: { x: 1, y: 0 }, fromZ: 5, toZ: -1, length: 6 },
        {
          kind: 'cut',
          color: '#000',
          polyline: [
            { x: 1, y: 0 },
            { x: 2, y: 0 },
          ],
          length: 1,
          z: { from: -1, to: -1 },
        },
        { kind: 'plunge', at: { x: 2, y: 0 }, fromZ: -1, toZ: 5, length: 6 },
      ]),
    );

    expect(moves.map((m) => m.kind)).toEqual(['rapid', 'plunge', 'cut', 'retract']);
    expect(moves.map((m) => m.startMm)).toEqual([0, 1, 7, 8]);
  });
});
