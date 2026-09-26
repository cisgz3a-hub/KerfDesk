// Line + fill trace (ADR-443): thin ink burns once down its centre line, wide
// ink stays a filled outline — decided per skeleton branch, not per image.
//
// The medial axis (Blum 1967) carries an inscribed radius at every point. A
// part of the drawing is WIDE where it contains a disc wider than the "Max
// stroke width"; the wide region is the union of all such discs, computed
// exactly as a reverse distance transform (disc-union.ts). Everything else is
// thin. The Centerline lane's strokes are traced over the WHOLE mask, so a
// pen line that runs into a solid shape keeps one continuous centre line; the
// stroke is then clipped where it enters the wide region.
//
// Junction rule: a clipped stroke is cut on the wide region's boundary and
// its cut end reaches 1 px on into the fill (reachIntoFill), and the fill
// outline is traced from the wide region plus the thin ink no kept stroke
// accounts for. The seam therefore has no gap (the stroke touches or enters
// the fill outline) and at most the reach plus the pen's round cap burns
// twice over the fill. Clipped leftovers shorter than the stroke's own width (the
// medial stubs a square corner grows) are not strokes; their ink returns to
// the fill so corners stay square.

import type { ColoredPath, CurveSubpath, Polyline, Vec2 } from '../../scene';
import { registerTraceCurve, withCanonicalTraceCurves } from '../trace-curves';
import {
  effectivePixelScale,
  preprocessForTrace,
  type RawImageData,
  type TraceOptions,
} from '../trace-image';
import { runTraceSteps, type TraceSteps } from '../trace-steps';
import { squaredDistanceFieldSteps, type InkMask } from '../centerline/distance-field';
import {
  centerlineStrokesFromMaskSteps,
  inkMaskFromPrepared,
} from '../centerline/trace-centerline';
import { closeRingEndpoints } from '../centerline/loop-closure';
import { sampleStrokeCurve } from '../centerline/stroke-curve-fit';
import { contourFinishOptionsFor, contourPolylinesFromMaskSteps } from '../contour-trace';
import { clipCurveOutsideRegion } from './clip-stroke-curves';
import { discUnionSteps } from './disc-union';
import { HYBRID_FILL_COLOR, HYBRID_STROKE_COLOR } from './hybrid-paths';
import { isCompactBlob } from './compact-blob';
import { recentredStroke } from './recentre-stroke';
import { densePoints, floodEightConnected, pathLength } from './stroke-geometry';
import { constantStrokeWidthPx, strokeWidthProfile, type StrokeWidthProfile } from './stroke-width';

/** Max stroke width in source pixels when the caller supplies none. */
export const DEFAULT_HYBRID_MAX_STROKE_WIDTH_PX = 4;
// A wide region must be seeded by a disc at least this much (px) wider in
// radius than the gate, so a pen line's one-pixel bulge stays a stroke.
const SEED_MARGIN_PX = 0.5;
// Width groups share a ColoredPath when their widths round alike (px).
const WIDTH_QUANTUM_PX = 0.25;
// A stroke whose measured pen width exceeds the gate by more than this (px)
// is ink the pen could not have drawn: it goes to the fill. One width quantum:
// a stroke never carries a width that rounds above the Max stroke width, and
// the same test decides an isolated line and one running into a shape.
const OVERWIDE_TOLERANCE_PX = WIDTH_QUANTUM_PX;
// How far (px) a stroke's cut end reaches on into the fill (see reachIntoFill).
const JUNCTION_REACH_PX = 1;

export function traceHybridPaths(image: RawImageData, options: TraceOptions): ColoredPath[] {
  return runTraceSteps(traceHybridPathsSteps(image, options));
}

