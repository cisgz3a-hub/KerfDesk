// ADR-397 regression suite: centreline strokes reach the scene as compact
// cubic curves, tips extend before gaps bridge, dots become concentric marks,
// and Smoothness / Optimize drive the corner angle and fit tolerance.
//
// Before-values were measured on the pre-ADR-397 pipeline (straight segments
// over a dense Catmull-Rom resample), for the same anti-aliased fixtures and
// with the same deviation measure as below.

import { describe, expect, it } from 'vitest';
import {
  capsuleArt,
  dashedLineArt,
  dotArt,
  gapArt,
  handwritingArt,
  junctionArt,
  letter8Art,
  letterAArt,
  letterSArt,
  plusArt,
  ringArt,
  sCurveArt,
  smallCArt,
  smallEArt,
  type StrokeArt,
} from '../../../__fixtures__/centerline-stroke-art';
import { minDistanceToPolylines } from '../../../__fixtures__/perceptual/centerline-geometry';
import {
  flattenCurveSubpath,
  type ColoredPath,
  type CurveSubpath,
  type Polyline,
  type Vec2,
} from '../../scene';
import type { TraceOptions } from '../trace-image';
import { TRACE_PRESETS } from '../trace-presets';
import { fitStrokeCurve } from './stroke-curve-fit';
import { cornerAngleDeg, strokeCurvePolicy } from './stroke-curve-policy';
import { traceCenterlineStrokePaths } from './trace-centerline';

const PRESET = TRACE_PRESETS['Centerline'] as TraceOptions;

function curvesOf(paths: ReadonlyArray<ColoredPath>): CurveSubpath[] {
  return paths.flatMap((path) => [...(path.curves ?? [])]);
}

function segmentCount(curves: ReadonlyArray<CurveSubpath>): number {
  return curves.reduce((sum, curve) => sum + curve.segments.length, 0);
}

function flat(curve: CurveSubpath): Polyline {
  const result = flattenCurveSubpath(curve, { toleranceMm: 0.005 });
  if (result.kind !== 'ok') throw new Error('flatten failed');
  return result.polyline;
}

// Deviation of the traced curves from the analytic centreline, sampled every
// 0.25 px, away from the drawn stroke ends (tip extension deliberately runs
// to the ink tip, half a stroke past the analytic end).
function deviation(curves: ReadonlyArray<CurveSubpath>, art: StrokeArt) {
  const ends = art.centerlines
    .filter((line) => !line.closed)
    .flatMap((line) => [line.points[0] as Vec2, line.points.at(-1) as Vec2]);
  let max = 0;
  let sum = 0;
  let count = 0;
  for (const curve of curves) {
    const points = flat(curve).points;
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1] as Vec2;
      const b = points[i] as Vec2;
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.25));
      for (let s = 0; s < steps; s += 1) {
        const p = { x: a.x + ((b.x - a.x) * s) / steps, y: a.y + ((b.y - a.y) * s) / steps };
        if (ends.some((e) => Math.hypot(e.x - p.x, e.y - p.y) < art.strokeWidthPx * 1.5)) continue;
        const d = minDistanceToPolylines(p, art.centerlines);
        max = Math.max(max, d);
        sum += d;
        count += 1;
      }
    }
  }
  return { max, mean: sum / Math.max(1, count) };
}

