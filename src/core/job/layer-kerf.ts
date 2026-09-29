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
//
// Tabs placed by hand on a source contour follow it to the offset contour that
// lies closest (ADR-494's rule, unchanged), and each offset contour starts at
// its vertex nearest its source contour's start (kerf-ring-start.ts).

import { toMachineCoords, type DeviceProfile } from '../devices';
import { laserArcMovesEnabled } from '../devices/laser-arc-moves';
import { offsetClosedPolylinesForKerfChecked } from '../geometry/kerf-offset';
import {
  applyTransform,
  type ColoredPath,
  type Layer,
  type Polyline,
  type Transform,
  type Vec2,
} from '../scene';
import { compilationPolylines } from './compilation-polylines';
import { containmentDepths } from './containment-depth';
import { laserArcFitForMachineChords } from './cut-arc-moves';
import type { CutSegment } from './job';
import { startKerfRingsAtSources } from './kerf-ring-start';
import { placedTabPointsForKerfContours } from './laser-tab-anchors';
import { perforationPatternFor } from './operation-cut-extras';

/** Flattening for kerf contours that will be fitted with arcs. */
export const KERF_ARC_SOURCE_TOLERANCE_MM = 0.005;

/** A closed contour in machine coordinates and the tabs placed on it by hand. */
export type KerfSource = { readonly polyline: Polyline; readonly points: ReadonlyArray<Vec2> };

export type PendingKerfGroup = {
  /** Index in the layer's other segments that this path's contours precede. */
  readonly insertAt: number;
  /** The path's closed contours. */
  readonly sources: ReadonlyArray<KerfSource>;
};

/** A layer's line segments with hand-placed tabs keyed by segment index. */
export type LineSegmentsWithTabs = {
  readonly segments: ReadonlyArray<CutSegment>;
  readonly placedTabs: ReadonlyMap<number, ReadonlyArray<Vec2>>;
};

export type LayerKerfResult = LineSegmentsWithTabs & {
  /** True when the offset engine failed for any path, whose contours are then missing. */
  readonly failed: boolean;
};

type OffsetContours = {
  readonly segments: ReadonlyArray<CutSegment>;
  readonly tabs: ReadonlyArray<ReadonlyArray<Vec2>>;
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
  collected: LineSegmentsWithTabs & { readonly kerf: ReadonlyArray<PendingKerfGroup> },
  layer: Layer,
  device: DeviceProfile,
): LayerKerfResult {
  const pending = collected.kerf;
  if (pending.length === 0) return { ...collected, failed: false };
  const rings = pending.map((group) => group.sources.map((source) => source.polyline));
  const outside = enclosingOtherPaths(rings);
  const fit = kerfContoursTakeArcs(layer, device)
    ? laserArcFitForMachineChords(device, KERF_ARC_SOURCE_TOLERANCE_MM)
    : (segment: CutSegment) => segment;
  let failed = false;
  const offsets = pending.map((group, index): OffsetContours => {
    const offset = offsetGroup(rings[index] ?? [], outside[index] ?? [], layer.kerfOffsetMm);
    if (offset === null) failed = true;
    const started = startKerfRingsAtSources(offset ?? [], rings[index] ?? [], layer.kerfOffsetMm);
    return {
      segments: started.map((ring) => fit({ polyline: ring.points, closed: true })),
      tabs: placedTabPointsForKerfContours(started, group.sources),
    };
  });
  return { ...interleave(collected, pending, offsets), failed };
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

// Puts each path's offset contours back where its segments were collected, and
// re-keys every hand-placed tab by its segment's new index.
function interleave(
  collected: LineSegmentsWithTabs,
  pending: ReadonlyArray<PendingKerfGroup>,
  offsets: ReadonlyArray<OffsetContours>,
): LineSegmentsWithTabs {
  const segments: CutSegment[] = [];
  const placedTabs = new Map<number, ReadonlyArray<Vec2>>();
  const push = (segment: CutSegment, tabs: ReadonlyArray<Vec2> | undefined): void => {
    if (tabs !== undefined && tabs.length > 0) placedTabs.set(segments.length, tabs);
    segments.push(segment);
  };
  let next = 0;
  for (let index = 0; index <= collected.segments.length; index += 1) {
    while (next < pending.length && (pending[next]?.insertAt ?? 0) <= index) {
      const offset = offsets[next];
      offset?.segments.forEach((segment, ring) => push(segment, offset.tabs[ring]));
      next += 1;
    }
    const segment = collected.segments[index];
    if (segment !== undefined) push(segment, collected.placedTabs.get(index));
  }
  return { segments, placedTabs };
}
