import type { Vec2 } from '../../scene';
import { pointAtArcDistance, radiusAtPosition } from './polyline-window';
import type { MutablePruneChain } from './pruning-worklist';

const MAX_THROUGH_COSINE = Math.cos((150 * Math.PI) / 180);

/** A thin or rounded branch cap can end at radius 1, just like a corner
 * artifact. Compare its exterior body against the supported trunk instead
 * of the cap apex or the locally widened junction. Preserve it only when
 * that exterior body retains the trunk's width and the branch projects at
 * least two source pixels from a supported straight trunk. Measuring from
 * the trunk avoids counting a junction centroid shifted into the branch. */
export function hasShortBranchSupport(
  chain: MutablePruneChain,
  incident: ReadonlyArray<MutablePruneChain>,
  junction: number,
  distSq: Float64Array,
  width: number,
  pixelScale: number,
): boolean {
  if (incident.length !== 3) return false;
  const junctionIndex = chain.a === junction ? 0 : chain.points.length - 1;
  const position = chain.points[junctionIndex];
  const tip = chain.points[chain.points.length - 1 - junctionIndex];
  if (position === undefined || tip === undefined) return false;
  const arms = incident.filter((candidate) => candidate !== chain);
  const junctionRadius = radiusAtPosition(position, distSq, width);
  const probe = Math.max(6 * pixelScale, 4 * junctionRadius);
  const a = trunkPoint(arms[0], junction, probe);
  const b = trunkPoint(arms[1], junction, probe);
  if (a === undefined || b === undefined) return false;
  const ax = a.x - position.x;
  const ay = a.y - position.y;
  const bx = b.x - position.x;
  const by = b.y - position.y;
  const al = Math.hypot(ax, ay);
  const bl = Math.hypot(bx, by);
  if (Math.min(al, bl) < 0.75 * probe) return false;
  if ((ax * bx + ay * by) / (al * bl) > MAX_THROUGH_COSINE) return false;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  const distance = Math.abs((tip.x - a.x) * dy - (tip.y - a.y) * dx) / length;
  if (distance + 1e-8 < 2 * pixelScale) return false;
  const trunkRadius = Math.max(
    radiusAtPosition(a, distSq, width),
    radiusAtPosition(b, distSq, width),
  );
  if (
    trunkRadius <= 0 ||
    !followsTrunkChord(arms, junction, probe, a, b, Math.max(0.5 * pixelScale, 0.25 * trunkRadius))
  )
    return false;
  return chain.points.some((point) => {
    const projection = Math.abs((point.x - a.x) * dy - (point.y - a.y) * dx) / length;
    // Exclude the trunk itself: its widening at a junction is not evidence
    // of a real branch. Allow the axis/diagonal EDT's sqrt(2) quantisation.
    return (
      projection + 1e-8 >= trunkRadius &&
      Math.SQRT2 * radiusAtPosition(point, distSq, width) + 1e-8 >= trunkRadius
    );
  });
}

/** Endpoint tangents alone can make a curved ring look like a straight
 * trunk. Its chord lies inside the curve and exaggerates outward spurs.
 * Check the intervening arms too, beyond the junction's local dent. */
function followsTrunkChord(
  arms: ReadonlyArray<MutablePruneChain>,
  junction: number,
  probe: number,
  a: Vec2,
  b: Vec2,
  tolerance: number,
): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  return arms.every((arm) => {
    const point = trunkPoint(arm, junction, probe / 2);
    return (
      point !== undefined &&
      Math.abs((point.x - a.x) * dy - (point.y - a.y) * dx) / length <= tolerance
    );
  });
}

function trunkPoint(
  chain: MutablePruneChain | undefined,
  junction: number,
  distance: number,
): Vec2 | undefined {
  return chain === undefined
    ? undefined
    : pointAtArcDistance(chain.points, chain.a === junction, distance);
}