export function* traceHybridPathsSteps(
  image: RawImageData,
  options: TraceOptions,
): TraceSteps<ColoredPath[]> {
  const cooperate = yield;
  const prepared = preprocessForTrace(image, { ...options, traceMode: 'centerline' });
  if (cooperate) yield;
  const mask = inkMaskFromPrepared(prepared);
  if (!mask.ink.includes(1)) return [];
  const distSq = yield* squaredDistanceFieldSteps(mask);
  const scale = effectivePixelScale(options);
  // The 1 px floor applies on the working grid, after commit scaling, so a
  // sub-pixel preview gate is not inflated before it is scaled up.
  const maxWidthPx = Math.max(1, hybridMaxStrokeWidthPx(options) * scale);
  const profileOf = profileCache(mask, maxWidthPx);
  // A w-pixel line's centre pixel sits (w + 1) / 2 from the paper.
  const gateRadius = (maxWidthPx + 1) / 2;
  const cores = yield* discUnionSteps({
    width: mask.width,
    height: mask.height,
    radiusSq: wideCoreRadii(mask, distSq, gateRadius),
  });
  const centre = yield* centerlineStrokesFromMaskSteps(mask, distSq, options);
  if (cooperate) yield;
  const { wide, strokes } = yield* withOverwideStrokesFilled(centre, mask, distSq, cores, {
    gateRadius,
    maxWidthPx,
    profileOf,
  });
  const fillMask = yield* fillMaskSteps(mask, distSq, wide, strokes);
  const outlines =
    fillMask === null
      ? []
      : yield* contourPolylinesFromMaskSteps(fillMask, contourFinishOptionsFor(options));
  return [
    ...(outlines.length === 0
      ? []
      : withCanonicalTraceCurves([{ color: HYBRID_FILL_COLOR, polylines: outlines }])),
    ...strokePaths(strokes, profileOf),
  ];
}

type ProfileOf = (stroke: KeptStroke) => StrokeWidthProfile | null;

// Each stroke's width profile, measured once: the overwide filter and the
// width grouping both read it, and an unclipped stroke keeps its points
// array across the second clipping pass.
function profileCache(mask: InkMask, maxWidthPx: number): ProfileOf {
  const cache = new WeakMap<ReadonlyArray<Vec2>, StrokeWidthProfile | null>();
  return (stroke) => {
    const points = stroke.polyline.points;
    if (!cache.has(points)) cache.set(points, strokeWidthProfile(points, mask, maxWidthPx));
    return cache.get(points) ?? null;
  };
}

export function hybridMaxStrokeWidthPx(options: TraceOptions): number {
  const value = options.hybridMaxStrokeWidthPx;
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_HYBRID_MAX_STROKE_WIDTH_PX;
}

// Squared radii of the discs wider than the gate, restricted to the
// eight-connected cores that reach the seed radius (a hysteresis band).
function wideCoreRadii(mask: InkMask, distSq: Float64Array, gateRadius: number): Float64Array {
  const gateSq = gateRadius * gateRadius;
  const seedSq = (gateRadius + SEED_MARGIN_PX) ** 2;
  const radiusSq = new Float64Array(mask.width * mask.height);
  const seeds: number[] = [];
  distSq.forEach((d, i) => {
    if (d > seedSq) {
      radiusSq[i] = d;
      seeds.push(i);
    }
  });
  floodEightConnected(mask.width, mask.height, seeds, (n) => {
    const d = distSq[n] ?? 0;
    if ((radiusSq[n] ?? 0) > 0 || d <= gateSq) return false;
    radiusSq[n] = d;
    return true;
  });
  return radiusSq;
}

type Centre = { readonly polylines: Polyline[]; readonly marks: ReadonlySet<Polyline> };

// The disc gate reads the inscribed radius at pixel centres, so a pen line
// uniformly a pixel or two wider than the gate can slip under it (its ridge
// sits on a pixel-centre radius, or wobbles about the gate along a slant).
// Measuring each stroke straight across catches it: a stroke measurably
// wider than the Max stroke width joins the wide region as the union of its
// inscribed discs, and the strokes are clipped again against that region, so
// a thin stroke running into it still ends on the fill edge (ADR rule 5).
function* withOverwideStrokesFilled(
  centre: Centre,
  mask: InkMask,
  distSq: Float64Array,
  cores: Uint8Array,
  gate: {
    readonly gateRadius: number;
    readonly maxWidthPx: number;
    readonly profileOf: ProfileOf;
  },
): TraceSteps<{ wide: Uint8Array; strokes: KeptStroke[] }> {
  const strokes = clippedStrokes(centre, mask, cores, gate.gateRadius);
  const overwide = strokes.filter((stroke) => {
    if (stroke.mark) return false;
    if (isCompactBlob(stroke.polyline.points, mask, distSq, gate)) return true;
    const profile = gate.profileOf(stroke);
    return profile !== null && profile.medianPx > gate.maxWidthPx + OVERWIDE_TOLERANCE_PX;
  });
  if (overwide.length === 0) return { wide: cores, strokes };
  const grown = yield* discUnionSteps({
    width: mask.width,
    height: mask.height,
    radiusSq: strokeDiscRadii(mask, distSq, overwide, 0),
  });
  const wide = cores.map((c, i) => (c === 1 || grown[i] === 1 ? 1 : 0));
  return { wide, strokes: clippedStrokes(centre, mask, wide, gate.gateRadius) };
}

