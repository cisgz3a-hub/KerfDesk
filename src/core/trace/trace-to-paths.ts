// Direct tracedata -> ColoredPath conversion, bypassing parseSvg's
// curve-flattening step. The quality lesson from LF1 was to use
// imagetracerjs's structured `imagedataToTracedata` output instead of
// routing through SVG strings. Quadratic segments are converted exactly
// to canonical cubics. A deterministic sampled compatibility view remains
// available for trace cleanup and subsystems still migrating to curves.
//
// Pure-core compliant: no clock, no random, no I/O. Same lazy tracer
// load as trace-image.ts (cached promise — no re-download).

import {
  curveSubpathBounds,
  polylineToCurveSubpath,
  type Bounds,
  type ColoredPath,
  type CubicPathSegment,
  type CurveSubpath,
  type Polyline,
  type Vec2,
} from '../scene';
import {
  type RawImageData,
  type TraceOptions,
  buildImageTracerOptions,
  preprocessForTrace,
} from './trace-image';
import {
  THIN_STROKE_UPSCALE_FACTOR,
  computeUpscaleFactor,
  downscaleTracedPaths,
  shouldAutoUpscale,
  shouldUpscaleSmallSource,
  upscaleBy,
} from './auto-upscale';
import { traceCenterlineStrokePaths } from './centerline';
import { isBinaryContourPreset, traceImageToContourColoredPaths } from './contour-trace';
import { traceImageToEdgePaths } from './edge-trace';
import { withCanonicalTraceCurves } from './trace-curves';
import { fitsTraceWorkingPixelBudget } from './trace-work-budget';

// Number of intermediate points to sample per quadratic Bezier
// segment. 16 samples produces sub-pixel resolution at typical engrave
// sizes (a Q segment is rarely more than a few millimetres long; 16
// samples per mm is well below the laser kerf width). Higher values
// produce smoother but larger output; lower values reveal facets on
// close inspection.
const SAMPLES_PER_QUADRATIC = 16;

// Post-trace cleanup thresholds, in source-image pixels. ImageTracer can
// preserve anti-aliased pixel teeth as real contour vertices; those turn into
// pointy engrave geometry. Keep this cleanup sub-pixel/small-pixel only so
// real logo corners and intentional details survive.
const GEOMETRY_EPS = 1e-6;
const SPIKE_EDGE_MAX_PX = 1.25;
const SPIKE_BASE_MAX_PX = 2;
const SPIKE_HEIGHT_MAX_PX = 0.9;
const STRAIGHT_JITTER_TOLERANCE_PX = 0.12;
const CLEANUP_MAX_PASSES = 6;

// Background palette entry — paths in this colour layer are dropped
// (we never engrave the white background). 6-digit lowercase hex to
// match parseSvg's normalised colour key.
const BACKGROUND_COLOR = '#ffffff';

// imagetracerjs `tracedata` structural type. Untyped at the JS lib
// boundary; we narrow here so the rest of this module pretends it has
// a real definition. Field names match imagetracerjs's source.

export type TraceSegmentL = {
  readonly type: 'L';
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
};

export type TraceSegmentQ = {
  readonly type: 'Q';
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly x3: number;
  readonly y3: number;
};

export type TraceSegment = TraceSegmentL | TraceSegmentQ;

export type TracePath = {
  readonly segments: ReadonlyArray<TraceSegment>;
  // Indices into the same layer's path list referencing holes inside
  // this path. We don't need to honour the hierarchy directly because
  // each contour (outer or hole) becomes its own closed Polyline; the
  // downstream even-odd fill rule handles the topology.
  readonly holechildren?: ReadonlyArray<number>;
  readonly isholepath?: boolean;
};

export type PaletteEntry = { readonly r: number; readonly g: number; readonly b: number };

export type TraceData = {
  readonly layers: ReadonlyArray<ReadonlyArray<TracePath>>;
  readonly palette: ReadonlyArray<PaletteEntry>;
  readonly width?: number;
  readonly height?: number;
};

