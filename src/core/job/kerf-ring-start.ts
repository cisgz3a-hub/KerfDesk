// Where a kerf contour starts (E-5). The offset engine hands each ring back
// starting wherever its own bookkeeping put it, so a kerfed part burned from an
// arbitrary corner instead of the start the operator drew or chose with the
// node tool (ADR-494's "Where drawn" start). Each offset ring is turned, in the
// same direction, to begin at its vertex nearest the start of the source
// contour it came from.
//
// An offset can merge, split or drop contours, so a ring is not matched to its
// source by index: it takes the source start nearest to any of its vertices.
// Only sources whose bounds, grown by the furthest a mitred kerf corner reaches,
// touch the ring's bounds are compared, so a path of many contours does not
// compare every ring with every start.

import { projectPointToPolyline } from '../cnc/cnc-tab-anchors';
import type { Polyline, Vec2 } from '../scene';
import { polylineBounds, type SegmentBounds } from './segment-bounds';
import { growBox, boxesOverlap } from '../geometry/box-math';

// The kerf offset mitres its corners with Clipper's miter limit of 2, so no
// point of an offset ring lies further than twice the kerf from its source.
const MITRE_REACH = 2;
// Slack for the offset engine's rounding, far above it and far below any detail.
const REACH_SLACK_MM = 0.01;

type SourceStart = { readonly start: Vec2; readonly reach: SegmentBounds };

/** The rings, each turned to begin at its vertex nearest its source's start. */
export function startKerfRingsAtSources(
  rings: ReadonlyArray<Polyline>,
  sources: ReadonlyArray<Polyline>,
  kerfOffsetMm: number,
): ReadonlyArray<Polyline> {
  const grow = MITRE_REACH * Math.abs(kerfOffsetMm) + REACH_SLACK_MM;
  const starts = sources.flatMap((source): SourceStart[] => {
    const start = source.points[0];
    const bounds = polylineBounds(source.points);
    return start === undefined || bounds === null ? [] : [{ start, reach: growBox(bounds, grow) }];
  });
  return rings.map((ring) => startRingNearSource(ring, starts));
}

/** For each ring, the index of the source contour it was offset from: the
 * nearest to it, by sampled distance, of the sources within its reach; -1 when
 * none is. Laser leads read a kerf contour's scrap side from it (ADR-626 Amd 1). */
export function kerfRingOwners(
  rings: ReadonlyArray<Polyline>,
  sources: ReadonlyArray<Polyline>,
  kerfOffsetMm: number,
): number[] {
  const grow = MITRE_REACH * Math.abs(kerfOffsetMm) + REACH_SLACK_MM;
  const reaches = sources.map((source) => {
    const bounds = polylineBounds(source.points);
    return bounds === null ? null : growBox(bounds, grow);
  });
  return rings.map((ring) => {
    const bounds = polylineBounds(ring.points);
    let owner = -1;
    let best = Number.POSITIVE_INFINITY;
    sources.forEach((source, index) => {
      const reach = reaches[index];
      if (bounds === null || reach === null || reach === undefined || !boxesOverlap(reach, bounds))
        return;
      const distanceSq = sampledDistanceSq(ring, source);
      if (distanceSq < best) {
        owner = index;
        best = distanceSq;
      }
    });
    return owner;
  });
}

const OWNER_SAMPLES = 16;

function sampledDistanceSq(ring: Polyline, source: Polyline): number {
  let distanceSq = Number.POSITIVE_INFINITY;
  const stride = Math.max(1, Math.floor(ring.points.length / OWNER_SAMPLES));
  for (let index = 0; index < ring.points.length; index += stride) {
    const point = ring.points[index] as Vec2;
    const projection = projectPointToPolyline(source, point);
    if (projection !== null) distanceSq = Math.min(distanceSq, projection.distanceSq);
  }
  return distanceSq;
}

function startRingNearSource(ring: Polyline, starts: ReadonlyArray<SourceStart>): Polyline {
  const bounds = polylineBounds(ring.points);
  if (bounds === null) return ring;
  const nearby = starts.filter((source) => boxesOverlap(source.reach, bounds));
  const repeatsStart = closesOnItself(ring.points);
  const cycle = repeatsStart ? ring.points.slice(0, -1) : ring.points;
  const index = nearestVertexIndex(cycle, nearby);
  if (index <= 0) return ring;
  const turned = [...cycle.slice(index), ...cycle.slice(0, index)];
  return { ...ring, points: repeatsStart ? [...turned, ...turned.slice(0, 1)] : turned };
}

// Sources in order, then vertices in order, so an exact tie keeps the earlier.
function nearestVertexIndex(
  cycle: ReadonlyArray<Vec2>,
  starts: ReadonlyArray<SourceStart>,
): number {
  let best = -1;
  let bestDistanceSq = Number.POSITIVE_INFINITY;
  for (const { start } of starts) {
    for (const [index, vertex] of cycle.entries()) {
      const distanceSq = (vertex.x - start.x) ** 2 + (vertex.y - start.y) ** 2;
      if (distanceSq < bestDistanceSq) {
        best = index;
        bestDistanceSq = distanceSq;
      }
    }
  }
  return best;
}

function closesOnItself(points: ReadonlyArray<Vec2>): boolean {
  const first = points[0];
  const last = points.at(-1);
  return points.length > 1 && first?.x === last?.x && first?.y === last?.y;
}
