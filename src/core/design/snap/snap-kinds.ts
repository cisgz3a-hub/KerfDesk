// snap-kinds — the vocabulary of object snapping (ADR-272, Phase N DS-4).
//
// LightBurn names five snap point types and gives each its own cursor glyph:
// Node, Midpoint, Center, Intersection and Line (verified in its documentation,
// 2026-07-30). We adopt those five and add `quadrant` — the compass points of a
// circle or arc — because a hole's rim at 0/90/180/270 degrees is a constant
// reference when laying parts out, and CAD tools universally offer it.
//
// Priority matters as much as proximity: when several targets are within range
// the more SPECIFIC one must win, or a generic point-on-line will shadow the
// endpoint sitting right on it and precise drawing becomes guesswork.

import type { Vec2 } from '../../scene';

export type SnapKind =
  // An endpoint or a path node — LightBurn calls this Node.
  | 'endpoint'
  | 'midpoint'
  // The centre of a circle, arc, or rectangle.
  | 'center'
  // The 0/90/180/270-degree rim points of a circle or arc.
  | 'quadrant'
  | 'intersection'
  // Anywhere along an edge — the fallback, LightBurn calls this Line.
  | 'on-line';

export type SnapTarget = {
  readonly kind: SnapKind;
  readonly atMm: Vec2;
  // Which entity produced the target, so the caller can exclude the entity being
  // drawn and so the UI can highlight the thing being snapped to.
  readonly entityId: string;
};

// Most specific first. Ties inside one kind are broken by distance.
const PRIORITY: ReadonlyArray<SnapKind> = [
  'endpoint',
  'intersection',
  'midpoint',
  'center',
  'quadrant',
  'on-line',
];

export const ALL_SNAP_KINDS: ReadonlySet<SnapKind> = new Set(PRIORITY);

export function snapPriority(kind: SnapKind): number {
  const index = PRIORITY.indexOf(kind);
  // An unknown kind sorts last rather than first, so a future addition cannot
  // accidentally outrank an endpoint.
  return index < 0 ? PRIORITY.length : index;
}

// A lower score is a better target: priority dominates, distance breaks ties.
// Distance is scaled into a fraction of the tolerance so the two are comparable
// at any zoom.
export function isBetterSnap(
  candidate: { readonly kind: SnapKind; readonly distanceMm: number },
  incumbent: { readonly kind: SnapKind; readonly distanceMm: number } | null,
): boolean {
  if (incumbent === null) return true;
  const byPriority = snapPriority(candidate.kind) - snapPriority(incumbent.kind);
  if (byPriority !== 0) return byPriority < 0;
  return candidate.distanceMm < incumbent.distanceMm;
}