type KeptStroke = {
  readonly curve: CurveSubpath;
  readonly polyline: Polyline;
  /** A dot mark: concentric circles, never a pen line with a width. */
  readonly mark: boolean;
};

function clippedStrokes(
  centre: Centre,
  mask: InkMask,
  wide: Uint8Array,
  gateRadius: number,
): KeptStroke[] {
  const rings = closeRingEndpoints(centre.polylines);
  const curves =
    withCanonicalTraceCurves([{ color: HYBRID_STROKE_COLOR, polylines: rings }])[0]?.curves ?? [];
  const inWide = (p: Vec2): boolean => {
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    return x >= 0 && y >= 0 && x < mask.width && y < mask.height && wide[y * mask.width + x] === 1;
  };
  const minStubPx = 2 * gateRadius;
  const kept: KeptStroke[] = [];
  rings.forEach((polyline, index) => {
    const curve = curves[index];
    if (curve === undefined) return;
    const mark = centre.marks.has(centre.polylines[index] ?? polyline);
    for (const piece of clipCurveOutsideRegion(curve, inWide)) {
      if (piece.curve === curve) {
        kept.push({ curve, polyline, mark });
        continue;
      }
      const sampled = sampleStrokeCurve(piece.curve);
      if ((piece.startCut || piece.endCut) && pathLength(sampled) < minStubPx) continue;
      const reached = reachIntoFill(piece, sampled, mask);
      registerTraceCurve(reached.points, reached.curve);
      kept.push({
        curve: reached.curve,
        polyline: { points: reached.points, closed: false },
        mark,
      });
    }
  });
  return kept;
}

// Carry each cut end JUNCTION_REACH_PX further along its end tangent. Where a
// pen line meets a shape, the line's own ink widens the inscribed discs
// there, so the wide region reaches about a pixel up the line; the contour
// finisher smooths that one-pixel bump off the fill outline, which would
// leave a pixel of paper between the stroke end and the fill. The reach
// closes it; an end whose reach would leave the ink stays where it was.
function reachIntoFill(
  piece: { readonly curve: CurveSubpath; readonly startCut: boolean; readonly endCut: boolean },
  sampled: ReadonlyArray<Vec2>,
  mask: InkMask,
): { curve: CurveSubpath; points: Vec2[] } {
  let curve = piece.curve;
  let points = [...sampled];
  const endReach = piece.endCut ? reachPoint(points, mask) : null;
  if (endReach !== null) {
    curve = { ...curve, segments: [...curve.segments, { kind: 'line', to: endReach }] };
    points = [...points, endReach];
  }
  const startReach = piece.startCut ? reachPoint([...points].reverse(), mask) : null;
  if (startReach !== null) {
    curve = {
      ...curve,
      start: startReach,
      segments: [{ kind: 'line', to: curve.start }, ...curve.segments],
    };
    points = [startReach, ...points];
  }
  return { curve, points };
}

// The point JUNCTION_REACH_PX past the last point, along the direction the
// stroke arrives in (measured over its last pixel), or null off the ink.
function reachPoint(points: ReadonlyArray<Vec2>, mask: InkMask): Vec2 | null {
  const end = points.at(-1);
  if (end === undefined) return null;
  let back: Vec2 | undefined;
  for (let i = points.length - 2; i >= 0; i -= 1) {
    back = points[i];
    if (back !== undefined && Math.hypot(end.x - back.x, end.y - back.y) >= 1) break;
  }
  if (back === undefined) return null;
  const length = Math.hypot(end.x - back.x, end.y - back.y);
  if (length < 1e-6) return null;
  const to = {
    x: end.x + ((end.x - back.x) / length) * JUNCTION_REACH_PX,
    y: end.y + ((end.y - back.y) / length) * JUNCTION_REACH_PX,
  };
  const x = Math.floor(to.x);
  const y = Math.floor(to.y);
  const onInk =
    x >= 0 && y >= 0 && x < mask.width && y < mask.height && mask.ink[y * mask.width + x] === 1;
  return onInk ? to : null;
}

