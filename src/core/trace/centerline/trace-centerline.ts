// Centerline trace entry point (from-scratch rewrite). Pipeline:
//   preprocess (shared threshold/despeckle) → ink mask → exact distance
//   field → distance-ordered thinning → stroke graph → radius-aware spur
//   pruning → junction pairing + tip extension + smoothing → polylines.
// Produces ONE open path down the middle of every stroke — the whole point
// of centerline mode — instead of imagetracer-style double outlines.

import type { ColoredPath } from '../../scene';
import { preprocessForTrace, type RawImageData, type TraceOptions } from '../trace-image';
import { squaredDistanceField, type InkMask } from './distance-field';
import { thinToMedialAxis } from './medial-thinning';
import { buildStrokeGraph } from './stroke-graph';
import { condenseJunctions } from './junction-condense';
import { DEFAULT_SPUR_OPTIONS, pruneSpurs } from './spur-pruning';
import { assembleStrokePaths } from './stroke-chains';
import { closeRingEndpoints } from './loop-closure';

const CENTERLINE_COLOR = '#000000';
const INK_LUMA_MAX = 128;
const DEFAULT_JOIN_GAP_PX = 3;

export function traceCenterlineStrokePaths(
  image: RawImageData,
  options: TraceOptions,
): ColoredPath[] {
  const prepared = preprocessForTrace(image, options);
  const mask = inkMaskFromPrepared(prepared);
  if (!hasInk(mask)) return [];
  const distSq = squaredDistanceField(mask);
  const skeleton = thinToMedialAxis(mask, distSq);
  const graph = buildStrokeGraph(skeleton, mask.width, mask.height);
  const condensed = condenseJunctions(graph, distSq, mask.width);
  const pruned = pruneSpurs(condensed, distSq, mask.width, DEFAULT_SPUR_OPTIONS);
  const polylines = assembleStrokePaths(pruned, distSq, mask, {
    joinGapPx: options.centerlineJoinGapPx ?? DEFAULT_JOIN_GAP_PX,
    // lineTolerance keeps its documented contract (higher = fewer vertices);
    // the preset default of 1 leaves the tuned epsilon unchanged.
    simplifyTolerance: options.lineTolerance,
  });
  // Rings closed at a corner keep their endpoints a gap apart; make them
  // return to start so a stroked/engraved closed loop has no seam gap.
  const closed = closeRingEndpoints(polylines);
  return closed.length === 0 ? [] : [{ color: CENTERLINE_COLOR, polylines: closed }];
}

// The shared preprocessing already binarized the image (threshold/Otsu);
// classify ink by luma so any residual grey lands on the right side.
// Fully transparent pixels are paper regardless of their hidden RGB —
// exporters routinely write black under alpha=0, and without this guard a
// transparent-background PNG traces as one canvas-sized blob.
function inkMaskFromPrepared(prepared: RawImageData): InkMask {
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
