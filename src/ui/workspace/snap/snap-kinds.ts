// snap-kinds — the vocabulary of workspace point snapping (LightBurn gap LBG-F06).
//
// LightBurn names Node, Midpoint, Center and Intersection among its snap types
// and draws a different cursor for each; the workspace follows, reusing the
// Design Studio's glyphs (ADR-272) so one symbol means one thing app-wide.
//
// Priority beats proximity, using the Design Studio's own ranking (a node is its
// 'endpoint'): when a node and the midpoint beside it are both within reach, the
// node wins, because "the corner" is what the operator meant and a
// millimetre-level miss there is the difference between a closed part and a gap.

import { snapPriority } from '../../../core/design/snap/snap-kinds';
import type { Vec2 } from '../../../core/scene';
import type { SnapSettings } from '../snap-settings';

export type PointSnapKind = 'node' | 'midpoint' | 'center' | 'intersection';

// What the canvas marker shows: a point target, or a grid crossing.
export type SnapMarkerKind = PointSnapKind | 'grid';

export type SnapMarker = {
  readonly kind: SnapMarkerKind;
  readonly pointMm: Vec2;
};

export type PointSnapTarget = {
  readonly kind: PointSnapKind;
  readonly pointMm: Vec2;
  readonly distanceMm: number;
  readonly objectId: string;
};

// Most specific first (node, intersection, midpoint, centre); distance breaks
// ties inside one kind.
export function pointSnapPriority(kind: PointSnapKind): number {
  return snapPriority(kind === 'node' ? 'endpoint' : kind);
}

// `ranking: 'distance'` ignores priority: used to pick the grabbed point of a
// moving object, where "the point nearest my hand" is the intent.
export function isBetterPointSnap(
  candidate: { readonly kind: PointSnapKind; readonly distanceMm: number },
  incumbent: { readonly kind: PointSnapKind; readonly distanceMm: number } | null,
  ranking: 'priority' | 'distance' = 'priority',
): boolean {
  if (incumbent === null) return true;
  if (ranking === 'priority') {
    const byPriority = pointSnapPriority(candidate.kind) - pointSnapPriority(incumbent.kind);
    if (byPriority !== 0) return byPriority < 0;
  }
  return candidate.distanceMm < incumbent.distanceMm;
}

export function enabledPointSnapKinds(settings: SnapSettings): ReadonlySet<PointSnapKind> {
  const kinds = new Set<PointSnapKind>();
  if (settings.snapToNodes) kinds.add('node');
  if (settings.snapToMidpoints) kinds.add('midpoint');
  if (settings.snapToCenters) kinds.add('center');
  if (settings.snapToIntersections) kinds.add('intersection');
  return kinds;
}

export function sameSnapMarker(a: SnapMarker | null, b: SnapMarker | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return (
    a.kind === b.kind && Object.is(a.pointMm.x, b.pointMm.x) && Object.is(a.pointMm.y, b.pointMm.y)
  );
}