describe('centreline strokes as compact cubics', () => {
  it('fits an anti-aliased 3 px ring with a handful of G1 cubics', () => {
    const art = ringArt();
    const curves = curvesOf(traceCenterlineStrokePaths(art.image, PRESET));
    expect(curves).toHaveLength(1);
    const ring = curves[0] as CurveSubpath;
    expect(ring.closed).toBe(true);
    expect(ring.segments.every((segment) => segment.kind === 'cubic')).toBe(true);
    // 128 straight segments before; measured 7 after.
    expect(ring.segments.length).toBeLessThanOrEqual(12);
    const last = ring.segments.at(-1) as CurveSubpath['segments'][number];
    expect(last.to).toEqual(ring.start);
    const { max, mean } = deviation(curves, art);
    // Before: max 0.360, mean 0.148 px. Measured after: 0.331 / 0.103.
    expect(max).toBeLessThanOrEqual(0.36);
    expect(mean).toBeLessThanOrEqual(0.148);
  });

  // Deviation from the analytic centreline may not get worse than before by
  // more than MAX_SLACK_PX (worst case) or the row's mean slack. Junction and
  // cap topology set the maxima and is shared by both pipelines; the fit adds
  // at most its 0.25 px tolerance to the faired chain.
  // Letter a is the one accepted mean regression (ADR-397): its stem's centre
  // lies on a pixel edge, the faired chain settles on the pixel-centre column
  // beside it, and the fit follows that chain where the old chords happened
  // to cut closer to the truth (measured 0.342 -> 0.415 px mean).
  const MAX_SLACK_PX = 0.07;
  const MEAN_SLACK_PX = 0.02;
  it.each([
    // name, art, segments before, max before, mean before, mean slack
    ['S-curve', sCurveArt(), 56, 1.287, 0.148, MEAN_SLACK_PX],
    ['letter S', letterSArt(), 80, 1.213, 0.262, MEAN_SLACK_PX],
    ['letter 8', letter8Art(), 112, 1.503, 0.314, MEAN_SLACK_PX],
    ['letter a', letterAArt(), 108, 1.608, 0.342, 0.08],
    ['handwriting', handwritingArt(), 88, 1.742, 0.39, MEAN_SLACK_PX],
  ] as const)(
    '%s: at least 5x fewer segments, deviation within slack of before',
    (_name, art, before, maxBefore, meanBefore, meanSlack) => {
      const paths = traceCenterlineStrokePaths(art.image, PRESET);
      const curves = curvesOf(paths);
      expect(segmentCount(curves)).toBeLessThanOrEqual(Math.floor(before / 5));
      const { max, mean } = deviation(curves, art);
      expect(max).toBeLessThanOrEqual(maxBefore + MAX_SLACK_PX);
      expect(mean).toBeLessThanOrEqual(meanBefore + meanSlack);
      // The compatibility polylines are the curves' own samples.
      const polylines = paths.flatMap((path) => path.polylines);
      curves.forEach((curve, index) => {
        const polyline = polylines[index] as Polyline;
        expect(polyline.points[0]).toEqual(curve.start);
        expect(polyline.points.at(-1)).toEqual(curve.segments.at(-1)?.to);
      });
    },
  );

  it.each([
    ['T', 0.666, 0.565],
    ['Y', 0.617, 0.367],
  ] as const)('%s junction: deviation within slack of before', (kind, maxBefore, meanBefore) => {
    const art = junctionArt(kind);
    const { max, mean } = deviation(curvesOf(traceCenterlineStrokePaths(art.image, PRESET)), art);
    expect(max).toBeLessThanOrEqual(maxBefore + MAX_SLACK_PX);
    expect(mean).toBeLessThanOrEqual(meanBefore + MEAN_SLACK_PX);
  });

  it('keeps branch attachments exact and straight strokes as lines at T, X and Y junctions', () => {
    for (const kind of ['T', 'Y'] as const) {
      const curves = curvesOf(traceCenterlineStrokePaths(junctionArt(kind).image, PRESET));
      expect(curves).toHaveLength(2);
      // The unpaired arm ends ON the through-stroke: the attachment is an
      // exact knot of the fitted curve, not a point the cubic merely passes
      // near.
      const [a, b] = curves as [CurveSubpath, CurveSubpath];
      const endOn = (branch: CurveSubpath, through: CurveSubpath): number =>
        Math.min(
          ...[branch.start, branch.segments.at(-1)?.to as Vec2].map((e) =>
            minDistanceToPolylines(e, [flat(through)]),
          ),
        );
      expect(Math.min(endOn(a, b), endOn(b, a))).toBeLessThan(1e-6);
    }
    const x = curvesOf(traceCenterlineStrokePaths(junctionArt('X').image, PRESET));
    expect(x).toHaveLength(2);
    expect(x.every((curve) => curve.segments.every((s) => s.kind === 'line'))).toBe(true);
    expect(segmentCount(x)).toBe(2);
  });

  it('meets the fit tolerance both ways on a noisy stroke (orthogonal check)', () => {
    let seed = 7;
    const noise = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.3;
    const points: Vec2[] = [];
    for (let i = 0; i <= 40; i += 1) points.push({ x: 74.5 + noise(), y: 45 + i * 0.7 });
    for (let a = 3; a <= 180; a += 3) {
      const rad = (a * Math.PI) / 180;
      points.push({ x: 68.5 + 6 * Math.cos(rad), y: 73 + 6 * Math.sin(rad) });
    }
    const curve = fitStrokeCurve(points, false, new Set(), new Set(), 0.25) as CurveSubpath;
    const drawn = flat(curve);
    const chain: Polyline = { points, closed: false };
    const curveToChain = Math.max(...drawn.points.map((p) => minDistanceToPolylines(p, [chain])));
    const chainToCurve = Math.max(...points.map((p) => minDistanceToPolylines(p, [drawn])));
    expect(curveToChain).toBeLessThanOrEqual(0.25 + 0.01);
    expect(chainToCurve).toBeLessThanOrEqual(0.25 + 0.01);
    expect(curve.segments.length).toBeLessThanOrEqual(4);
    expect(curve.start).toBe(points[0]);
  });

  it('keeps a marked corner exact and C0 while the curve stays smooth elsewhere', () => {
    const corner = { x: 50, y: 10 };
    const points: Vec2[] = [];
    for (let x = 10; x < 50; x += 1) points.push({ x, y: 10 });
    points.push(corner);
    for (let y = 11; y <= 50; y += 1) points.push({ x: 50, y });
    const curve = fitStrokeCurve(points, false, new Set([corner]), new Set(), 0.25) as CurveSubpath;
    expect(curve.segments.map((s) => s.kind)).toEqual(['line', 'line']);
    expect(curve.segments[0]?.to).toBe(corner);
  });
});

