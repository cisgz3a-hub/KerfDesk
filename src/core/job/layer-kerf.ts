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
//
// A hole narrower than twice the offset closes up and leaves no contour behind.
// Those are counted (kerf-closed-up.ts) so Job Review can say what is missing.
//
// A contour can also lose only a stretch: where it runs back over itself (a
// "P" whose closing line runs down its stem), or where two of its sides come
// closer than the kerf and it shrinks. Each contour is compared with its
// offset, and the line with no offset line near it is named with its object
// (ADR-486 Amendment 5, dropped-contour-line.ts).

import { toMachineCoords, type DeviceProfile } from '../devices';
import { laserArcMovesEnabled } from '../devices/laser-arc-moves';
import { partlyDroppedLineMm } from '../geometry/dropped-contour-line';
import { offsetClosedPolylinesForKerfChecked } from '../geometry/kerf-offset';
import { closedContourEnclosesNoArea } from '../geometry/zero-area-contour';
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
import type { CutSegment, JobDiagnostic } from './job';
import { countClosedUpRegions, kerfShrinksContour } from './kerf-closed-up';
import { kerfRingOwners, startKerfRingsAtSources } from './kerf-ring-start';
import { placedTabPointsForKerfContours } from './laser-tab-anchors';
import { perforationPatternFor } from './operation-cut-extras';

/** Flattening for kerf contours that will be fitted with arcs. */
export const KERF_ARC_SOURCE_TOLERANCE_MM = 0.005;

/** A closed contour in machine coordinates and the tabs placed on it by hand. */
export type KerfSource = {
  readonly polyline: Polyline;
  readonly points: ReadonlyArray<Vec2>;
  readonly nesting?: CutSegment['nesting'];
  /** The scene contour it comes from, for laser leads (ADR-626 Amd 1). */
  readonly leadSource?: string;
  /** The same key, always set by compile: the scene decides which side of
   * it the offset goes to (ADR-486 Amd 3). */
  readonly sceneContour?: string;
};
export type KerfContextDepth = { readonly total: number; readonly outside: number };

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
  /** Holes or slots (parts, when the offset is negative) the offset closed up
   * entirely, so they are missing although the engine succeeded. */
  readonly closedUp: number;
  /** Closed contours that enclose no area (a line drawn twice, a path out and
   * back), which the offset drops on either side (ADR-486 Amendment 4). */
  readonly noArea: number;
  /** Closed contours kept only in part, by scene contour (ADR-486 Amendment 5). */
  readonly droppedLine: ReadonlyArray<KerfDroppedLine>;
};

/** Line of one closed contour the offset left uncut, counted once where it retraces. */
export type KerfDroppedLine = { readonly sceneContour?: string; readonly lengthMm: number };

// For each ring of a path: how many rings of other paths enclose it, and how
// many rings on the layer enclose it in all.
type RingDepths = {
  readonly outside: ReadonlyArray<number>;
  readonly total: ReadonlyArray<number>;
};

type GroupOffset = {
  readonly rings: ReadonlyArray<Polyline>;
  readonly closedUp: number;
  readonly noArea: number;
};

const NO_DEPTHS: RingDepths = { outside: [], total: [] };

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
  contextDepths?: ReadonlyMap<Polyline, KerfContextDepth>,
): LayerKerfResult {
  const pending = collected.kerf;
  if (pending.length === 0) {
    return { ...collected, failed: false, closedUp: 0, noArea: 0, droppedLine: [] };
  }
  const rings = pending.map((group) => group.sources.map((source) => source.polyline));
  const depths =
    contextDepths === undefined
      ? ringDepths(rings)
      : rings.map((group) => ({
          total: group.map((ring) => contextDepths.get(ring)?.total ?? 0),
          outside: group.map((ring) => contextDepths.get(ring)?.outside ?? 0),
        }));
  const fit = kerfContoursTakeArcs(layer, device)
    ? laserArcFitForMachineChords(device, KERF_ARC_SOURCE_TOLERANCE_MM)
    : (segment: CutSegment) => segment;
  let failed = false;
  let closedUp = 0;
  let noArea = 0;
  const droppedLine: KerfDroppedLine[] = [];
  const offsets = pending.map((group, index): OffsetContours => {
    const sources = rings[index] ?? [];
    const offset = offsetGroup(sources, depths[index] ?? NO_DEPTHS, layer.kerfOffsetMm);
    if (offset === null) failed = true;
    closedUp += offset?.closedUp ?? 0;
    noArea += offset?.noArea ?? 0;
    if (offset !== null) {
      droppedLine.push(...droppedLineOf(group.sources, offset.rings, layer.kerfOffsetMm));
    }
    const started = startKerfRingsAtSources(offset?.rings ?? [], sources, layer.kerfOffsetMm);
    const leadSources = kerfLeadSources(started, group.sources, layer.kerfOffsetMm);
    return {
      segments: started.map((ring, ringIndex) => {
        const segment = fit({ polyline: ring.points, closed: true });
        const leadSource = leadSources?.[ringIndex];
        return leadSource === undefined ? segment : { ...segment, leadSource };
      }),
      tabs: placedTabPointsForKerfContours(started, group.sources),
    };
  });
  return { ...interleave(collected, pending, offsets), failed, closedUp, noArea, droppedLine };
}

