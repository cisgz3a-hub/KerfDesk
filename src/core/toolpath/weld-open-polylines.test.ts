import { describe, expect, it } from 'vitest';
import type { Polyline, Vec2 } from '../scene';
import { weldOpenPolylines } from './weld-open-polylines';

const OPTIONS = { mmPerPx: 0.1, maxGapMm: 0.5 }; // gap threshold = 5 px

function line(x0: number, x1: number, y: number): Polyline {
  const points: Vec2[] = [];
  const n = Math.abs(x1 - x0);
  const dir = Math.sign(x1 - x0);
  for (let i = 0; i <= n; i += 1) points.push({ x: x0 + dir * i, y });
  return { points, closed: false };
}

describe('weldOpenPolylines', () => {
  it('joins collinear fragments across crack-scale gaps into one chain', () => {
    // 0..20, 24..44, 48..68 — 4px gaps, all weldable.
    const out = weldOpenPolylines([line(0, 20, 0), line(24, 44, 0), line(48, 68, 0)], OPTIONS);
    expect(out.length).toBe(1);
    const pts = (out[0] as Polyline).points;
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 68, y: 0 });
    expect((out[0] as Polyline).closed).toBe(false);
  });

  it('orients reversed fragments before joining', () => {
    // Second piece stored right-to-left; the weld must flip it, not stitch
    // its far end.
    const out = weldOpenPolylines([line(0, 20, 0), line(44, 24, 0)], OPTIONS);
    expect(out.length).toBe(1);
    const pts = (out[0] as Polyline).points;
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 44, y: 0 });
  });

  it('never joins across dash-scale gaps and never deletes a dot', () => {
    const dot: Polyline = {
      points: [
        { x: 200, y: 200 },
        { x: 201, y: 200 },
      ],
      closed: false,
    };
    const out = weldOpenPolylines([line(0, 20, 0), line(35, 55, 0), dot], OPTIONS);
    expect(out.length).toBe(3);
  });

  it('self-closes a welded loop and keeps the explicit return point', () => {
    // Four arcs of a circle, 4px gaps.
    const arcs: Polyline[] = [];
    for (let k = 0; k < 4; k += 1) {
      const points: Vec2[] = [];
      const start = (k * Math.PI) / 2 + 0.01;
      const end = ((k + 1) * Math.PI) / 2 - 0.01;
      for (let i = 0; i <= 30; i += 1) {
        const theta = start + ((end - start) * i) / 30;
        points.push({ x: 200 * Math.cos(theta), y: 200 * Math.sin(theta) });
      }
      arcs.push({ points, closed: false });
    }
    const out = weldOpenPolylines(arcs, OPTIONS);
    expect(out.length).toBe(1);
    const ring = out[0] as Polyline;
    expect(ring.closed).toBe(true);
    const first = ring.points[0] as Vec2;
    const last = ring.points[ring.points.length - 1] as Vec2;
    expect(Math.hypot(last.x - first.x, last.y - first.y)).toBeLessThanOrEqual(1e-9);
  });

  it('does not staple a short open arc into a sliver ring', () => {
    // Endpoints close relative to the weld gap but the chain is short:
    // closing it would fabricate a loop out of a drawn open hook.
    const points: Vec2[] = [];
    for (let i = 0; i <= 12; i += 1) {
      const theta = Math.PI * 0.15 + (i / 12) * Math.PI * 0.1;
      points.push({ x: 20 * Math.cos(theta), y: 20 * Math.sin(theta) });
    }
    const out = weldOpenPolylines([{ points, closed: false }], OPTIONS);
    expect((out[0] as Polyline).closed).toBe(false);
  });

  it('passes closed rings through by reference and preserves order', () => {
    const ring: Polyline = {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 0 },
      ],
      closed: true,
    };
    const out = weldOpenPolylines([ring, line(100, 120, 5)], OPTIONS);
    expect(out[0]).toBe(ring);
    expect(out.length).toBe(2);
  });

  it('returns input unchanged when the scale is unusable', () => {
    const input = [line(0, 20, 0), line(24, 44, 0)];
    for (const mmPerPx of [0, -1, Number.NaN]) {
      const out = weldOpenPolylines(input, { ...OPTIONS, mmPerPx });
      expect(out.length).toBe(2);
      expect(out[0]).toBe(input[0]);
    }
  });

  it('is deterministic', () => {
    const input = [line(48, 68, 0), line(0, 20, 0), line(24, 44, 0)];
    const a = JSON.stringify(weldOpenPolylines(input, OPTIONS));
    const b = JSON.stringify(weldOpenPolylines(input, OPTIONS));
    expect(a).toBe(b);
  });
});