type ImageTracerModule = {
  readonly imagedataToTracedata: (
    imgd: RawImageData,
    options?: Record<string, unknown>,
  ) => TraceData;
};

type TracedPoint = {
  readonly point: Vec2;
  readonly curveSample: boolean;
};

let tracerPromise: Promise<ImageTracerModule> | null = null;
async function loadTracer(): Promise<ImageTracerModule> {
  if (tracerPromise === null) {
    // @ts-expect-error — imagetracerjs ships no type declarations.
    tracerPromise = import('imagetracerjs')
      .then((mod) => {
        const resolved = (mod.default ?? mod) as unknown as ImageTracerModule;
        return resolved;
      })
      .catch((error: unknown) => {
        tracerPromise = null;
        throw error;
      });
  }
  return tracerPromise;
}

// Public entry point. Runs the existing preprocessing chain (raster-
// prep adjustments → median → dither/threshold → despeckle) and feeds
// the result into imagetracerjs's tracedata path. Returns ColoredPath[]
// ready to drop into a TracedImage SceneObject — no parseSvg step in
// between, so curve fidelity survives.
export async function traceImageToColoredPaths(
  image: RawImageData,
  options: TraceOptions,
): Promise<ColoredPath[]> {
  // Small sources trace poorly at native resolution; supersample, trace, then
  // scale the vectors back down by the SAME factor. The inner dispatch is
  // called directly so this never re-enters itself and double-upscales.
  // pixelScale rides along so pixel-denominated cleanup caps (despeckle,
  // pinhole fill, min-area, simplify ε, sharpener regime bounds) keep their
  // SOURCE-pixel semantics on the supersampled raster.
  const factor = upscaleFactorFor(image, options);
  if (factor > 1) {
    const scaledOptions: TraceOptions = { ...options, pixelScale: factor };
    const upscaled = withCanonicalTraceCurves(
      await dispatchTrace(upscaleBy(image, factor), scaledOptions),
    );
    return downscaleTracedPaths(upscaled, factor);
  }
  return withCanonicalTraceCurves(await dispatchTrace(image, options));
}

// The supersample factor to apply, or 1 (no upscale). Two independent triggers,
// deliberately with DIFFERENT factors:
//   * autoUpscaleSmallSources — thin strokes (<~3px), the original mkbitmap
//     policy; fires on any preset that opts in, at the fixed historical 2x that
//     its fixtures/tests were tuned to.
//   * upscaleSmallSmoothSources — small overall size regardless of stroke
//     thickness; set only on the smooth-wanting presets (Sharp opts out so its
//     pixel-art notches are never anti-aliased away). Uses the ADAPTIVE factor
//     so the smallest letters reach a smooth working size instead of a fixed 2x
//     that still facets a 40px letter.
// If both fire, take the larger factor.
//
// Interpolation is BILINEAR for both — two higher-order kernels were measured on
// the small-smooth path against the facet harness and BOTH rejected:
//   * Bicubic (Catmull-Rom / Mitchell-Netravali, 2026-07-04): smooths the
//     CURVE-dominated glyphs but REGRESSES the corner/straight-dominated E (E@40
//     2.07%->5.10%/4.64%) via overshoot/ringing at E's dense step edges.
//   * Monotone cubic (PCHIP / Fritsch-Carlson, 2026-07-04): chosen because it is
//     provably overshoot-free, so E "could not" ring. It regressed E just as
//     hard anyway — E@40 2.07%->5.10%, E@60 3.04%->3.38% — while B@40 (3.06%) and
//     S@40 (4.52%) still missed their improvement targets. The overshoot-free
//     unit tests passed, which proves the E faceting is NOT interpolation
//     ringing: it comes from the downstream Canny/DP fit reacting to any smoother
//     (higher-point-count) upscaled raster, so no interpolation kernel can fix it
//     from here. Bilinear is the balanced optimum; keep it.
function upscaleFactorFor(image: RawImageData, options: TraceOptions): number {
  const thinStroke = options.autoUpscaleSmallSources === true && shouldAutoUpscale(image);
  const smallSmooth = options.upscaleSmallSmoothSources === true && shouldUpscaleSmallSource(image);
  const thinFactor = thinStroke ? THIN_STROKE_UPSCALE_FACTOR : 1;
  const smallFactor = smallSmooth ? computeUpscaleFactor(image) : 1;
  // Quality supersample for the contour-finished presets (mkbitmap's
  // recipe): mid-size art carries MIXED stroke widths — thick letters that
  // defeat the thin-stroke detector alongside 1-2px features (hooked apex
  // tips, pale subtitle strokes) that binarization physically misshapes at
  // 1x. Neither legacy trigger fires there, so the presets opt in
  // explicitly; the pixel budget cap keeps the 4x cost off photos and huge
  // scans. Edge Detection is contour-finished too (local-contrast mask →
  // shared finisher), so its opt-in rides the same flag.
  const contourQuality =
    options.supersampleContour === true &&
    (isBinaryContourPreset(options) || options.traceMode === 'edge');
  const contourFactor = contourQuality ? THIN_STROKE_UPSCALE_FACTOR : 1;
  let factor = Math.max(thinFactor, smallFactor, contourFactor);
  while (factor > 1 && !fitsTraceWorkingPixelBudget(image, factor, options)) {
    factor -= 1;
  }
  return factor;
}

