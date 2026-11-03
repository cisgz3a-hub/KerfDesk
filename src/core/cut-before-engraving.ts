// A cut that frees a part before the engraving inside it has run (UX audit
// U3-P2-4, ADR-480 Amendment 2). Read from the compiled job, so it follows the
// exact order the G-code burns: artwork priority, then each operation's
// settings with per-artwork overrides applied. Advisory only: Sort cuts last
// is the fix, and the job itself is never changed here.
import { pointInPolygon } from './geometry/point-in-polygon';
import { computeJobBounds, type CutGroup, type Job } from './job';
import type { Vec2 } from './scene';
import { lineOperationStrength } from './sort-cuts-last';

export type CutBeforeEngraving = {
  /** The Line operation that cuts the outline. */
  readonly cutLayerId: string;
  /** Operations that burn inside that outline after it is cut. */
  readonly engravingLayerIds: ReadonlyArray<string>;
};

type CutOutline = {
  readonly layerId: string;
  readonly strength: number;
  readonly outlines: ReadonlyArray<OutlineRing>;
};

type OutlineRing = {
  readonly polyline: ReadonlyArray<Vec2>;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

/**
 * Each Line operation whose closed outline runs before weaker output inside it:
 * Fill, Image, or a lighter Line such as a score. Only a closed contour frees a
 * part; one cut in pieces (tabs, perforation) stays held, so it is not counted.
 * "Weaker" is Sort cuts last's power × passes ÷ speed, so a light score frame
 * around an engraving is not called a cut.
 */
export function cutsBeforeEngraving(job: Job): ReadonlyArray<CutBeforeEngraving> {
  const found = new Map<string, Set<string>>();
  const earlierCuts: CutOutline[] = [];
  for (const group of job.groups) {
    if (group.kind === 'cnc' || ('focusTest' in group && group.focusTest !== undefined)) continue;
    const strength = lineOperationStrength(group);
    const bounds = computeJobBounds({ groups: [group] });
    if (bounds !== null) {
      for (const cut of earlierCuts) {
        if (cut.layerId === group.layerId || strength >= cut.strength) continue;
        if (!cut.outlines.some((ring) => ringHoldsBounds(ring, bounds))) continue;
        const inside = found.get(cut.layerId) ?? new Set<string>();
        inside.add(group.layerId);
        found.set(cut.layerId, inside);
      }
    }
    if (group.kind === 'cut') {
      const outlines = closedOutlines(group);
      if (outlines.length > 0) earlierCuts.push({ layerId: group.layerId, strength, outlines });
    }
  }
  return [...found].map(([cutLayerId, inside]) => ({
    cutLayerId,
    engravingLayerIds: [...inside],
  }));
}

function closedOutlines(group: CutGroup): ReadonlyArray<OutlineRing> {
  return group.segments
    .filter((segment) => segment.closed && segment.polyline.length >= 3)
    .map((segment) => ring(segment.polyline));
}

function ring(polyline: ReadonlyArray<Vec2>): OutlineRing {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of polyline) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { polyline, minX, minY, maxX, maxY };
}

// Inside means the burn's box sits within the outline's box and its centre is
// inside the outline itself, which holds for a name in a round coaster whose
// box corners poke past the curve.
function ringHoldsBounds(
  outline: OutlineRing,
  bounds: NonNullable<ReturnType<typeof computeJobBounds>>,
): boolean {
  if (
    bounds.minX < outline.minX ||
    bounds.minY < outline.minY ||
    bounds.maxX > outline.maxX ||
    bounds.maxY > outline.maxY
  ) {
    return false;
  }
  const centre = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  return pointInPolygon(centre, outline.polyline);
}

