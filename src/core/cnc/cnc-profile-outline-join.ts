// Outlines drawn as open paths on an Outside or Inside profile (ADR-672;
// meta audit v1 M6-P1-2).
//
// Only a closed shape has an outside and an inside, so the profile offset
// skips an open path and cuts it on its line. A part outlined by a path that
// stops a hair short of its start, or by CAD LINEs whose corners miss by
// microns, then comes out one cut width small (a hole one cut width large).
// Join paths closes such outlines at the gap ADR-626 Amendment 8 reads as an
// outline, and so does this: the open paths of one artwork on an Outside or
// Inside profile whose ends each meet exactly one other end within
// OPEN_OUTLINE_GAP_MM, closing a loop, are cut as one closed shape. The
// closing step bridges that gap, which every bit already sweeps across.
//
// Chains that do not close are left as drawn: joining them would only bridge
// gaps along a path that is still cut on its line. What stays open is counted
// for Job Review, which says the part or hole comes out one cut width off.

import { joinCurveEndpointsWithin, type JoinableCurve } from '../geometry/path-endpoint-join';
import type { CncProfileOpenPaths } from '../job/cnc-compilation-sidecar-types';
import { OPEN_OUTLINE_GAP_MM } from '../job/laser-lead-open-outlines';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  polylineToCurveSubpath,
  type CncCutType,
  type Layer,
  type Vec2,
} from '../scene';
import type { CollectedCncContour } from './cnc-manual-tab-mapping';

/** Open paths whose ends come this close are closed into one outline. */
export const PROFILE_OUTLINE_GAP_MM = OPEN_OUTLINE_GAP_MM;

const SAME_POINT_MM = 1e-9;
const MIN_RING_POINTS = 3;

/** True for the profile cuts that offset a closed shape to one side. */
export function profileCutOffsetsToASide(
  cutType: CncCutType,
): cutType is 'profile-outside' | 'profile-inside' {
  return cutType === 'profile-outside' || cutType === 'profile-inside';
}

/**
 * The layer's contours with every near-closed outline of one artwork joined
 * into one closed contour, marked `joinedOutline`. Other cut types, closed
 * contours and open paths that close nothing are returned unchanged and in
 * order; a joined outline takes the place of its first piece.
 */
export function joinProfileOutlines(
  contours: ReadonlyArray<CollectedCncContour>,
  cutType: CncCutType,
): ReadonlyArray<CollectedCncContour> {
  if (!profileCutOffsetsToASide(cutType)) return contours;
  const openIndices = contours.flatMap((contour, index) =>
    !contour.polyline.closed && contour.polyline.points.length >= 2 ? [index] : [],
  );
  if (openIndices.length === 0) return contours;
  // Only paths of one artwork join, so a joined contour keeps one owner for the
  // fresh-trace check and the omitted-artwork selection.
  const sources = openIndices.map(
    (index): JoinableCurve => ({
      curve: polylineToCurveSubpath((contours[index] as CollectedCncContour).polyline),
      signature: contours[index]?.objectId ?? '',
    }),
  );
  const joined = joinCurveEndpointsWithin(sources, PROFILE_OUTLINE_GAP_MM);
  const replaced = new Map<number, CollectedCncContour | null>();
  for (const [leader, curve] of joined.replacements) {
    if (curve === null || !curve.closed) continue;
    const points = ringPoints([curve.start, ...curve.segments.map((segment) => segment.to)]);
    const pieces = (joined.members.get(leader) ?? [leader]).map(
      (member) => openIndices[member] as number,
    );
    const first = contours[pieces[0] as number];
    if (first === undefined || points.length < MIN_RING_POINTS) continue;
    const tabPoints = pieces.flatMap((piece) => contours[piece]?.manualTabPoints ?? []);
    const { manualTabPoints: _firstTabs, ...owner } = first;
    replaced.set(pieces[0] as number, {
      ...owner,
      polyline: { points, closed: true },
      joinedOutline: true,
      ...(tabPoints.length === 0 ? {} : { manualTabPoints: tabPoints }),
    });
    for (const piece of pieces.slice(1)) replaced.set(piece, null);
  }
  if (replaced.size === 0) return contours;
  return contours.flatMap((contour, index) => {
    const replacement = replaced.get(index);
    if (replacement === undefined) return [contour];
    return replacement === null ? [] : [replacement];
  });
}

/** What Job Review says about one operation's open outlines, counted from the
 * contours compile cut; empty when nothing was joined or left open. */
export function cncProfileOpenPaths(
  layer: Layer,
  contours: ReadonlyArray<CollectedCncContour>,
  cutWidthMm: number,
): ReadonlyArray<CncProfileOpenPaths> {
  const cutType = (layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS).cutType;
  if (!profileCutOffsetsToASide(cutType)) return [];
  let onLine = 0;
  let joined = 0;
  for (const contour of contours) {
    if (contour.joinedOutline === true) joined += 1;
    else if (!contour.polyline.closed && contour.polyline.points.length >= 2) onLine += 1;
  }
  if (onLine === 0 && joined === 0) return [];
  return [{ layerId: layer.id, layerName: layer.name, cutType, onLine, joined, cutWidthMm }];
}

/** A closed ring's points: the closing step back to the start is implied. */
function ringPoints(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined || points.length < 2) return points;
  const repeatsStart =
    Math.abs(first.x - last.x) <= SAME_POINT_MM && Math.abs(first.y - last.y) <= SAME_POINT_MM;
  return repeatsStart ? points.slice(0, -1) : points;
}