describe('centreline dots', () => {
  const NO_SPECK_FILTER = { ...PRESET, despeckleMinPixels: 0 };

  it.each([1, 1.5, 2, 3, 4, 8])(
    'a dot of radius %s becomes concentric circles that burn it solid',
    (r) => {
      const art = dotArt(r);
      const curves = curvesOf(traceCenterlineStrokePaths(art.image, NO_SPECK_FILTER));
      expect(curves.length).toBeGreaterThanOrEqual(1);
      const radii: number[] = [];
      for (const mark of curves) {
        expect(mark.closed).toBe(true);
        expect(mark.segments).toHaveLength(4);
        const points = flat(mark).points;
        const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
        const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
        expect(Math.hypot(cx - 32, cy - 32)).toBeLessThan(0.35);
        radii.push(Math.hypot((points[0] as Vec2).x - cx, (points[0] as Vec2).y - cy));
      }
      radii.sort((a, b) => a - b);
      // A beam one source pixel wide covers each circle's radius +- 0.5 px:
      // the innermost reaches the centre, neighbours overlap, and the
      // outermost reaches the dot's edge without passing it.
      expect(radii[0]).toBeLessThanOrEqual(0.5 + 1e-9);
      for (let i = 1; i < radii.length; i += 1) {
        expect((radii[i] as number) - (radii[i - 1] as number)).toBeLessThanOrEqual(1 + 1e-9);
      }
      const outer = radii.at(-1) as number;
      expect(outer + 0.5).toBeGreaterThanOrEqual(r - 0.35);
      expect(outer).toBeLessThanOrEqual(r);
    },
  );

  it('classifies the same dot the same way on the auto-upscaled grid', () => {
    for (const r of [2, 4]) {
      const art = dotArt(r);
      const native = curvesOf(
        traceCenterlineStrokePaths(art.image, {
          ...NO_SPECK_FILTER,
          autoUpscaleSmallSources: false,
        }),
      );
      const upscaled = curvesOf(traceCenterlineStrokePaths(art.image, NO_SPECK_FILTER));
      expect(native.every((curve) => curve.closed)).toBe(true);
      expect(upscaled.every((curve) => curve.closed)).toBe(true);
      expect(upscaled).toHaveLength(native.length);
    }
  });

  it('keeps the default speck filter: dots under its 12 px area still vanish', () => {
    // The fallback only replaces strokes the tracer produced. The Centerline
    // preset's speck filter removes ink under 12 px of area before tracing:
    // an anti-aliased dot of radius 1.25 px is gone, one of radius 1.5 px
    // (12 px of ink) is the smallest that becomes a mark.
    expect(curvesOf(traceCenterlineStrokePaths(dotArt(1.25).image, PRESET))).toHaveLength(0);
    const kept = curvesOf(traceCenterlineStrokePaths(dotArt(1.5).image, PRESET));
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.every((curve) => curve.closed)).toBe(true);
  });

  // Short strokes are compact too, but their own skeleton is a real stroke
  // and they are elongated or branched: each keeps the strokes it had before
  // the dot fallback existed.
  it.each([
    ['2:1 dash', capsuleArt(8, 4), 1],
    ['9x4 dash', capsuleArt(9, 4), 1],
    ['10x5 dash', capsuleArt(10, 5), 1],
    ['1.6:1 dash', capsuleArt(8, 5), 1],
    ['1.4:1 dash', capsuleArt(7, 5), 1],
    ['13 px plus', plusArt(13, 3), 2],
    ['small e', smallEArt(4, 2), 1],
    ['small c', smallCArt(4, 2), 1],
    ['smaller c', smallCArt(3, 2), 1],
    ['dashed line, 3 px gaps', dashedLineArt(6, 10, 3, 5), 6],
  ] as const)('a %s keeps its open strokes', (_name, art, strokes) => {
    for (const autoUpscaleSmallSources of [false, true]) {
      const curves = curvesOf(
        traceCenterlineStrokePaths(art.image, { ...NO_SPECK_FILTER, autoUpscaleSmallSources }),
      );
      expect(curves).toHaveLength(strokes);
      expect(curves.every((curve) => !curve.closed)).toBe(true);
    }
  });

  it('keeps long strokes as strokes and rings as rings', () => {
    const stroke = sCurveArt();
    expect(curvesOf(traceCenterlineStrokePaths(stroke.image, PRESET))[0]?.closed).toBe(false);
    const small = ringArt(6, 3);
    const ring = curvesOf(traceCenterlineStrokePaths(small.image, PRESET));
    expect(ring).toHaveLength(1);
    // A 6 px "o" keeps its centreline ring (radius 6), not dot marks.
    const points = flat(ring[0] as CurveSubpath).points;
    expect(Math.min(...points.map((p) => Math.hypot(p.x - 64, p.y - 64)))).toBeGreaterThan(5);
    const short = gapArt(200); // no second stroke: one 44 px dash, 3 px wide
    expect(curvesOf(traceCenterlineStrokePaths(short.image, PRESET))[0]?.closed).toBe(false);
  });
});

