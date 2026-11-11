// A cut that frees a part before the engraving inside it has run (UX audit
// U3-P2-4, ADR-480 Amendment 2). Read from the compiled job, so it follows the
// exact order the G-code burns: artwork priority, then each operation's
// settings with per-artwork overrides applied. Advisory only: Sort cuts last
// is the fix, and the job itself is never changed here.
//
// Each piece of an engraving is checked on its own (rolling audit v10
// V7-P2-3, ADR-480 Amendment 3): one Fill operation holds every coaster's name,
// so asking whether one outline holds the whole operation missed every job of
// two or more parts.
import {
  boxOf,
  burnPieces,
  outlineHoldsPiece,
  polygonEdges,
  type OutlineRing,
} from './cut-before-engraving-pieces';
import type { PolygonEdgeIndex } from './geometry/polygon-edge-index';
import type { CutGroup, CutSegment, Job } from './job';
import type { Vec2 } from './scene';
import { lineOperationStrength } from './sort-cuts-last';
import { ContourBoxIndex } from './trace/contour-box-index';

export type CutBeforeEngraving = {
  /** The Line operation that cuts the outline. */
  readonly cutLayerId: string;
  /** Operations that burn inside that outline after it is cut. */
  readonly engravingLayerIds: ReadonlyArray<string>;
};

type CutRing = OutlineRing & {
  readonly layerId: string;
  readonly strength: number;
  /** Place among the job's outlines, so findings keep burn order. */
  readonly order: number;
  readonly edges: () => PolygonEdgeIndex | null;
};

type BurnGroup = Exclude<Job['groups'][number], { readonly kind: 'cnc' }>;

/**
 * Each Line operation whose closed outline runs before weaker output inside it:
 * Fill, Image, or a lighter Line such as a score. Only a closed contour frees a
 * part; one cut in pieces (tabs, perforation) stays held, so it is not counted.
 * "Weaker" is Sort cuts last's power × passes ÷ speed, so a light score frame
 * around an engraving is not called a cut. One held piece is enough: a name in
 * one coaster of a grid is cut free before it is engraved like any other.
 */
export function cutsBeforeEngraving(job: Job): ReadonlyArray<CutBeforeEngraving> {
  const found = new Map<string, Set<string>>();
  const rings: CutRing[] = [];
  /** Each cut operation's strongest outline, in burn order. */
  const cutStrength = new Map<string, number>();
  let index = ContourBoxIndex.create(rings);
  let indexed = 0;
  for (const group of job.groups) {
    if (group.kind === 'cnc' || ('focusTest' in group && group.focusTest !== undefined)) continue;
    const strength = lineOperationStrength(group);
    const open = openCutLayers(cutStrength, found, group.layerId, strength);
    if (open.size > 0) {
      if (indexed !== rings.length) {
        index = ContourBoxIndex.create(rings);
        indexed = rings.length;
      }
      for (const cutLayerId of cutsHolding(index, group, strength, open)) {
        const inside = found.get(cutLayerId) ?? new Set<string>();
        inside.add(group.layerId);
        found.set(cutLayerId, inside);
      }
    }
    if (group.kind !== 'cut') continue;
    const outlines = closedOutlines(group, strength, rings.length);
    if (outlines.length === 0) continue;
    rings.push(...outlines);
    cutStrength.set(group.layerId, Math.max(cutStrength.get(group.layerId) ?? 0, strength));
  }
  return [...cutStrength.keys()].flatMap((cutLayerId) => {
    const inside = found.get(cutLayerId);
    return inside === undefined ? [] : [{ cutLayerId, engravingLayerIds: [...inside] }];
  });
}

/** Cut operations that could still hold this burn and are not yet reported for
 * it: another operation, with an outline stronger than the burn. */
function openCutLayers(
  cutStrength: ReadonlyMap<string, number>,
  found: ReadonlyMap<string, ReadonlySet<string>>,
  layerId: string,
  strength: number,
): Set<string> {
  const open = new Set<string>();
  for (const [cutLayerId, strongest] of cutStrength) {
    if (cutLayerId === layerId || strength >= strongest) continue;
    if (found.get(cutLayerId)?.has(layerId) === true) continue;
    open.add(cutLayerId);
  }
  return open;
}

/** Earlier, stronger cuts of another operation with an outline that holds a
 * piece of this burn. Each piece meets only the outlines whose box overlaps
 * its own, and a cut stops being asked once one piece is inside it. */
function cutsHolding(
  index: ContourBoxIndex<CutRing>,
  group: BurnGroup,
  strength: number,
  open: Set<string>,
): ReadonlyArray<string> {
  const holding: string[] = [];
  for (const piece of burnPieces(group)) {
    const around = index.query(piece).sort((left, right) => left.order - right.order);
    for (const ring of around) {
      if (!open.has(ring.layerId) || ring.layerId === group.layerId) continue;
      if (strength >= ring.strength || !outlineHoldsPiece(ring, ring.edges, piece)) continue;
      open.delete(ring.layerId);
      holding.push(ring.layerId);
    }
    if (open.size === 0) break;
  }
  return holding;
}

function closedOutlines(group: CutGroup, strength: number, firstOrder: number): CutRing[] {
  return group.segments
    .map(outlineOf)
    .filter((polyline): polyline is ReadonlyArray<Vec2> => polyline !== null)
    .map((polyline, at) => {
      const ring: OutlineRing = { ...boxOf(polyline), polyline };
      return {
        ...ring,
        layerId: group.layerId,
        strength,
        order: firstOrder + at,
        edges: polygonEdges(ring),
      };
    });
}

// A contour that frees a part. Preparation turns a contour with a lead-in or
// lead-out into one open burn (ADR-626), whose contour range is still the
// closed outline it cuts (rolling audit v12 X3-P2-1, ADR-480 Amendment 4).
function outlineOf(segment: CutSegment): ReadonlyArray<Vec2> | null {
  const range = segment.leadContour;
  if (range === undefined && !segment.closed) return null;
  const polyline =
    range === undefined ? segment.polyline : segment.polyline.slice(range.from, range.to + 1);
  return polyline.length >= 3 ? polyline : null;
}