// The backend selection shared by both the direct and the upscaled paths.
// Extracted so the public wrapper stays a thin guard and complexity stays
// under the lint cap.
async function dispatchTrace(image: RawImageData, options: TraceOptions): Promise<ColoredPath[]> {
  if (options.traceMode === 'centerline') return traceCenterlineStrokePaths(image, options);
  if (options.traceMode === 'edge') return traceImageToEdgePaths(image, options);
  // The binary filled-contours lane (Line Art / Smooth / Sharp) is traced by
  // the in-house contour backend (ADR-123). imagetracerjs remains only for
  // the multi-colour, no-fixed-palette path below.
  if (isBinaryContourPreset(options)) return traceImageToContourColoredPaths(image, options);
  const tracer = await loadTracer();
  const prepared = preprocessForTrace(image, options);
  const td = tracer.imagedataToTracedata(prepared, buildImageTracerOptions(options));
  return tracedataToColoredPaths(td);
}

// Pure conversion — exported for direct testing so we don't need to
// invoke imagetracerjs to verify the geometry.
export function tracedataToColoredPaths(td: TraceData): ColoredPath[] {
  const result: ColoredPath[] = [];
  const layerCount = Math.min(td.layers.length, td.palette.length);
  for (let i = 0; i < layerCount; i += 1) {
    const palette = td.palette[i];
    const layer = td.layers[i];
    if (palette === undefined || layer === undefined) continue;
    const color = paletteToHex(palette);
    if (color === BACKGROUND_COLOR) continue;
    const polylines: Polyline[] = [];
    const curves: CurveSubpath[] = [];
    for (const path of layer) {
      const geometry = segmentsToGeometry(path.segments);
      // imagetracerjs occasionally emits 0- or 1-point paths on
      // degenerate inputs; drop them to avoid downstream "polyline
      // with no edges" oddities. 2-point closed polylines (a single
      // edge) are still meaningful (degenerate dots) and pass through.
      if (geometry.polyline.points.length >= 2) {
        polylines.push(geometry.polyline);
        curves.push(geometry.curve);
      }
    }
    if (polylines.length > 0) result.push({ color, polylines, curves });
  }
  return result;
}

