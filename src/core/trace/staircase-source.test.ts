import { describe, expect, it } from 'vitest';

import type { ColoredPath, CurveSubpath, Vec2 } from '../scene';
import { isStaircaseSource } from './staircase-source';
import { TRACE_PRESETS } from './trace-presets';
import type { RawImageData, TraceOptions } from './trace-image';
import { traceImageToColoredPaths } from './trace-to-paths';
import { traceScalePlan } from './trace-upscale-policy';

const LINE_ART = TRACE_PRESETS['Line Art'] as TraceOptions;
const SMOOTH = TRACE_PRESETS['Smooth'] as TraceOptions;
const SAMPLES = 4;

// A disc of `diameter` px on a square canvas, centred off the pixel grid as in
// quality audit Q4 (+0.31, +0.17). Binary: a pixel is ink when its centre is
// inside. Otherwise anti-aliased: luma follows a 4 x 4 coverage sample.
function disc(canvas: number, diameter: number, binary: boolean): RawImageData {
  const cx = canvas / 2 + 0.31;
  const cy = canvas / 2 + 0.17;
  const r = diameter / 2;
  const data = new Uint8ClampedArray(canvas * canvas * 4).fill(255);
  for (let y = 0; y < canvas; y += 1) {
    for (let x = 0; x < canvas; x += 1) {
      let covered = 0;
      const steps = binary ? 1 : SAMPLES;
      for (let j = 0; j < steps; j += 1) {
        for (let i = 0; i < steps; i += 1) {
          const sx = x + (i + 0.5) / steps;
          const sy = y + (j + 0.5) / steps;
          if (Math.hypot(sx - cx, sy - cy) < r) covered += 1;
        }
      }
      const luma = Math.round(255 * (1 - covered / (steps * steps)));
      data.set([luma, luma, luma], (y * canvas + x) * 4);
    }
  }
  return { width: canvas, height: canvas, data };
}

function cubicAt(from: Vec2, c1: Vec2, c2: Vec2, to: Vec2, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * from.x + b * c1.x + c * c2.x + d * to.x,
    y: a * from.y + b * c1.y + c * c2.y + d * to.y,
  };
}

function outline(curve: CurveSubpath): Vec2[] {
  const points: Vec2[] = [];
  let at = curve.start;
  for (const segment of curve.segments) {
    if (segment.kind === 'cubic') {
      for (let k = 0; k < 16; k += 1) {
        points.push(cubicAt(at, segment.control1, segment.control2, segment.to, k / 16));
      }
    } else {
      points.push(at);
    }
    at = segment.to;
  }
  return points;
}

// Changes of turning direction around a closed outline, ignoring wobble below
// 2 degrees of opposite turning (the audit's inflection count).
function inflections(points: ReadonlyArray<Vec2>): number {
  const n = points.length;
  let sign = 0;
  let opposite = 0;
  let count = 0;
  for (let i = 0; i < n; i += 1) {
    const p = points[(i + n - 1) % n] as Vec2;
    const q = points[i] as Vec2;
    const r = points[(i + 1) % n] as Vec2;
    let turn = Math.atan2(r.y - q.y, r.x - q.x) - Math.atan2(q.y - p.y, q.x - p.x);
    if (turn > Math.PI) turn -= 2 * Math.PI;
    if (turn < -Math.PI) turn += 2 * Math.PI;
    if (Math.abs(turn) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(turn);
    if (Math.sign(turn) === sign) {
      opposite = 0;
      continue;
    }
    opposite += (Math.abs(turn) * 180) / Math.PI;
    if (opposite > 2) {
      sign = -sign;
      opposite = 0;
      count += 1;
    }
  }
  return count;
}

function curvesOf(paths: ReadonlyArray<ColoredPath>): CurveSubpath[] {
  return paths.flatMap((path) => path.curves ?? []);
}

describe('two-level sources trace on their own grid (ADR-530 Amendment 11)', () => {
  it('tells a two-level source from an anti-aliased one', () => {
    for (const options of [LINE_ART, SMOOTH]) {
      expect(isStaircaseSource(disc(48, 32, true), options)).toBe(true);
      expect(isStaircaseSource(disc(48, 32, false), options)).toBe(false);
    }
  });

  it('still prepares a small two-level source on the enlarged grid', () => {
    expect(traceScalePlan(disc(48, 32, true), LINE_ART)).toEqual({ kind: 'upscale', factor: 3 });
  });

  // Quality audit Q4-P2-1: on the 2x/3x route this circle drew 46 cubics with
  // 40 inflections on a 48 px canvas and 33 cubics on a 99 px one, against 6
  // smooth cubics from 100 px up (Potrace 1.16: 4).
  it.each([48, 96, 99, 100])(
    'draws a 32 px two-level circle on a %i px canvas with a few smooth cubics',
    async (canvas) => {
      for (const options of [LINE_ART, SMOOTH]) {
        const curves = curvesOf(await traceImageToColoredPaths(disc(canvas, 32, true), options));
        expect(curves).toHaveLength(1);
        const curve = curves[0] as CurveSubpath;
        expect(curve.segments.length).toBeLessThanOrEqual(8);
        expect(inflections(outline(curve))).toBe(0);
      }
    },
  );
});
