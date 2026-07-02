// vcarvePasses — true V-carving via an inward offset ladder (Phase H.3,
// ADR-094).
//
// For the closed shapes of a layer, successive inward offsets at insets
// d_k = k·δ are cut at z(d) = −min(d / tan(θ/2), maxDepth), where θ is the
// v-bit's included tip angle. The union of the bit's cone surfaces along
// those rings converges to the true V-groove as δ → 0: the medial axis
// emerges where the offsets vanish, so sharp corners get their full depth
// for free, and clipper's containment-aware offsetting handles holes and
// narrow-channel topology (rings simply stop existing where the region is
// too narrow). Wide regions clamp to maxDepth — those rings flood the flat
// floor at δ spacing (the two-stage clearing-tool variant arrives with
// multi-tool jobs, H.7b).
//
// Rings are emitted shallow → deep (outside-in), each expanded through
// zPassDepths so no single plunge exceeds depthPerPassMm; the emitter's
// same-XY chaining turns those into efficient stepped plunges.
//
// Pure and deterministic: fixed ring ordering (k ascending, input order
// within a ring), no clock, no random.

import { offsetClosedPolylinesForKerf } from '../geometry/kerf-offset';
import type { CncPass, CncContourPass } from '../job';
import type { CncTool, Polyline } from '../scene';
import { zPassDepths } from './depth-passes';
import { hasFinitePoints } from './profile-paths';

const MIN_CLOSED_POINTS = 3;
const MIN_RESOLUTION_MM = 0.1;
const AUTO_RESOLUTION_TOOL_FRACTION = 8;
// Backstop against degenerate inputs (huge region + microscopic δ).
const MAX_VCARVE_RINGS = 8192;
// A v-bit with no/degenerate angle carves as a 60° cone rather than
// dividing by tan(0) — preflight separately warns when the active tool is
// not a v-bit at all.
const FALLBACK_TIP_ANGLE_DEG = 60;

export type VCarveOptions = {
  readonly tool: CncTool;
  readonly maxDepthMm: number;
  readonly depthPerPassMm: number;
  readonly resolutionMm: number; // 0 = auto
};

export function vcarvePasses(
  polylines: ReadonlyArray<Polyline>,
  options: VCarveOptions,
): ReadonlyArray<CncPass> {
  const contours = polylines.filter(
    (polyline) =>
      polyline.closed && polyline.points.length >= MIN_CLOSED_POINTS && hasFinitePoints(polyline),
  );
  const maxDepth = options.maxDepthMm;
  if (contours.length === 0 || !(maxDepth > 0)) return [];
  const delta = vcarveResolutionMm(options.resolutionMm, options.tool.diameterMm);
  const tanHalf = Math.tan(halfAngleRad(options.tool));

  const passes: CncContourPass[] = [];
  for (let k = 1; k <= MAX_VCARVE_RINGS; k += 1) {
    const inset = k * delta;
    const ring = offsetClosedPolylinesForKerf(contours, -inset);
    if (ring.length === 0) break;
    const ringDepth = Math.min(inset / tanHalf, maxDepth);
    appendRingPasses(passes, ring, ringDepth, options.depthPerPassMm);
  }
  return passes;
}

// Ring spacing: explicit setting wins; 0 = auto at toolDiameter/8 with a
// 0.1 mm floor so tiny engraving bits don't explode the ring count.
export function vcarveResolutionMm(settingMm: number, toolDiameterMm: number): number {
  if (Number.isFinite(settingMm) && settingMm > 0) {
    return Math.max(MIN_RESOLUTION_MM, settingMm);
  }
  return Math.max(MIN_RESOLUTION_MM, toolDiameterMm / AUTO_RESOLUTION_TOOL_FRACTION);
}

function appendRingPasses(
  passes: CncContourPass[],
  ring: ReadonlyArray<Polyline>,
  ringDepthMm: number,
  depthPerPassMm: number,
): void {
  // Complete each contour to its full ring depth before the next contour —
  // same-XY chaining makes the intermediate levels cheap stepped plunges.
  for (const polyline of ring) {
    for (const zMm of zPassDepths(ringDepthMm, depthPerPassMm)) {
      passes.push({ kind: 'contour', zMm, polyline: ringClosure(polyline), closed: true });
    }
  }
}

function halfAngleRad(tool: CncTool): number {
  const angleDeg = tool.tipAngleDeg ?? FALLBACK_TIP_ANGLE_DEG;
  const safeDeg = Number.isFinite(angleDeg) && angleDeg >= 1 ? angleDeg : FALLBACK_TIP_ANGLE_DEG;
  return (safeDeg / 2) * (Math.PI / 180);
}

// Job convention: a closed pass's polyline ends where it starts (the offset
// engine already guarantees this, but a hand-fed polyline may not).
function ringClosure(polyline: Polyline): ReadonlyArray<{ x: number; y: number }> {
  const points = polyline.points;
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return points;
  return first.x === last.x && first.y === last.y ? points : [...points, first];
}
