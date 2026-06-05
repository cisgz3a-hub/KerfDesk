import { describe, expect, it } from 'vitest';
import { groupFillSweeps } from './fill-sweeps';

const seg = (x0: number, y0: number, x1: number, y1: number) => ({
  polyline: [
    { x: x0, y: y0 },
    { x: x1, y: y1 },
  ],
});

describe('groupFillSweeps', () => {
  it('returns one sweep with one span for a single run, preserving direction', () => {
    const sweeps = groupFillSweeps([seg(10, 0, 30, 0)]);
    expect(sweeps).toEqual([{ spans: [{ start: { x: 10, y: 0 }, end: { x: 30, y: 0 } }] }]);
  });

  it('merges the runs of one forward scanline into a single left-to-right sweep', () => {
    // Three ink spans / two holes on y=0, emitted left-to-right.
    const sweeps = groupFillSweeps([seg(0, 0, 5, 0), seg(8, 0, 12, 0), seg(15, 0, 20, 0)]);
    expect(sweeps).toHaveLength(1);
    expect(sweeps[0]?.spans).toEqual([
      { start: { x: 0, y: 0 }, end: { x: 5, y: 0 } },
      { start: { x: 8, y: 0 }, end: { x: 12, y: 0 } },
      { start: { x: 15, y: 0 }, end: { x: 20, y: 0 } },
    ]);
  });

  it('orders a reverse-snake scanline right-to-left in one sweep (small gap)', () => {
    // fillHatching reverse scanline: left pair first, each run reversed. The 2mm
    // gap stays under the rapid threshold, so it is one continuous sweep with the
    // rightmost region burned first.
    const sweeps = groupFillSweeps([seg(9, 5, 3, 5), seg(17, 5, 11, 5)]);
    expect(sweeps).toHaveLength(1);
    expect(sweeps[0]?.spans).toEqual([
      { start: { x: 17, y: 5 }, end: { x: 11, y: 5 } },
      { start: { x: 9, y: 5 }, end: { x: 3, y: 5 } },
    ]);
  });

  it('splits a scanline at a large gap so the emitter rapids across it (ADR-035)', () => {
    // Two regions 15mm apart on one scanline — above the 5mm threshold — become
    // SEPARATE sweeps. The emitter then crosses the gap with a G0 rapid (hard
    // laser-off) instead of a slow G1 S0 feed move (the stray-line audit fix).
    const sweeps = groupFillSweeps([seg(0, 0, 5, 0), seg(20, 0, 25, 0)]);
    expect(sweeps).toHaveLength(2);
    expect(sweeps[0]?.spans).toEqual([{ start: { x: 0, y: 0 }, end: { x: 5, y: 0 } }]);
    expect(sweeps[1]?.spans).toEqual([{ start: { x: 20, y: 0 }, end: { x: 25, y: 0 } }]);
  });

  it('starts a new sweep when the line changes (next scanline)', () => {
    const sweeps = groupFillSweeps([seg(0, 0, 10, 0), seg(0, 0.2, 10, 0.2)]);
    expect(sweeps).toHaveLength(2);
    expect(sweeps[0]?.spans[0]?.start.y).toBe(0);
    expect(sweeps[1]?.spans[0]?.start.y).toBe(0.2);
  });

  it('groups collinear runs on an angled scanline into one sweep', () => {
    // Two collinear spans along the 45-degree line y = x.
    const sweeps = groupFillSweeps([seg(0, 0, 2, 2), seg(5, 5, 7, 7)]);
    expect(sweeps).toHaveLength(1);
    expect(sweeps[0]?.spans).toEqual([
      { start: { x: 0, y: 0 }, end: { x: 2, y: 2 } },
      { start: { x: 5, y: 5 }, end: { x: 7, y: 7 } },
    ]);
  });

  it('does NOT group parallel-but-offset runs (different angled scanlines)', () => {
    // y = x and y = x + 1: parallel, not collinear.
    const sweeps = groupFillSweeps([seg(0, 0, 2, 2), seg(0, 1, 2, 3)]);
    expect(sweeps).toHaveLength(2);
  });

  it('skips degenerate segments and returns [] for empty input', () => {
    expect(groupFillSweeps([])).toEqual([]);
    expect(groupFillSweeps([{ polyline: [{ x: 1, y: 1 }] }])).toEqual([]);
  });
});
