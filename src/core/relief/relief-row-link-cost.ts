import { representedCncCoordinateMm } from '../cnc/cnc-output-precision';
import { withoutReliefRowLink } from '../cnc/relief-row-link';
import { effectiveGcodeFeedMmPerMin } from '../gcode/feed-word';
import type { Vec3 } from '../geometry/vec3';
import type { CncPass, CncPath3dPass } from '../job';
import type { Vec2 } from '../scene';

export type ReliefRowLinkCuttingValues = {
  readonly feedMmPerMin: number;
  readonly plungeMmPerMin: number;
  readonly safeZMm: number;
};

/** Retain only proved links whose added travel costs less than the removed plunge alone. */
export function economicalReliefRowLinks(
  passes: ReadonlyArray<CncPass>,
  values: ReliefRowLinkCuttingValues | undefined,
  outputXyForPoint: (point: Vec3) => Vec2 = (point) => point,
): ReadonlyArray<CncPass> {
  return passes.map((pass) =>
    pass.kind !== 'path3d' || isEconomical(pass, values, outputXyForPoint)
      ? pass
      : withoutReliefRowLink(pass),
  );
}

function isEconomical(
  pass: CncPath3dPass,
  values: ReliefRowLinkCuttingValues | undefined,
  outputXyForPoint: (point: Vec3) => Vec2,
): boolean {
  const prefix = pass.reliefRowLinkPrefixPoints;
  if (prefix === undefined) return true;
  const first = pass.points[0];
  if (values === undefined || first === undefined) return false;
  const { feedMmPerMin, plungeMmPerMin, safeZMm } = values;
  if (![feedMmPerMin, plungeMmPerMin, safeZMm].every(Number.isFinite)) return false;
  if (feedMmPerMin <= 0 || plungeMmPerMin <= 0) return false;
  const feed = effectiveGcodeFeedMmPerMin(feedMmPerMin);
  const plunge = effectiveGcodeFeedMmPerMin(plungeMmPerMin);
  const plungeDistance = representedCncCoordinateMm(safeZMm) - representedCncCoordinateMm(first.z);
  const extraDistance = representedPrefixDistance(pass, prefix, outputXyForPoint);
  // Ignore all removed rapid savings. This is a feed-distance filter, not an
  // acceleration/transport/physical-time guarantee. Unknown values keep entries.
  return (
    Number.isFinite(extraDistance) &&
    Number.isFinite(plungeDistance) &&
    extraDistance / feed < plungeDistance / plunge
  );
}

function representedPrefixDistance(
  pass: CncPath3dPass,
  prefix: number,
  outputXyForPoint: (point: Vec3) => Vec2,
): number {
  let distance = 0;
  let previous: Vec2 | undefined;
  for (const point of pass.points.slice(0, prefix + 1)) {
    const output = outputXyForPoint(point);
    const current = {
      x: representedCncCoordinateMm(output.x),
      y: representedCncCoordinateMm(output.y),
    };
    if (previous !== undefined)
      distance += Math.hypot(current.x - previous.x, current.y - previous.y);
    previous = current;
  }
  return distance;
}