// Convert one path's segment list into a Polyline. Starts with the
// first segment's start point, then for each segment pushes the end
// (for L) or N quadratic samples (for Q). All paths from imagetracerjs
// are closed by construction — the last segment's endpoint coincides
// with the first segment's start.
function segmentsToGeometry(segments: ReadonlyArray<TraceSegment>): {
  readonly polyline: Polyline;
  readonly curve: CurveSubpath;
} {
  if (segments.length === 0) {
    const polyline = { points: [], closed: true };
    return { polyline, curve: polylineToCurveSubpath(polyline) };
  }
  const points: TracedPoint[] = [];
  const first = segments[0];
  if (first === undefined) {
    const polyline = { points: [], closed: true };
    return { polyline, curve: polylineToCurveSubpath(polyline) };
  }
  points.push({ point: { x: first.x1, y: first.y1 }, curveSample: false });
  for (const seg of segments) {
    appendSegmentSamples(points, seg);
  }
  const cleaned = cleanTracedPoints(points);
  const polyline: Polyline = { points: cleaned, closed: true };
  return {
    polyline,
    curve:
      cleaned.length === points.length
        ? segmentsToCurveSubpath(segments)
        : polylineToCurveSubpath(polyline),
  };
}

function segmentsToCurveSubpath(segments: ReadonlyArray<TraceSegment>): CurveSubpath {
  const first = segments[0];
  if (first === undefined) return { start: { x: 0, y: 0 }, segments: [], closed: true };
  return {
    start: { x: first.x1, y: first.y1 },
    segments: segments.map((segment) => {
      if (segment.type === 'L')
        return { kind: 'line' as const, to: { x: segment.x2, y: segment.y2 } };
      return quadraticTraceSegmentAsCubic(segment);
    }),
    closed: true,
  };
}

function quadraticTraceSegmentAsCubic(segment: TraceSegmentQ): CubicPathSegment {
  return {
    kind: 'cubic',
    control1: {
      x: segment.x1 + (2 / 3) * (segment.x2 - segment.x1),
      y: segment.y1 + (2 / 3) * (segment.y2 - segment.y1),
    },
    control2: {
      x: segment.x3 + (2 / 3) * (segment.x2 - segment.x3),
      y: segment.y3 + (2 / 3) * (segment.y2 - segment.y3),
    },
    to: { x: segment.x3, y: segment.y3 },
  };
}

// Push the samples of one segment onto the running point list. Skips
// t=0 (already there as the previous segment's end / the initial
// start point) and includes t=1 (the segment's endpoint).
function appendSegmentSamples(points: TracedPoint[], seg: TraceSegment): void {
  if (seg.type === 'L') {
    points.push({ point: { x: seg.x2, y: seg.y2 }, curveSample: false });
    return;
  }
  // Q — quadratic Bezier with start (x1,y1), control (x2,y2), end
  // (x3,y3). Standard parametric form:
  //   B(t) = (1-t)^2 * P0 + 2(1-t)t * P1 + t^2 * P2
  for (let s = 1; s <= SAMPLES_PER_QUADRATIC; s += 1) {
    const t = s / SAMPLES_PER_QUADRATIC;
    const omt = 1 - t;
    const omt2 = omt * omt;
    const t2 = t * t;
    const twoOmtT = 2 * omt * t;
    points.push({
      point: {
        x: omt2 * seg.x1 + twoOmtT * seg.x2 + t2 * seg.x3,
        y: omt2 * seg.y1 + twoOmtT * seg.y2 + t2 * seg.y3,
      },
      curveSample: true,
    });
  }
}

function cleanTracedPoints(points: ReadonlyArray<TracedPoint>): Vec2[] {
  if (points.length < 4) return toVec2(points);
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined || !samePoint(first.point, last.point)) {
    return toVec2(points);
  }

  const rawRing = points.slice(0, -1);
  if (rawRing.length < 3) return toVec2(points);

  let ring = removeDuplicateRingPoints(rawRing);
  if (ring.length < 3) return toVec2(points);

  for (let pass = 0; pass < CLEANUP_MAX_PASSES; pass += 1) {
    const next = cleanupRingPass(ring);
    if (next.length === ring.length) break;
    ring = next;
    if (ring.length < 3) return toVec2(points);
  }

  const closed = toVec2(ring);
  const start = closed[0];
  return start === undefined ? toVec2(points) : [...closed, start];
}

