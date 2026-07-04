import { describe, expect, it } from 'vitest';

import {
  inkCellGlyph,
  inkDisc,
  paper,
  toRawImage,
} from '../../__fixtures__/perceptual/procedural-ink';
import { smallFeatureEffectiveAlphaMax } from './potrace-curve';
import { TRACE_PRESETS, traceImageToColoredPaths } from './index';
import { traceImageToPotraceColoredPaths } from './potrace-trace';
import type { RawImageData, TraceOptions } from './trace-image';

const LINE_ART = TRACE_PRESETS['Line Art']!;

type Pt = { readonly x: number; readonly y: number };

// Count interior turns whose direction change is at least `minDeg`, walking the
// closed polyline. A melted glyph rounds its corners into gentle curve samples,
// so sharp turns nearly vanish; a crisp trace keeps one per drawn corner.
function countSharpTurns(points: ReadonlyArray<Pt>, minDeg: number): number {
  const first = points[0];
  const last = points[points.length - 1];
  const closedDup =
    first !== undefined && last !== undefined && first.x === last.x && first.y === last.y;
  const pts = closedDup ? points.slice(0, -1) : points.slice();
  const m = pts.length;
  let count = 0;
  for (let i = 0; i < m; i += 1) {
    const prev = pts[(i - 1 + m) % m];
    const cur = pts[i];
    const next = pts[(i + 1) % m];
    if (prev === undefined || cur === undefined || next === undefined) continue;
    const ax = cur.x - prev.x;
    const ay = cur.y - prev.y;
    const bx = next.x - cur.x;
    const by = next.y - cur.y;
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la < 1e-6 || lb < 1e-6) continue;
    const cos = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)));
    if ((Math.acos(cos) * 180) / Math.PI >= minDeg) count += 1;
  }
  return count;
}

// Resample the drawn (closed) path at ~1px steps — the laser burns segments,
// not vertices, so fidelity must be measured on the polyline, not the corners.
function samplePathAtUnitSteps(points: ReadonlyArray<Pt>): Pt[] {
  const first = points[0];
  if (first === undefined) return [];
  const pts = [...points, first];
  const out: Pt[] = [];
  let carry = 0;
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    if (a === undefined || b === undefined) continue;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg < 1e-9) continue;
    let t = carry;
    while (t < seg) {
      out.push({ x: a.x + ((b.x - a.x) * t) / seg, y: a.y + ((b.y - a.y) * t) / seg });
      t += 1;
    }
    carry = t - seg;
  }
  return out;
}

// A ~15px pixel-art "E": 3px cells, 2px-wide-equivalent strokes on white. Its
// interior corners have short (~3px) polygon legs whose raw alpha (~0.74–0.80)
// sits below the default alphaMax (1.0) — the exact melt zone the fix targets.
function glyphE(): RawImageData {
  const cell = 3;
  const luma = paper(cell * 5 + 16, cell * 5 + 16);
  inkCellGlyph(luma, 8, 8, cell, ['#####', '#....', '####.', '#....', '#####']);
  return toRawImage(luma);
}

