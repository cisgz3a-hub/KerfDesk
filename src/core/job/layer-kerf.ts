// Kerf compensation for a line-mode layer (ADR-486).
//
// Each path's closed contours are still offset together, so a compound path
// keeps its own hole and island rules and separate parts never merge into one
// outline. What the layer adds is which side a contour is on: a contour inside
// another path's closed contour is a hole, or an island inside one, by the same
// containment rule inside-first cutting uses. Before this, a circle drawn as its
// own object inside a plate was offset as an outline, so the hole grew by twice
// the kerf instead of shrinking.
//
// Each path's closed contours wait in a PendingKerfGroup at the position its
// segments would have taken, so the source order a "keep source order" job cuts
// in is unchanged.
//
// On a machine that takes arcs, kerf contours now carry them too. The offset
// only has chords to work from, and at the usual 0.025 mm flattening the arc
// through a circle's chords misses their midpoints by as much as the tolerance,
// so those contours are flattened at KERF_ARC_SOURCE_TOLERANCE_MM instead and
// the fit spends the difference. Tabs and perforation cut contours into pieces
// that drop arcs anyway, so they keep the usual flattening.

import { toMachineCoords, type DeviceProfile } from '../devices';
import { laserArcMovesEnabled } from '../devices/laser-arc-moves';
import { offsetClosedPolylinesForKerfChecked } from '../geometry/kerf-offset';
import {
  applyTransform,
  type ColoredPath,
  type Layer,
  type Polyline,
  type Transform,
} from '../scene';
import { compilationPolylines } from './compilation-polylines';
import { containmentDepths } from './containment-depth';
import { laserArcFitForMachineChords } from './cut-arc-moves';
import type { CutSegment } from './job';
import { perforationPatternFor } from './operation-cut-extras';

/** Flattening for kerf contours that will be fitted with arcs. */
export const KERF_ARC_SOURCE_TOLERANCE_MM = 0.005;

export type PendingKerfGroup = {
  /** Index in the layer's other segments that this path's contours precede. */
  readonly insertAt: number;
  /** The path's closed contours in machine coordinates. */
  readonly rings: ReadonlyArray<Polyline>;
};

export type LayerKerfResult = {
  readonly segments: ReadonlyArray<CutSegment>;
  /** True when the offset engine failed for any path, whose contours are then missing. */
  readonly failed: boolean;
};

/**
 * The path's polylines in machine coordinates, flattened for an arc fit after
 * the kerf offset, or null when this layer's kerf contours will not carry arcs.
 * Indexed like compilationPolylines at the usual tolerance.
 */
export function kerfArcSourceRings(
  path: ColoredPath,
  transform: Transform,
  layer: Layer,
  device: DeviceProfile,
): ReadonlyArray<Polyline> | null {
  if (!kerfContoursTakeArcs(layer, device) || path.curves === undefined) return null;
  return compilationPolylines(path, transform, KERF_ARC_SOURCE_TOLERANCE_MM).map((polyline) => ({
    points: polyline.points.map((p) => toMachineCoords(applyTransform(p, transform), device)),
    closed: polyline.closed,
  }));
}

function kerfContoursTakeArcs(layer: Layer, device: DeviceProfile): boolean {
  return (
    layer.kerfOffsetMm !== 0 &&
    !layer.tabsEnabled &&
    perforationPatternFor(layer) === null &&
    laserArcMovesEnabled(device)
  );
}

export function withLayerKerf(
  segments: ReadonlyArray<CutSegment>,
  pending: ReadonlyArray<PendingKerfGroup>,
  layer: Layer,
  device: DeviceProfile,
): LayerKerfResult {
  if (pending.length === 0) return { segments, failed: false };
  const outside = enclosingOtherPaths(pending.map((group) => group.rings));
  const fit = kerfContoursTakeArcs(layer, device)
    ? laserArcFitForMachineChords(device, KERF_ARC_SOURCE_TOLERANCE_MM)
    : (segment: CutSegment) => segment;
  let failed = false;
  const offsets = pending.map((group, index) => {
    const offset = offsetGroup(group.rings, outside[index] ?? [], layer.kerfOffsetMm);
    if (offset === null) failed = true;
    return (offset ?? []).map((ring) => fit({ polyline: ring.points, closed: true }));
  });
  return { segments: interleave(segments, pending, offsets), failed };
}

// For every ring of every group: how many rings of OTHER groups enclose it.
function enclosingOtherPaths(groups: ReadonlyArray<ReadonlyArray<Polyline>>): number[][] {
  const all = containmentDepths(groups.flat().map(asContainer), { strict: true });
  let cursor = 0;
  return groups.map((rings) => {
    const own = rings.length > 1 ? containmentDepths(rings.map(asContainer), { strict: true }) : [];
    const outside = rings.map((_, index) => (all[cursor + index] ?? 0) - (own[index] ?? 0));
    cursor += rings.length;
    return outside;
  });
}

function asContainer(ring: Polyline): {
  readonly polyline: Polyline['points'];
  readonly closed: true;
} {
  return { polyline: ring.points, closed: true };
}

// Null when the offset engine failed. A path whose rings all sit inside the
// same parity of other paths keeps its one joint offset, turned inward when that
// parity is odd; a path straddling another path's contour is offset one ring at
// a time, each by its own depth.
function offsetGroup(
  rings: ReadonlyArray<Polyline>,
  outside: ReadonlyArray<number>,
  kerfOffsetMm: number,
): ReadonlyArray<Polyline> | null {
  const parity = (outside[0] ?? 0) % 2;
  if (outside.every((depth) => depth % 2 === parity)) {
    return offsetOrNull(rings, parity === 0 ? kerfOffsetMm : -kerfOffsetMm);
  }
  const own = containmentDepths(rings.map(asContainer), { strict: true });
  const out: Polyline[] = [];
  for (const [index, ring] of rings.entries()) {
    const depth = (own[index] ?? 0) + (outside[index] ?? 0);
    const offset = offsetOrNull([ring], depth % 2 === 0 ? kerfOffsetMm : -kerfOffsetMm);
    if (offset === null) return null;
    out.push(...offset);
  }
  return out;
}

function offsetOrNull(
  rings: ReadonlyArray<Polyline>,
  offsetMm: number,
): ReadonlyArray<Polyline> | null {
  const offset = offsetClosedPolylinesForKerfChecked(rings, offsetMm);
  return offset.kind === 'error' ? null : offset.value;
}

function interleave(
  segments: ReadonlyArray<CutSegment>,
  pending: ReadonlyArray<PendingKerfGroup>,
  offsets: ReadonlyArray<ReadonlyArray<CutSegment>>,
): CutSegment[] {
  const out: CutSegment[] = [];
  let next = 0;
  for (let index = 0; index <= segments.length; index += 1) {
    while (next < pending.length && (pending[next]?.insertAt ?? 0) <= index) {
      out.push(...(offsets[next] ?? []));
      next += 1;
    }
    const segment = segments[index];
    if (segment !== undefined) out.push(segment);
  }
  return out;
}
