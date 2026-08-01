// Direction arrowheads along the cut path (ADR-255 stage 14).
//
// From the competitive audit: mechsimulator offers a direction overlay and we
// had none. Without it, cut direction is invisible — and cut direction is the
// difference between climb and conventional milling, which changes finish,
// tool load and whether the work pulls out of the clamps.
//
// Arrows go on CUTTING moves only. Rapids already read as direction-agnostic
// traversal, and arrowing them would triple the clutter for no information.

import { SEG_KIND, type GcodeRenderModel } from '../../core/gcode-view';

export type ArrowPlacement = {
  /** Midpoint of the segment the arrow marks. */
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  /** Unit direction of travel. */
  readonly direction: { readonly x: number; readonly y: number; readonly z: number };
};

/** Below this a segment is too short to carry a readable arrowhead. */
const MIN_SEGMENT_MM = 0.5;
/** Roughly one arrow per this much cut path, so density suits the job size. */
const TARGET_ARROWS = 60;

/**
 * Arrow placements spread evenly along the CUT path by distance, not by
 * segment index: a program whose curves are finely sampled would otherwise
 * crowd every arrow into the curves and leave long straights bare.
 */
export function directionArrows(model: GcodeRenderModel): ReadonlyArray<ArrowPlacement> {
  const cutLength = cutPathLength(model);
  if (cutLength <= 0) return [];
  const spacing = cutLength / TARGET_ARROWS;
  const arrows: ArrowPlacement[] = [];
  let sinceLast = spacing; // place one at the first eligible move
  for (let index = 0; index < model.segmentCount; index += 1) {
    if (!isCutting(model, index)) continue;
    const span = segmentSpan(model, index);
    if (span.length < MIN_SEGMENT_MM) continue;
    sinceLast += span.length;
    if (sinceLast < spacing) continue;
    sinceLast = 0;
    arrows.push({ position: span.midpoint, direction: span.direction });
  }
  return arrows;
}

function isCutting(model: GcodeRenderModel, index: number): boolean {
  const kind = model.segKind[index];
  return kind === SEG_KIND.cut || kind === SEG_KIND.plunge;
}

function cutPathLength(model: GcodeRenderModel): number {
  let total = 0;
  for (let index = 0; index < model.segmentCount; index += 1) {
    if (isCutting(model, index)) total += segmentSpan(model, index).length;
  }
  return total;
}

function segmentSpan(
  model: GcodeRenderModel,
  index: number,
): {
  readonly length: number;
  readonly midpoint: { readonly x: number; readonly y: number; readonly z: number };
  readonly direction: { readonly x: number; readonly y: number; readonly z: number };
} {
  const base = index * 6;
  const x0 = model.positions[base] ?? 0;
  const y0 = model.positions[base + 1] ?? 0;
  const z0 = model.positions[base + 2] ?? 0;
  const x1 = model.positions[base + 3] ?? 0;
  const y1 = model.positions[base + 4] ?? 0;
  const z1 = model.positions[base + 5] ?? 0;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  const length = Math.hypot(dx, dy, dz);
  const scale = length > 0 ? 1 / length : 0;
  return {
    length,
    midpoint: { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2 },
    direction: { x: dx * scale, y: dy * scale, z: dz * scale },
  };
}