function cleanupRingPass(points: ReadonlyArray<TracedPoint>): TracedPoint[] {
  const kept: TracedPoint[] = [];
  const count = points.length;
  for (let i = 0; i < count; i += 1) {
    const prev = points[(i + count - 1) % count];
    const curr = points[i];
    const next = points[(i + 1) % count];
    if (prev === undefined || curr === undefined || next === undefined) continue;
    const canClean = !curr.curveSample;
    if (
      canClean &&
      (isTinySpike(prev.point, curr.point, next.point) ||
        isNearlyCollinearJitter(prev.point, curr.point, next.point))
    ) {
      continue;
    }
    kept.push(curr);
  }
  return kept.length >= 3 ? kept : [...points];
}

function removeDuplicateRingPoints(points: ReadonlyArray<TracedPoint>): TracedPoint[] {
  const out: TracedPoint[] = [];
  for (const point of points) {
    const prev = out[out.length - 1];
    if (prev !== undefined && samePoint(prev.point, point.point)) continue;
    out.push(point);
  }
  return out;
}

function isTinySpike(a: Vec2, b: Vec2, c: Vec2): boolean {
  const ab = distance(a, b);
  const bc = distance(b, c);
  const ac = distance(a, c);
  if (ab <= GEOMETRY_EPS || bc <= GEOMETRY_EPS) return true;
  if (Math.max(ab, bc) > SPIKE_EDGE_MAX_PX) return false;
  if (ac > SPIKE_BASE_MAX_PX) return false;
  return distancePointToLine(b, a, c) <= SPIKE_HEIGHT_MAX_PX;
}

function isNearlyCollinearJitter(a: Vec2, b: Vec2, c: Vec2): boolean {
  const ab = distance(a, b);
  const bc = distance(b, c);
  const ac = distance(a, c);
  if (ab <= GEOMETRY_EPS || bc <= GEOMETRY_EPS) return true;
  if (ac <= GEOMETRY_EPS) return false;
  const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
  if (dot <= 0) return false;
  return distancePointToLine(b, a, c) <= STRAIGHT_JITTER_TOLERANCE_PX;
}

function distancePointToLine(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len <= GEOMETRY_EPS) return distance(p, a);
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return distance(a, b) <= GEOMETRY_EPS;
}

function toVec2(points: ReadonlyArray<TracedPoint>): Vec2[] {
  return points.map((p) => p.point);
}

// Palette entry → 6-digit lowercase hex. Matches the colour-key
// convention used everywhere else (parseSvg's normalised colour,
// layer.color, etc.) so a traced image can share a layer with an
// imported SVG of the same colour.
function paletteToHex(p: PaletteEntry): string {
  return `#${byteToHex(p.r)}${byteToHex(p.g)}${byteToHex(p.b)}`;
}

function byteToHex(n: number): string {
  const v = Math.max(0, Math.min(255, Math.round(n)));
  return v.toString(16).padStart(2, '0');
}

// Tight bounding box around every point in every ColoredPath. Used by
// ImportImageDialog (and any future caller) to construct the
// TracedImage's `bounds` field — analogous to parseSvg's viewBox-based
// bounds but always reflecting the actual traced geometry. Empty input
// returns a zero-area bounds at the origin.
export function boundsFromColoredPaths(paths: ReadonlyArray<ColoredPath>): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const path of paths) {
    if (path.curves !== undefined) {
      for (const curve of path.curves) {
        const bounds = curveSubpathBounds(curve);
        minX = Math.min(minX, bounds.minX);
        minY = Math.min(minY, bounds.minY);
        maxX = Math.max(maxX, bounds.maxX);
        maxY = Math.max(maxY, bounds.maxY);
      }
      continue;
    }
    for (const pl of path.polylines) {
      for (const p of pl.points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}