// A source point is cut when an offset line passes within three offsets of it:
// a mitred corner, the furthest a correct offset strays, is under two. A run of
// at least 1 mm, and ten offsets, counts, so a sharp notch the offset fills is
// not named (ADR-486 Amendment 5).
function droppedLineOf(
  sources: ReadonlyArray<KerfSource>,
  offset: ReadonlyArray<Polyline>,
  kerfOffsetMm: number,
): KerfDroppedLine[] {
  const kerf = Math.abs(kerfOffsetMm);
  if (!Number.isFinite(kerf) || kerf === 0) return [];
  const minRunMm = Math.max(1, 10 * kerf);
  const lengths = partlyDroppedLineMm(
    sources.map((source) => source.polyline.points),
    offset.map((ring) => ring.points),
    { reachMm: 3 * kerf + 0.002, minRunMm },
  );
  return sources.flatMap((source, index) => {
    const lengthMm = lengths[index] ?? 0;
    if (lengthMm < minRunMm / 2) return [];
    return [
      source.sceneContour === undefined
        ? { lengthMm }
        : { sceneContour: source.sceneContour, lengthMm },
    ];
  });
}

// Each offset contour carries the scene contour it was offset from, when its
// sources carry one (ADR-626 Amd 1); null when none does.
function kerfLeadSources(
  rings: ReadonlyArray<Polyline>,
  sources: ReadonlyArray<KerfSource>,
  kerfOffsetMm: number,
): ReadonlyArray<string | undefined> | null {
  if (!sources.some((source) => source.leadSource !== undefined)) return null;
  const owners = kerfRingOwners(
    rings,
    sources.map((source) => source.polyline),
    kerfOffsetMm,
  );
  return owners.map((owner) => sources[owner]?.leadSource);
}

/** What the offset lost, for Job Review: a failure, holes it closed up, and
 * contours it dropped in whole or in part. `nameOf` names a scene contour's object. */
export function layerKerfDiagnostics(
  result: LayerKerfResult,
  layer: Layer,
  nameOf: (sceneContour: string | undefined) => string = () => '',
): ReadonlyArray<JobDiagnostic> {
  const diagnostics: JobDiagnostic[] = [];
  if (result.failed) diagnostics.push({ kind: 'kerf-offset-failed', layerName: layer.name });
  if (result.closedUp > 0) {
    diagnostics.push({
      kind: 'kerf-offset-closed-up',
      layerName: layer.name,
      count: result.closedUp,
      kerfOffsetMm: layer.kerfOffsetMm,
    });
  }
  if (result.noArea > 0) {
    diagnostics.push({ kind: 'kerf-offset-no-area', layerName: layer.name, count: result.noArea });
  }
  if (result.droppedLine.length > 0) {
    diagnostics.push({
      kind: 'kerf-offset-dropped-line',
      layerName: layer.name,
      kerfOffsetMm: layer.kerfOffsetMm,
      parts: result.droppedLine.map((dropped) => ({
        name: nameOf(dropped.sceneContour),
        lengthMm: dropped.lengthMm,
      })),
    });
  }
  return diagnostics;
}

function ringDepths(groups: ReadonlyArray<ReadonlyArray<Polyline>>): RingDepths[] {
  const all = containmentDepths(groups.flat().map(asContainer), { strict: true });
  let cursor = 0;
  return groups.map((rings) => {
    const own = rings.length > 1 ? containmentDepths(rings.map(asContainer), { strict: true }) : [];
    const total = rings.map((_, index) => all[cursor + index] ?? 0);
    cursor += rings.length;
    return { outside: total.map((depth, index) => depth - (own[index] ?? 0)), total };
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
  depths: RingDepths,
  kerfOffsetMm: number,
): GroupOffset | null {
  // The offset reads its contours by the even-odd rule first, which leaves no
  // region for a contour that encloses none: it is dropped whichever way the
  // offset goes, and named for what it is rather than as a hole that closed up
  // (ADR-486 Amendment 4).
  const empty = rings.map(
    (ring) =>
      Number.isFinite(kerfOffsetMm) &&
      kerfOffsetMm !== 0 &&
      closedContourEnclosesNoArea(ring.points),
  );
  const noArea = empty.filter(Boolean).length;
  const shrinking = depths.total.map(
    (depth, index) => empty[index] !== true && kerfShrinksContour(depth, kerfOffsetMm),
  );
  const parity = (depths.outside[0] ?? 0) % 2;
  if (depths.outside.every((depth) => depth % 2 === parity)) {
    const offset = offsetOrNull(rings, parity === 0 ? kerfOffsetMm : -kerfOffsetMm);
    if (offset === null) return null;
    return {
      rings: offset,
      closedUp: countClosedUpRegions(rings, depths.total, shrinking, offset),
      noArea,
    };
  }
  const out: Polyline[] = [];
  let closedUp = 0;
  for (const [index, ring] of rings.entries()) {
    const depth = depths.total[index] ?? 0;
    const offset = offsetOrNull([ring], depth % 2 === 0 ? kerfOffsetMm : -kerfOffsetMm);
    if (offset === null) return null;
    // Offset alone, a shrinking ring leaves nothing only when it closed up.
    if (offset.length === 0 && shrinking[index] === true) closedUp += 1;
    out.push(...offset);
  }
  return { rings: out, closedUp, noArea };
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
