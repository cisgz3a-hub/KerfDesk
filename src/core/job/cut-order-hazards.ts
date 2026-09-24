// Cut-order hazards in a compiled job: a closed Line cut that runs before other
// work lying inside it. Once the cut frees the part, the part can drop or shift,
// so whatever runs inside it afterwards may land in the wrong place. The job's
// group order is the machine's order, so this reads the exact sequence Start
// streams, after artwork priority, operation order and layer-priority settings.
//
// Only untabbed cuts count: tabs split a contour into open pieces, and a part
// held by tabs cannot drop. Work on the SAME operation is left to the
// optimizer's inside-first rule, which orders contours within one group.

import { pointInPolygon } from '../geometry';
import { REGISTRATION_LAYER_ID, type Vec2 } from '../scene';
import { containerCandidateQuery } from './containment-depth';
import type { Group, Job } from './job';
import { boundsCenter, boundsContains, polylineBounds, type SegmentBounds } from './segment-bounds';

export type CutOrderHazard = {
  /** Operation whose closed cut runs first. */
  readonly cutLayerId: string;
  /** Later operation with work inside that cut. */
  readonly enclosedLayerId: string;
};

type Container = {
  readonly groupIndex: number;
  readonly layerId: string;
  readonly polygon: ReadonlyArray<Vec2>;
  readonly bounds: SegmentBounds;
};

// A target whose bounds match the cut's own bounds is the same outline on
// another operation (a score over a cut, say), not work inside the part.
const SAME_OUTLINE_TOLERANCE_MM = 1e-6;

/** True when `target` lies inside the closed `polygon`: its bounds sit within
 * the polygon's bounds and its bounds centre is inside the polygon, the same
 * test the optimizer's inside-first ordering uses. */
export function polygonSurrounds(
  polygon: ReadonlyArray<Vec2>,
  polygonBounds: SegmentBounds,
  target: SegmentBounds,
): boolean {
  if (!boundsContains(polygonBounds, target) || sameBounds(polygonBounds, target)) return false;
  const probe = boundsCenter(target);
  return probe !== null && pointInPolygon(probe, polygon);
}

export function detectCutOrderHazards(job: Job): ReadonlyArray<CutOrderHazard> {
  const containers = closedCutContainers(job.groups);
  if (containers.length === 0) return [];
  const candidates = containerCandidateQuery(containers.map((container) => container.bounds));
  const hazards = new Map<string, CutOrderHazard>();
  job.groups.forEach((group, groupIndex) => {
    if (group.layerId === REGISTRATION_LAYER_ID) return;
    for (const target of targetBounds(group)) {
      const probe = boundsCenter(target);
      if (probe === null) continue;
      for (const index of candidates(probe)) {
        const container = containers[index];
        if (container === undefined || container.groupIndex >= groupIndex) continue;
        if (container.layerId === group.layerId) continue;
        const key = `${container.layerId}\u0000${group.layerId}`;
        if (hazards.has(key)) continue;
        if (!polygonSurrounds(container.polygon, container.bounds, target)) continue;
        hazards.set(key, { cutLayerId: container.layerId, enclosedLayerId: group.layerId });
      }
    }
  });
  return [...hazards.values()];
}

function closedCutContainers(groups: ReadonlyArray<Group>): ReadonlyArray<Container> {
  const containers: Container[] = [];
  groups.forEach((group, groupIndex) => {
    if (group.kind !== 'cut' || group.layerId === REGISTRATION_LAYER_ID) return;
    for (const segment of group.segments) {
      if (!segment.closed) continue;
      const bounds = polylineBounds(segment.polyline);
      if (bounds === null) continue;
      containers.push({ groupIndex, layerId: group.layerId, polygon: segment.polyline, bounds });
    }
  });
  return containers;
}

function* targetBounds(group: Group): Generator<SegmentBounds> {
  if (group.kind === 'raster') {
    yield group.bounds;
    return;
  }
  if (group.kind === 'cnc') return;
  for (const segment of group.segments) {
    const bounds = polylineBounds(segment.polyline);
    if (bounds !== null) yield bounds;
  }
}

function sameBounds(left: SegmentBounds, right: SegmentBounds): boolean {
  return (
    Math.abs(left.minX - right.minX) <= SAME_OUTLINE_TOLERANCE_MM &&
    Math.abs(left.minY - right.minY) <= SAME_OUTLINE_TOLERANCE_MM &&
    Math.abs(left.maxX - right.maxX) <= SAME_OUTLINE_TOLERANCE_MM &&
    Math.abs(left.maxY - right.maxY) <= SAME_OUTLINE_TOLERANCE_MM
  );
}
