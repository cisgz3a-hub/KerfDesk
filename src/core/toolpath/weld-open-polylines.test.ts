import { describe, expect, it } from 'vitest';
import type { Polyline, Vec2 } from '../scene';
import { weldOpenPolylines } from './weld-open-polylines';

const OPTIONS = { mmPerPx: 0.1, maxGapMm: 0.5 }; // gap threshold = 5 px
const NEAR_LOOP_EDGE_PX = 10;
const NEAR_LOOP_RETURN_GAP_PX = 4;
const PARALLEL_STROKE_LENGTH_PX = 100;
const PARALLEL_STROKE_SEPARATION_PX = 4;
const MAX_WELD_GAP_PX = 5;
const BASE_STROKE_LENGTH_PX = 20;
const JOINED_STROKE_END_PX = 40;
const INVALID_NEIGHBOR_Y_PX = 1;
const CONTINUATION_END_PX = 45;
const RETURNING_START_X_PX = 24;
const RETURNING_CORNER_X_PX = 30;
const RETURNING_TOP_Y_PX = 10;
const EXPECTED_COINCIDENT_JOIN_POINTS = JOINED_STROKE_END_PX + 1;

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

  it('does not close an untouched open chain whose endpoints happen to be nearby', () => {
    const nearLoop: Polyline = {
      points: [
        { x: 0, y: 0 },
        { x: NEAR_LOOP_EDGE_PX, y: 0 },
        { x: NEAR_LOOP_EDGE_PX, y: NEAR_LOOP_EDGE_PX },
        { x: 0, y: NEAR_LOOP_EDGE_PX },
        { x: 0, y: NEAR_LOOP_RETURN_GAP_PX },
      ],
      closed: false,
    };

    expect(weldOpenPolylines([nearLoop], OPTIONS)).toEqual([nearLoop]);
  });

  it('does not weld nearby independent parallel strokes', () => {
    const strokes = [
      line(0, PARALLEL_STROKE_LENGTH_PX, 0),
      line(0, PARALLEL_STROKE_LENGTH_PX, PARALLEL_STROKE_SEPARATION_PX),
    ];

    expect(weldOpenPolylines(strokes, OPTIONS)).toEqual(strokes);
  });

  it('joins coincident collinear ends without duplicating the shared point', () => {
    const out = weldOpenPolylines(
      [line(0, BASE_STROKE_LENGTH_PX, 0), line(BASE_STROKE_LENGTH_PX, JOINED_STROKE_END_PX, 0)],
      OPTIONS,
    );

    expect(out).toHaveLength(1);
    expect(out[0]?.closed).toBe(false);
    expect(out[0]?.points).toHaveLength(EXPECTED_COINCIDENT_JOIN_POINTS);
  });

  it('keeps coincident perpendicular strokes separate', () => {
    const horizontal = line(0, BASE_STROKE_LENGTH_PX, 0);
    const vertical: Polyline = {
      points: [
        { x: BASE_STROKE_LENGTH_PX, y: 0 },
        { x: BASE_STROKE_LENGTH_PX, y: BASE_STROKE_LENGTH_PX },
      ],
      closed: false,
    };

    expect(weldOpenPolylines([horizontal, vertical], OPTIONS)).toEqual([horizontal, vertical]);
  });

  it('skips a closer invalid pair and still joins the farther valid continuation', () => {
    const source = line(0, BASE_STROKE_LENGTH_PX, 0);
    const parallel = line(0, BASE_STROKE_LENGTH_PX, INVALID_NEIGHBOR_Y_PX);
    const continuation = line(BASE_STROKE_LENGTH_PX + MAX_WELD_GAP_PX, CONTINUATION_END_PX, 0);
    const out = weldOpenPolylines([source, parallel, continuation], OPTIONS);

    expect(out).toHaveLength(2);
    expect(out[0]?.points[0]).toEqual({ x: 0, y: 0 });
    expect(out[0]?.points.at(-1)).toEqual({ x: CONTINUATION_END_PX, y: 0 });
    expect(out[1]).toEqual(parallel);
  });

  it('does not close a merged chain across a non-continuous final gap', () => {
    const start = line(0, BASE_STROKE_LENGTH_PX, 0);
    const returning: Polyline = {
      points: [
        { x: RETURNING_START_X_PX, y: 0 },
        { x: RETURNING_CORNER_X_PX, y: 0 },
        { x: RETURNING_CORNER_X_PX, y: RETURNING_TOP_Y_PX },
        { x: 0, y: RETURNING_TOP_Y_PX },
        { x: 0, y: NEAR_LOOP_RETURN_GAP_PX },
      ],
      closed: false,
    };
    const out = weldOpenPolylines([start, returning], OPTIONS);

    expect(out).toHaveLength(1);
    expect(out[0]?.closed).toBe(false);
    expect(out[0]?.points[0]).toEqual({ x: 0, y: 0 });
    expect(out[0]?.points.at(-1)).toEqual({ x: 0, y: NEAR_LOOP_RETURN_GAP_PX });
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