describe('tip extension runs before gap bridging', () => {
  it.each([
    [1, 1],
    [2, 1],
    [3, 2],
    [4, 2],
  ])('a %s px break in a 3 px stroke yields %s stroke(s) under the 3 px join', (gap, strokes) => {
    // Before ADR-397 every one of these stayed broken: the skeleton ends sat a
    // stroke radius inside each tip, so a 1 px break measured ~4 px.
    const art = gapArt(gap);
    const lines = traceCenterlineStrokePaths(art.image, {
      ...PRESET,
      autoUpscaleSmallSources: false,
    }).flatMap((path) => path.polylines);
    expect(lines).toHaveLength(strokes);
    // The strokes still reach both flat caps.
    const xs = lines.flatMap((line) => line.points.map((p) => p.x));
    expect(Math.min(...xs)).toBeLessThan(18.6);
    expect(Math.max(...xs)).toBeGreaterThan(109.4);
  });

  it.each([3, 5])(
    'a dashed line with 2 px gaps stays dashed at %s px wide (short pieces never bridge)',
    (width) => {
      // Tips now extend before bridging, so the 3 px join measures the paper
      // gap. A dropout leaves long pieces either side, a dash train short
      // ones: a gap bridges only when both pieces are over 6x longer.
      const art = dashedLineArt(6, 10, 2, width);
      const curves = curvesOf(
        traceCenterlineStrokePaths(art.image, { ...PRESET, autoUpscaleSmallSources: false }),
      );
      expect(curves).toHaveLength(6);
    },
  );
});

describe('Smoothness and Optimize for Centerline', () => {
  it('maps Smoothness to the corner angle and Optimize to the fit tolerance', () => {
    expect(cornerAngleDeg(0)).toBe(0);
    expect(cornerAngleDeg(0.5)).toBe(30);
    expect(cornerAngleDeg(1)).toBe(60);
    expect(cornerAngleDeg(4 / 3)).toBeCloseTo(150, 9);
    const neutral = strokeCurvePolicy(PRESET);
    expect(neutral.fitTolerancePx).toBeCloseTo(0.25, 12);
    expect(neutral.cornerAngleRad).toBeCloseTo(Math.PI / 3, 12);
    expect(neutral.drawnCornerMinRad).toBe(0);
    expect(strokeCurvePolicy({ ...PRESET, smoothness: 0 }).polygon).toBe(true);
    expect(strokeCurvePolicy({ ...PRESET, optimize: 2 }).fitTolerancePx).toBeCloseTo(0.5875, 12);
    expect(strokeCurvePolicy({ ...PRESET, pixelScale: 2 }).fitTolerancePx).toBeCloseTo(0.5, 12);
  });

  it('Smoothness 0 emits the simplified polygon; higher Optimize never adds segments', () => {
    const art = handwritingArt();
    const polygon = curvesOf(traceCenterlineStrokePaths(art.image, { ...PRESET, smoothness: 0 }));
    expect(polygon.every((curve) => curve.segments.every((s) => s.kind === 'line'))).toBe(true);
    const counts = [0, 0.2, 1, 2].map((optimize) =>
      segmentCount(curvesOf(traceCenterlineStrokePaths(art.image, { ...PRESET, optimize }))),
    );
    for (let i = 1; i < counts.length; i += 1) {
      expect(counts[i]).toBeLessThanOrEqual(counts[i - 1] as number);
    }
    expect(counts[3]).toBeLessThan(counts[0] as number);
  });
});