// The fill: wide ink, plus thin ink no kept stroke accounts for (corner
// stubs, pruned spurs) — but only in components that hold wide ink, so a
// stray thin fleck the centreline dropped does not come back as an outline.
function* fillMaskSteps(
  mask: InkMask,
  distSq: Float64Array,
  wide: Uint8Array,
  strokes: ReadonlyArray<KeptStroke>,
): TraceSteps<InkMask | null> {
  if (!wide.includes(1)) return null;
  const { width, height } = mask;
  const strokeRadii = strokeDiscRadii(mask, distSq, strokes, 1);
  const swallowed = yield* discUnionSteps({ width, height, radiusSq: strokeRadii });
  const fill = new Uint8Array(width * height);
  mask.ink.forEach((ink, i) => {
    if (ink === 1 && (wide[i] === 1 || swallowed[i] !== 1)) fill[i] = 1;
  });
  return { width, height, ink: componentsHoldingWideInk(fill, wide, width, height) };
}

// Squared disc radius at every stroke sample pixel: the inscribed radius plus
// `padPx`. As a stroke's cover, one pixel of pad swallows its edge pixels (an
// even-width line's second centre row sits exactly r away).
function strokeDiscRadii(
  mask: InkMask,
  distSq: Float64Array,
  strokes: ReadonlyArray<KeptStroke>,
  padPx: number,
): Float64Array {
  const { width, height } = mask;
  const radii = new Float64Array(width * height);
  for (const stroke of strokes) {
    for (const p of densePoints(stroke.polyline.points)) {
      const x = Math.floor(p.x);
      const y = Math.floor(p.y);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const i = y * width + x;
      const r = Math.sqrt(distSq[i] ?? 0) + padPx;
      if (r * r > (radii[i] ?? 0)) radii[i] = r * r;
    }
  }
  return radii;
}

function componentsHoldingWideInk(
  fill: Uint8Array,
  wide: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const out = new Uint8Array(fill.length);
  const seeds: number[] = [];
  fill.forEach((f, i) => {
    if (f === 1 && wide[i] === 1) {
      out[i] = 1;
      seeds.push(i);
    }
  });
  floodEightConnected(width, height, seeds, (n) => {
    if (fill[n] !== 1 || out[n] === 1) return false;
    out[n] = 1;
    return true;
  });
  return out;
}

// Strokes without a steady width share one path; each steady pen width gets
// its own path carrying strokeWidthMm (local units: working pixels here, the
// object transform takes them to millimetres like every other coordinate).
// A stroke that carries a width is recentred on its ink first: the skeleton
// of an even-width line sits on a pixel-centre row, half a pixel off, which a
// hairline never showed but a round-pen outline burns.
function strokePaths(strokes: ReadonlyArray<KeptStroke>, profileOf: ProfileOf): ColoredPath[] {
  const plain: KeptStroke[] = [];
  const byWidth = new Map<number, KeptStroke[]>();
  for (const stroke of strokes) {
    const profile = stroke.mark ? null : profileOf(stroke);
    const width = constantStrokeWidthPx(profile);
    if (width === undefined || profile === null) {
      plain.push(stroke);
      continue;
    }
    const key = Math.max(WIDTH_QUANTUM_PX, Math.round(width / WIDTH_QUANTUM_PX) * WIDTH_QUANTUM_PX);
    let group = byWidth.get(key);
    if (group === undefined) {
      group = [];
      byWidth.set(key, group);
    }
    group.push(recentredStroke(stroke, profile.sections));
  }
  const paths: ColoredPath[] = [];
  if (plain.length > 0) paths.push(strokePath(plain));
  for (const [width, group] of [...byWidth].sort((a, b) => a[0] - b[0])) {
    paths.push({ ...strokePath(group), strokeWidthMm: width });
  }
  return paths;
}

function strokePath(strokes: ReadonlyArray<KeptStroke>): ColoredPath {
  return {
    color: HYBRID_STROKE_COLOR,
    polylines: strokes.map((s) => s.polyline),
    curves: strokes.map((s) => s.curve),
  };
}
