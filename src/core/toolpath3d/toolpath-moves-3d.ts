// toolpathMoves3d — lifts a 2D toolpath plus its Z spans into 3D polylines.
//
// The toolpath model carries Z on three separate carriers: `cut.z` and
// `travel.z` as a ZSpan, and `plunge.fromZ/toZ`. Nothing has ever assembled
// them into a single 3D route, because the 2D canvas only ever reads Z as a
// scalar for depth shading. A 3D viewport needs the route itself.
//
// Two contracts this module deliberately honours:
//
// 1. `startMm` accumulates `step.length` VERBATIM and never re-derives length
//    from the emitted geometry. On arc and helical-contour steps the true
//    arc length deliberately differs from the chord sum of the sampled
//    polyline, so a viewer that measured its own geometry would drift out of
//    sync with the 2D scrubber. Arc-length position in mm is the one quantity
//    the 2D and 3D views can safely agree on.
//
// 2. This module is frame-AGNOSTIC: XY passes through untouched and Z is read
//    from the step's own span. It does not convert frames and must not be
//    asked to. Per ADR-254 §2 (as corrected), the viewport's single frame is
//    the removal grid's local frame — scene-space XY relative to the grid
//    origin, machine Z — mirrored once at the geometry boundary. So the
//    caller feeds this a SCENE-frame toolpath, the same one the removal grid
//    was stamped from, and the viewer applies the shared mirror to the result.
//    Feeding it one frame while the surface uses another is the failure this
//    contract exists to prevent.
//
// PURE: plain data in, plain data out.

import type { Toolpath, ToolpathStep } from '../job';
import { assertNever } from '../scene';

// Declared here rather than imported. `Vec3` lives in core/geometry but is not
// on that barrel, which sits at 19 of a hard cap of 20; `ZSpan` lives in
// core/job, whose barrel is pinned at 85 in the export ratchet and may only
// shrink. TypeScript is structural, so these stay interchangeable with the
// canonical declarations without spending either barrel's remaining room.
export type Vec3 = { readonly x: number; readonly y: number; readonly z: number };
type ZSpan = { readonly from: number; readonly to: number };

export type Move3dKind = 'cut' | 'rapid' | 'feed-travel' | 'plunge' | 'retract';

export type Move3d = {
  readonly kind: Move3dKind;
  readonly points: ReadonlyArray<Vec3>;
  // Arc-length position of this move's start, in mm from the job start.
  readonly startMm: number;
  // This move's own length, copied from the source step.
  readonly lengthMm: number;
};

// Laser steps carry no Z at all; they sit at the stock top so a mixed job
// still produces a drawable route rather than NaNs.
const DEFAULT_Z_MM = 0;

type PlanarPoint = { readonly x: number; readonly y: number };

/**
 * Lifts every step of a toolpath into a 3D polyline tagged by move kind.
 *
 * @param toolpath Machine-frame toolpath, as produced for output.
 * @returns One move per step, in program order, with cumulative start offsets.
 */
export function toolpathMoves3d(toolpath: Toolpath): ReadonlyArray<Move3d> {
  const moves: Move3d[] = [];
  let startMm = 0;
  for (const step of toolpath.steps) {
    moves.push({
      kind: moveKind(step),
      points: movePoints(step),
      startMm,
      lengthMm: step.length,
    });
    startMm += step.length;
  }
  return moves;
}

// Kinds where the bit is actually in the work.
const CUTTING_KINDS: ReadonlySet<Move3dKind> = new Set<Move3dKind>(['cut', 'plunge']);

export type DepthRange = {
  readonly minZ: number;
  readonly maxZ: number;
};

/**
 * Z range spanned by the CUTTING moves, for a depth colour ramp.
 *
 * Deliberately ignores travels and retracts: those climb to safe height, and
 * including them would stretch the ramp across clearance air so every real cut
 * collapsed into one shade. Derived from Z rather than from `cut.passIndex`,
 * which indexes the flat pass list — tab splits, extra contours and finishing
 * passes included — and is therefore not a depth ordinal.
 *
 * @param moves Moves in program order.
 * @returns The cutting Z range, or null if nothing cuts.
 */
