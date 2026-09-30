// Centerline trace entry point (from-scratch rewrite). Pipeline:
//   preprocess (shared threshold/despeckle) → ink mask → exact distance
//   field → distance-ordered thinning → stroke graph → radius-aware spur
//   pruning → sub-pixel ridge centring (Centerline only) → junction pairing +
//   tip extension + gap bridging + smoothing →
//   compact cubic strokes, with round dots as circular marks (ADR-405).
// Produces ONE open path down the middle of every stroke — the whole point
// of centerline mode — instead of imagetracer-style double outlines.

import type { ColoredPath, Polyline } from '../../scene';
import { withCanonicalTraceCurves } from '../trace-curves';
import {
  effectivePixelScale,
  prepareTraceForContour,
  type RawImageData,
  type TraceOptions,
} from '../trace-image';
import { squaredDistanceFieldSteps, type InkMask } from './distance-field';
import { thinToMedialAxisSteps } from './medial-thinning';
import { buildStrokeGraph } from './stroke-graph';
import { condenseJunctions } from './junction-condense';
import { DEFAULT_SPUR_OPTIONS, pruneSpursSteps } from './spur-pruning';
import { assembleStrokePathsSteps } from './stroke-chains';
import { strokeCurvePolicy } from './stroke-curve-policy';
import { closeRingEndpoints } from './loop-closure';
import { withDotMarks } from './dot-marks';
import { centerGraphOnRidge } from './ridge-centering';
import { runTraceSteps, type TraceSteps } from '../trace-steps';

const CENTERLINE_COLOR = '#000000';
const INK_LUMA_MAX = 128;
const DEFAULT_JOIN_GAP_PX = 3;

export function traceCenterlineStrokePaths(
  image: RawImageData,
  options: TraceOptions,
): ColoredPath[] {
  return runTraceSteps(traceCenterlineStrokePathsSteps(image, options));
}

export function* traceCenterlineStrokePathsSteps(
  image: RawImageData,
  options: TraceOptions,
): TraceSteps<ColoredPath[]> {
  const cooperate = yield;
  const { prepared, report } = prepareTraceForContour(image, {
    ...options,
    traceMode: 'centerline',
  });
  if (report !== undefined) yield report;
  if (cooperate) yield;
  const mask = inkMaskFromPrepared(prepared);
  if (!hasInk(mask)) return [];
  const distSq = yield* squaredDistanceFieldSteps(mask);
  const { polylines } = yield* centerlineStrokesFromMaskSteps(mask, distSq, options, {
    penPath: true,
  });
  // Rings closed at a corner keep their endpoints a gap apart; make them
  // return to start so a stroked/engraved closed loop has no seam gap.
  const closed = closeRingEndpoints(polylines);
  return closed.length === 0
    ? []
    : withCanonicalTraceCurves([{ color: CENTERLINE_COLOR, polylines: closed }]);
}

/** How the lane asking for strokes places them. The Centerline lane puts each
 *  stroke on the pen's path (ADR-558): centred on the sub-pixel ridge, a bend
 *  drawn round kept round, each corner rebuilt once, and each tip walked
 *  along its cap's axis. Line + fill recentres its width-carrying strokes on
 *  their measured cross-sections (ADR-454) and keeps the strokes its width
 *  groups and region borders were tuned on, so it leaves this off. */
export type CenterlineStrokeLane = { readonly penPath: boolean };

/** The centreline strokes of an ink mask, before ring closure, in output
 *  order; `marks` names the concentric circles among them that burn round
 *  dots solid. Shared by the Centerline lane and the Line + fill lane (ADR-454),
 *  which needs the exact field and the dots kept apart. */
export function* centerlineStrokesFromMaskSteps(
  mask: InkMask,
  distSq: Float64Array,
  options: TraceOptions,
  lane: CenterlineStrokeLane,
): TraceSteps<{ readonly polylines: Polyline[]; readonly marks: ReadonlySet<Polyline> }> {
  const cooperate = yield;
  const skeleton = yield* thinToMedialAxisSteps(mask, distSq);
  const graph = buildStrokeGraph(skeleton, mask.width, mask.height);
  if (cooperate) yield;
  // Remove short corner spurs before measuring crossing arms. A replicated
  // diagonal can otherwise present many tiny corridors instead of its drawn
  // through-stroke. Condensation only contracts bridges between junctions;
  // it creates no new leaves or degree-two nodes requiring a second prune.
  const pruned = yield* pruneSpursSteps(graph, distSq, mask.width, {
    ...DEFAULT_SPUR_OPTIONS,
    pixelScale: effectivePixelScale(options),
  });
  const condensed = condenseJunctions(pruned, distSq, mask.width);
  if (cooperate) yield;
  // Thinning keeps whole pixels, so an even-width stroke's skeleton runs half
  // a pixel to one side; the pen path moves it onto the distance field's
  // sub-pixel ridge.
  const placed = lane.penPath ? centerGraphOnRidge(condensed, distSq, mask.width) : condensed;
  const polylines = yield* assembleStrokePathsSteps(placed, distSq, mask, {
    // Assembly measures the working grid; the option is a source-pixel
    // distance, so automatic enlargement must enlarge its allowance too.
    joinGapPx: (options.centerlineJoinGapPx ?? DEFAULT_JOIN_GAP_PX) * effectivePixelScale(options),
    // lineTolerance keeps its documented contract (higher = fewer vertices);
    // the preset default of 1 leaves the tuned epsilon unchanged.
    simplifyTolerance: options.lineTolerance,
    curve: strokeCurvePolicy(options),
    penPath: lane.penPath,
  });
  // Dots (round, unelongated ink whose own skeleton is degenerate) have no
  // stroke to follow; they become concentric circles that burn them solid
  // instead of vanishing or turning into dashes. They are judged on the
  // skeleton's own pixels, before centring.
  const marked = withDotMarks(polylines, mask, distSq, condensed, effectivePixelScale(options));
  const assembled = new Set(polylines);
  return { polylines: marked, marks: new Set(marked.filter((p) => !assembled.has(p))) };
}

// The shared preprocessing already binarized the image (threshold/Otsu);
// classify ink by luma so any residual grey lands on the right side.
// Fully transparent pixels are paper regardless of their hidden RGB —
// exporters routinely write black under alpha=0, and without this guard a
// transparent-background PNG traces as one canvas-sized blob.
// Exported for the contour tracer, which needs the identical ink call.
export function inkMaskFromPrepared(prepared: RawImageData): InkMask {
  const { width, height, data } = prepared;
  const ink = new Uint8Array(width * height);
  for (let i = 0; i < ink.length; i += 1) {
    const alpha = data[i * 4 + 3] ?? 255;
    if (alpha === 0) continue;
    const r = data[i * 4] ?? 255;
    const g = data[i * 4 + 1] ?? 255;
    const b = data[i * 4 + 2] ?? 255;
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    ink[i] = luma < INK_LUMA_MAX ? 1 : 0;
  }
  return { width, height, ink };
}

function hasInk(mask: InkMask): boolean {
  for (const value of mask.ink) {
    if (value === 1) return true;
  }
  return false;
}
