// mergeTextObjectContours — resolve each text object's own glyphs with
// non-zero fill before a V-carve layer's contours are pooled even-odd
// (ADR-286).
//
// Font outlines are authored under the non-zero winding rule: OpenType defines
// a glyph's interior as any point with a non-zero winding number. Connected
// script faces rely on that — adjacent glyphs of Pacifico or Dancing Script
// overlap at every letter join. Read even-odd, each overlap lens cancels, so
// the planner sees the symmetric difference and the join carves as a raised
// bridge of untouched material. Vectric's manual promises the opposite for
// exactly this font class, and our own laser fill already selects non-zero
// when a layer carries text (core/job/fill-rule.ts).
//
// Scope is deliberately one object: a glyph's counter is wound opposite its
// outer contour, so a non-zero union keeps counters as holes, while pooling
// ACROSS objects stays even-odd — two overlapping text objects still knock
// out, and an imported SVG that means even-odd is never rewritten by sharing a
// layer with text.
//
// OPEN contours are never merged. Clipper has no concept of an open ring:
// pathDToPolyline returns `closed: true` for everything, so unioning a
// single-line font's strokes would manufacture a filled region out of
// centrelines and plunge the V-bit across the letterform's hull. A V-carve
// layer of open paths must keep emitting nothing, which is what
// vcarve-medial's validClosedSource and the all-open-paths note both rely on.
// Contours whose producing object is unknown (legacy fixtures, direct
// cncGroupForLayer callers) pass through for the same reason.
//
// A union failure yields that group's original contours rather than dropping
// them: the planner then reads them exactly as it did before this rule
// existed. Nothing here refuses anything (rule 7).

import { normalizeClosedPolylinesNonZeroChecked } from '../geometry/polygon-difference';
import type { Polyline } from '../scene';
import type { CollectedCncContour } from './cnc-manual-tab-mapping';

type ContourGroup = {
  // null for anything that must not be merged: non-text families, open
  // contours, and text whose producing object is unknown.
  readonly objectId: string | null;
  readonly polylines: Polyline[];
};

/**
 * The layer's contours with each text object's own glyphs resolved into
 * non-zero filled regions. Order is preserved: a merged region takes the
 * position of that object's first contour, and every unmerged contour keeps
 * its place, so the source-region layout still reads artwork order.
 */
export function mergeTextObjectContours(
  contours: ReadonlyArray<CollectedCncContour>,
): ReadonlyArray<Polyline> {
  const groups = groupByTextObject(contours);
  return groups.flatMap((group) =>
    group.objectId === null ? group.polylines : unionedOrOriginal(group.polylines),
  );
}

function groupByTextObject(contours: ReadonlyArray<CollectedCncContour>): ContourGroup[] {
  const groups: ContourGroup[] = [];
  const byObject = new Map<string, ContourGroup>();
  for (const contour of contours) {
    const objectId = mergeKey(contour);
    if (objectId === null) {
      groups.push({ objectId: null, polylines: [contour.polyline] });
      continue;
    }
    const existing = byObject.get(objectId);
    if (existing === undefined) {
      const group: ContourGroup = { objectId, polylines: [contour.polyline] };
      byObject.set(objectId, group);
      groups.push(group);
      continue;
    }
    existing.polylines.push(contour.polyline);
  }
  return groups;
}

function mergeKey(contour: CollectedCncContour): string | null {
  if (contour.sourceKind !== 'text') return null;
  if (!contour.polyline.closed) return null;
  return contour.objectId ?? null;
}

// A single contour has nothing to merge with, so it keeps its exact points
// rather than making a round trip through clipper's rounding grid.
function unionedOrOriginal(polylines: ReadonlyArray<Polyline>): ReadonlyArray<Polyline> {
  if (polylines.length < 2) return polylines;
  const merged = normalizeClosedPolylinesNonZeroChecked(polylines);
  if (merged.kind === 'error' || merged.value.length === 0) return polylines;
  return merged.value;
}