export function moveDepthRange(moves: ReadonlyArray<Move3d>): DepthRange | null {
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const move of moves) {
    if (!CUTTING_KINDS.has(move.kind)) continue;
    for (const point of move.points) {
      if (point.z < minZ) minZ = point.z;
      if (point.z > maxZ) maxZ = point.z;
    }
  }
  return Number.isFinite(minZ) && Number.isFinite(maxZ) ? { minZ, maxZ } : null;
}

/**
 * Finds where the program first puts the tool into the material.
 *
 * Used to park the drawn cutter somewhere meaningful before playback exists:
 * the start of the first cut says both "here is where this job begins" and
 * "here is the bit that will do it". Rapids are skipped deliberately — parking
 * the tool on a traversal would suggest it cuts there.
 *
 * @param moves Moves in program order.
 * @returns The first cutting point, or null for a job that never cuts.
 */
export function firstCuttingPoint(moves: ReadonlyArray<Move3d>): Vec3 | null {
  for (const move of moves) {
    if (!CUTTING_KINDS.has(move.kind)) continue;
    const point = move.points[0];
    if (point !== undefined) return point;
  }
  return null;
}

function moveKind(step: ToolpathStep): Move3dKind {
  switch (step.kind) {
    case 'cut':
      return 'cut';
    // An absent `motion` means legacy/unspecified travel, which the model
    // documents as rapid.
    case 'travel':
      return step.motion === 'feed' ? 'feed-travel' : 'rapid';
    // A plunge step is vertical-only; its direction is what distinguishes
    // cutting downward from clearing upward, and they want different colours.
    case 'plunge':
      return step.toZ < step.fromZ ? 'plunge' : 'retract';
    default:
      return assertNever(step, 'ToolpathStep');
  }
}

function movePoints(step: ToolpathStep): ReadonlyArray<Vec3> {
  switch (step.kind) {
    case 'cut':
      return spanAlongPolyline(step.polyline, step.z);
    case 'travel':
      return spanAlongPolyline([step.from, step.to], step.z);
    case 'plunge':
      return [
        { x: step.at.x, y: step.at.y, z: step.fromZ },
        { x: step.at.x, y: step.at.y, z: step.toZ },
      ];
    default:
      return assertNever(step, 'ToolpathStep');
  }
}

// Distributes a step's Z span along its polyline by cumulative chord length, so
// a lead-in ramp descends smoothly instead of stepping at one vertex. Where the
// span is flat — which is every ordinary contour pass — this is exact. Where it
// is not, it is an even ramp: the model records only the span's endpoints, so
// the true per-vertex Z of a ramp or drill peck is not recoverable here.
function spanAlongPolyline(
  polyline: ReadonlyArray<PlanarPoint>,
  z: ZSpan | undefined,
): ReadonlyArray<Vec3> {
  const fromZ = z?.from ?? DEFAULT_Z_MM;
  const toZ = z?.to ?? fromZ;
  if (fromZ === toZ) {
    return polyline.map((point) => ({ x: point.x, y: point.y, z: fromZ }));
  }
  const cumulative = cumulativeChordLengths(polyline);
  const total = cumulative[cumulative.length - 1] ?? 0;
  if (total === 0) {
    return polyline.map((point) => ({ x: point.x, y: point.y, z: fromZ }));
  }
  return polyline.map((point, index) => ({
    x: point.x,
    y: point.y,
    z: fromZ + (toZ - fromZ) * ((cumulative[index] ?? 0) / total),
  }));
}

function cumulativeChordLengths(polyline: ReadonlyArray<PlanarPoint>): ReadonlyArray<number> {
  const lengths: number[] = [];
  let running = 0;
  for (let index = 0; index < polyline.length; index += 1) {
    const previous = polyline[index - 1];
    const current = polyline[index];
    if (previous !== undefined && current !== undefined) {
      running += Math.hypot(current.x - previous.x, current.y - previous.y);
    }
    lengths.push(running);
  }
  return lengths;
}
