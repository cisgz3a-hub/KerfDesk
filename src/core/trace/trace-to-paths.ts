// Step 3 of the LF1 image-trace port — direct tracedata → ColoredPath
// conversion, bypassing parseSvg's curve-flattening step. The headline
// quality issue with the previous Phase E pipeline was that
// imagedataToSVG emitted SVG path strings whose Q/cubic Béziers were
// then flattened at coarse tolerance inside parseSvg, throwing away
// the curve fidelity imagetracerjs had produced.
//
// LF1 solved this by using imagetracerjs's tracedata variant
// (`imagedataToTracedata`) which returns segments-with-control-points
// in a structured form. LF1 then walked those segments and converted
// Q-curves to cubic Béziers (the standard 2/3 formula) before
// rendering. We do the same thing in pure-core terms: walk the
// tracedata layers, flatten each Q-segment at high sampling density
// directly into a Polyline, and assemble ColoredPath[] in the shape
// the rest of the pipeline already consumes.
//
// Why flatten at all instead of carrying curves further? Our internal
// data model is polyline-only — the compile + G-code emit stages
// produce G1 moves over Polyline points. Carrying Béziers into the
// scene graph would require a wider refactor (Polyline → Path with
// curve segments) which is out of scope for this port. Sampling at
// SAMPLES_PER_QUADRATIC density keeps the visual quality
// indistinguishable from a true curve for typical engrave sizes.
//
// Pure-core compliant: no clock, no random, no I/O. Same lazy tracer
// load as trace-image.ts (cached promise — no re-download).

import type { Bounds, ColoredPath, Polyline, Vec2 } from '../scene';
import {
  type RawImageData,
  type TraceOptions,
  buildImageTracerOptions,
  preprocessForTrace,
} from './trace-image';

// Number of intermediate points to sample per quadratic Bezier
// segment. 16 samples produces sub-pixel resolution at typical engrave
// sizes (a Q segment is rarely more than a few millimetres long; 16
// samples per mm is well below the laser kerf width). Higher values
// produce smoother but larger output; lower values reveal facets on
// close inspection.
const SAMPLES_PER_QUADRATIC = 16;

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

let tracerPromise: Promise<ImageTracerModule> | null = null;
async function loadTracer(): Promise<ImageTracerModule> {
  if (tracerPromise === null) {
    // @ts-expect-error — imagetracerjs ships no type declarations.
    tracerPromise = import('imagetracerjs').then((mod) => {
      const resolved = (mod.default ?? mod) as unknown as ImageTracerModule;
      return resolved;
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
    for (const path of layer) {
      const polyline = segmentsToPolyline(path.segments);
      // imagetracerjs occasionally emits 0- or 1-point paths on
      // degenerate inputs; drop them to avoid downstream "polyline
      // with no edges" oddities. 2-point closed polylines (a single
      // edge) are still meaningful (degenerate dots) and pass through.
      if (polyline.points.length >= 2) polylines.push(polyline);
    }
    if (polylines.length > 0) result.push({ color, polylines });
  }
  return result;
}

// Convert one path's segment list into a Polyline. Starts with the
// first segment's start point, then for each segment pushes the end
// (for L) or N quadratic samples (for Q). All paths from imagetracerjs
// are closed by construction — the last segment's endpoint coincides
// with the first segment's start.
function segmentsToPolyline(segments: ReadonlyArray<TraceSegment>): Polyline {
  if (segments.length === 0) {
    return { points: [], closed: true };
  }
  const points: Vec2[] = [];
  const first = segments[0];
  if (first === undefined) return { points, closed: true };
  points.push({ x: first.x1, y: first.y1 });
  for (const seg of segments) {
    appendSegmentSamples(points, seg);
  }
  return { points, closed: true };
}

// Push the samples of one segment onto the running point list. Skips
// t=0 (already there as the previous segment's end / the initial
// start point) and includes t=1 (the segment's endpoint).
function appendSegmentSamples(points: Vec2[], seg: TraceSegment): void {
  if (seg.type === 'L') {
    points.push({ x: seg.x2, y: seg.y2 });
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
      x: omt2 * seg.x1 + twoOmtT * seg.x2 + t2 * seg.x3,
      y: omt2 * seg.y1 + twoOmtT * seg.y2 + t2 * seg.y3,
    });
  }
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