function imageFromMask(width: number, mask: ReadonlyArray<number>): RawImageData {
  const data = new Uint8ClampedArray(mask.length * 4);
  for (let i = 0; i < mask.length; i += 1) {
    const v = mask[i] === 1 ? 0 : 255;
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return { width, height: mask.length / width, data };
}

const lineArtPreset = TRACE_PRESETS['Line Art'];
if (lineArtPreset === undefined) throw new Error('Missing Line Art preset');

const straightLineArt: TraceOptions = {
  ...lineArtPreset,
  smoothness: 0,
  optimize: 0,
  ignoreLessThanPixels: 0,
  despeckleMinPixels: 0,
};

describe('traceImageToPotraceColoredPaths', () => {
  it('traces a single ink pixel as one closed black polyline', () => {
    const result = traceImageToPotraceColoredPaths(imageFromMask(1, [1]), straightLineArt);

    expect(result).toHaveLength(1);
    expect(result[0]?.color).toBe('#000000');
    expect(result[0]?.polylines).toHaveLength(1);
    const polyline = result[0]?.polylines[0];
    const points = polyline?.points ?? [];
    expect(polyline?.closed).toBe(true);
    expect(points.length).toBeGreaterThanOrEqual(5);
    expect(points[0]).toEqual(points[points.length - 1]);
    expect(Math.min(...points.map((p) => p.x))).toBe(0);
    expect(Math.min(...points.map((p) => p.y))).toBe(0);
    expect(Math.max(...points.map((p) => p.x))).toBe(1);
    expect(Math.max(...points.map((p) => p.y))).toBe(1);
  });

  it('uses the Potrace backend for Line Art filled-contour tracing', async () => {
    const image = imageFromMask(4, [0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0]);

    // Disable both auto-upscale triggers so this isolates the DISPATCH (does
    // Line Art reach the Potrace backend?) from the small-source supersample,
    // which would otherwise transform this 4x4 fixture's coordinates. Upscale
    // behaviour has its own coverage in auto-upscale.test.ts.
    const noUpscale: TraceOptions = {
      ...straightLineArt,
      autoUpscaleSmallSources: false,
      upscaleSmallSmoothSources: false,
    };
    const direct = traceImageToPotraceColoredPaths(image, noUpscale);
    const routed = await traceImageToColoredPaths(image, noUpscale);

    expect(routed).toEqual(direct);
  });

  // Sharp keeps a small 4×4 square's corners as vertices, not a rounded blob.
  //
  // History: this test previously ASSERTED the melt defect — that default
  // smoothness (1.0) MUST miss this square's corners (`worstCornerMiss > 0.7`)
  // while only Sharp kept them. The 2026-07-03 adaptive small-feature alpha fix
  // removes exactly that melt: a 4×4 square has 4px legs, which now clamp the
  // corner limit low enough that its ~90° corners stay CORNER at any smoothness.
  // So default smoothness now keeps them too, and the old contrast assertion
  // encoded the very defect being fixed. It is replaced by the correct
  // post-fix invariant: BOTH presets keep the corners.
  it('Sharp keeps the corners of a small square (default smoothness now does too)', () => {
    const sharp = TRACE_PRESETS['Sharp'];
    if (sharp === undefined) throw new Error('Missing Sharp preset');
    const side = 10;
    const mask = Array.from({ length: side * side }, (_, i) => {
      const x = i % side;
      const y = (i - x) / side;
      return x >= 3 && x < 7 && y >= 3 && y < 7 ? 1 : 0;
    });
    const image = imageFromMask(side, mask);
    const corners = [
      { x: 3, y: 3 },
      { x: 7, y: 3 },
      { x: 7, y: 7 },
      { x: 3, y: 7 },
    ];
    const worstCornerMiss = (options: TraceOptions): number => {
      const points = traceImageToPotraceColoredPaths(image, options)[0]?.polylines[0]?.points ?? [];
      let worst = 0;
      for (const corner of corners) {
        let best = Infinity;
        for (const p of points) best = Math.min(best, Math.hypot(p.x - corner.x, p.y - corner.y));
        worst = Math.max(worst, best);
      }
      return worst;
    };
    expect(worstCornerMiss(sharp)).toBeLessThan(0.7);
    // The adaptive fix makes default smoothness preserve these short-legged
    // corners too — the melt that this contrast used to prove is gone.
    expect(worstCornerMiss({ ...sharp, smoothness: 1, optimize: 0.2 })).toBeLessThan(0.7);
  });
});

// Adaptive small-feature alpha limit (2026-07-03 melt fix). At the preset
// default smoothness (alphaMax = 1.0) short-legged glyph corners used to melt
// into blobs while large arcs stayed smooth. The fix scales the corner limit by
// local leg length so BOTH hold at once.
describe('Line Art small-feature corner preservation', () => {
  it('keeps a small glyph crisp at default smoothness (alphaMax 1.0)', () => {
    const paths = traceImageToPotraceColoredPaths(glyphE(), LINE_ART);
    const points = paths.flatMap((p) => p.polylines).flatMap((pl) => pl.points);
    // An "E" has 11 drawn corners; melting leaves only the 2 outermost as
    // sharp turns. The fix must recover the interior corners. 8 sits with margin
    // above the melted floor (2) and below the crisp count (~12).
    const sharpTurns = paths
      .flatMap((p) => p.polylines)
      .reduce((sum, pl) => sum + countSharpTurns(pl.points, 60), 0);
    expect(points.length).toBeGreaterThan(0);
    expect(sharpTurns).toBeGreaterThanOrEqual(8);
  });

  it('keeps a large anti-aliased disc smooth at default smoothness (no polygonization)', () => {
    const luma = paper(180, 180);
    inkDisc(luma, 90, 90, 60, 2);
    const paths = traceImageToPotraceColoredPaths(toRawImage(luma), LINE_ART);
    const longest = paths
      .flatMap((p) => p.polylines)
      .reduce<ReadonlyArray<Pt> | null>(
        (best, pl) => (best === null || pl.points.length > best.length ? pl.points : best),
        null,
      );
    expect(longest).not.toBeNull();
    if (longest === null) return;
    const samples = samplePathAtUnitSteps(longest);
    const radii = samples.map((s) => Math.hypot(s.x - 90, s.y - 90));
    const mean = radii.reduce((sum, r) => sum + r, 0) / radii.length;
    const rms = Math.sqrt(radii.reduce((sum, r) => sum + (r - mean) ** 2, 0) / radii.length);
    // A circle has no corners, and adaptive alphaMax must not introduce any.
    expect(countSharpTurns(longest, 30)).toBe(0);
    expect(rms).toBeLessThanOrEqual(0.14);
  });
});

describe('smallFeatureEffectiveAlphaMax', () => {
  it('ramps from the crisp floor on short legs to alphaMax on long legs', () => {
    // Short legs (<= 3px) clamp to the crisp small-feature floor.
    expect(smallFeatureEffectiveAlphaMax(1, 3)).toBeCloseTo(0.55);
    expect(smallFeatureEffectiveAlphaMax(1, 1)).toBeCloseTo(0.55);
    // Mid legs ramp linearly (leg 5 is halfway through the 3..7 band).
    expect(smallFeatureEffectiveAlphaMax(1, 5)).toBeCloseTo(0.775);
    // Long legs (>= 7px) reach the caller's alphaMax.
    expect(smallFeatureEffectiveAlphaMax(1, 7)).toBeCloseTo(1);
    expect(smallFeatureEffectiveAlphaMax(1, 40)).toBeCloseTo(1);
  });

  it('is a no-op when alphaMax <= the crisp floor (Sharp preset invariant)', () => {
    // The whole point of the tie to 0.55: at or below it the min() collapses to
    // alphaMax for EVERY leg length, so Sharp (smoothness 0.55) is unchanged.
    for (const leg of [1, 3, 5, 7, 20, 60]) {
      expect(smallFeatureEffectiveAlphaMax(0.55, leg)).toBeCloseTo(0.55);
      expect(smallFeatureEffectiveAlphaMax(0.4, leg)).toBeCloseTo(0.4);
    }
  });
});
