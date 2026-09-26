// Line + fill trace (ADR-454): thin ink burns once down its centre line, wide
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
// Junction rule: a clipped stroke ENDS ON the wide region's boundary, and the
// fill outline is traced from the wide region plus the thin ink no kept stroke
// accounts for. The seam therefore has no gap (the stroke reaches the fill
// edge) and at most the pen's round cap — half a stroke width — burns twice
// over the fill. Clipped leftovers shorter than the stroke's own width (the
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
import { constantStrokeWidthPx, strokeWidthProfile } from './stroke-width';

/** Max stroke width in source pixels when the caller supplies none. */
export const DEFAULT_HYBRID_MAX_STROKE_WIDTH_PX = 4;
// A wide region must be seeded by a disc at least this much (px) wider in
// radius than the gate, so a pen line's one-pixel bulge stays a stroke.
const SEED_MARGIN_PX = 0.5;
// Width groups share a ColoredPath when their widths round alike (px).
const WIDTH_QUANTUM_PX = 0.25;

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
  const maxWidthPx = hybridMaxStrokeWidthPx(options) * scale;
  // A w-pixel line's centre pixel sits (w + 1) / 2 from the paper.
  const gateRadius = (maxWidthPx + 1) / 2;
  const wide = yield* discUnionSteps({
    width: mask.width,
    height: mask.height,
    radiusSq: wideCoreRadii(mask, distSq, gateRadius),
  });
  const centre = yield* centerlineStrokesFromMaskSteps(mask, distSq, options);
  if (cooperate) yield;
  const strokes = clippedStrokes(centre, mask, wide, gateRadius);
  const fillMask = yield* fillMaskSteps(mask, distSq, wide, strokes);
  const outlines =
    fillMask === null
      ? []
      : yield* contourPolylinesFromMaskSteps(fillMask, contourFinishOptionsFor(options));
  return [
    ...(outlines.length === 0
      ? []
      : withCanonicalTraceCurves([{ color: HYBRID_FILL_COLOR, polylines: outlines }])),
    ...strokePaths(strokes, mask, maxWidthPx),
  ];
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
  const { width, height } = mask;
  const gateSq = gateRadius * gateRadius;
  const seedSq = (gateRadius + SEED_MARGIN_PX) ** 2;
  const radiusSq = new Float64Array(width * height);
  const queue: number[] = [];
  for (let i = 0; i < distSq.length; i += 1) {
    if ((distSq[i] ?? 0) > seedSq) {
      radiusSq[i] = distSq[i] ?? 0;
      queue.push(i);
    }
  }
  for (let head = 0; head < queue.length; head += 1) {
    const i = queue[head] ?? 0;
    const x = i % width;
    const y = (i - x) / width;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const n = ny * width + nx;
        if ((radiusSq[n] ?? 0) > 0 || (distSq[n] ?? 0) <= gateSq) continue;
        radiusSq[n] = distSq[n] ?? 0;
        queue.push(n);
      }
    }
  }
  return radiusSq;
}

type KeptStroke = {
  readonly curve: CurveSubpath;
  readonly polyline: Polyline;
  /** A dot mark: concentric circles, never a pen line with a width. */
  readonly mark: boolean;
};

function clippedStrokes(
  centre: { readonly polylines: Polyline[]; readonly marks: ReadonlySet<Polyline> },
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
      const points = sampleStrokeCurve(piece.curve);
      if ((piece.startCut || piece.endCut) && pathLength(points) < minStubPx) continue;
      registerTraceCurve(points, piece.curve);
      kept.push({ curve: piece.curve, polyline: { points, closed: false }, mark });
    }
  });
  return kept;
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
  const strokeRadii = new Float64Array(width * height);
  for (const stroke of strokes) {
    for (const p of stroke.polyline.points) {
      const x = Math.floor(p.x);
      const y = Math.floor(p.y);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const i = y * width + x;
      // One pixel beyond the inscribed radius swallows the stroke's edge
      // pixels (an even-width line's second centre row sits exactly r away).
      const r = Math.sqrt(distSq[i] ?? 0) + 1;
      if (r * r > (strokeRadii[i] ?? 0)) strokeRadii[i] = r * r;
    }
  }
  const swallowed = yield* discUnionSteps({ width, height, radiusSq: strokeRadii });
  const fill = new Uint8Array(width * height);
  for (let i = 0; i < fill.length; i += 1) {
    if (mask.ink[i] === 1 && (wide[i] === 1 || swallowed[i] !== 1)) fill[i] = 1;
  }
  return { width, height, ink: componentsHoldingWideInk(fill, wide, width, height) };
}

function componentsHoldingWideInk(
  fill: Uint8Array,
  wide: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const out = new Uint8Array(fill.length);
  const queue: number[] = [];
  for (let i = 0; i < fill.length; i += 1) {
    if (wide[i] === 1 && fill[i] === 1 && out[i] === 0) {
      out[i] = 1;
      queue.push(i);
    }
  }
  for (let head = 0; head < queue.length; head += 1) {
    const i = queue[head] ?? 0;
    const x = i % width;
    const y = (i - x) / width;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const n = ny * width + nx;
        if (fill[n] !== 1 || out[n] === 1) continue;
        out[n] = 1;
        queue.push(n);
      }
    }
  }
  return out;
}

// Strokes without a steady width share one path; each steady pen width gets
// its own path carrying strokeWidthMm (local units: working pixels here, the
// object transform takes them to millimetres like every other coordinate).
function strokePaths(
  strokes: ReadonlyArray<KeptStroke>,
  mask: InkMask,
  maxWidthPx: number,
): ColoredPath[] {
  const plain: KeptStroke[] = [];
  const byWidth = new Map<number, KeptStroke[]>();
  for (const stroke of strokes) {
    const width = stroke.mark
      ? undefined
      : constantStrokeWidthPx(strokeWidthProfile(stroke.polyline.points, mask, maxWidthPx));
    if (width === undefined) {
      plain.push(stroke);
      continue;
    }
    const key = Math.max(WIDTH_QUANTUM_PX, Math.round(width / WIDTH_QUANTUM_PX) * WIDTH_QUANTUM_PX);
    byWidth.set(key, [...(byWidth.get(key) ?? []), stroke]);
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

function pathLength(points: ReadonlyArray<Vec2>): number {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a !== undefined && b !== undefined) length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}
