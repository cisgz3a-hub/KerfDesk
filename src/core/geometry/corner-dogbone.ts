// corner-dogbone — the corner relief a round bit can actually cut (ADR-106
// Amd 1, ADR-103 Amd 1). A bit of radius r whose edge touches a corner has
// its centre one radius from the corner along the bisector of the open
// (cut-away) wedge. Without relief the compensated toolpath stops where the
// bit meets both walls, r / sin(θ/2) out along that bisector. The relief is
// the area the bit sweeps between those two centres, grown by a small margin:
// a capsule from the tip centre to the mouth centre. Its eroded interior is a
// lane the offset toolpath can follow from the main contour into the corner
// and back, so the relief joins the main loop instead of being skipped (a
// circle centred ON the corner is reachable only at one isolated point) or
// left as a separate island loop that holding tabs can bridge whole.

import type { PathD } from 'clipper2-ts';
import type { Vec2 } from '../scene';

/**
 * Extra relief radius beyond the bit. The lane the bit follows into the relief
 * is twice this wide, so it must sit well above the Boolean rounding and the
 * 5 µm segment floor; the bit edge then passes the corner by this much.
 */
export const DOGBONE_REACH_MARGIN_MM = 0.05;
/** Relief Booleans run at the offset precision (1e-3 mm), not clipper's 1e-2. */
export const DOGBONE_PRECISION_DECIMALS = 3;

const ARC_SEGMENTS_PER_HALF = 12;
const MIN_BISECTOR_LENGTH = 1e-12;
const MIN_HALF_ANGLE_SINE = 1e-6;

export type DogboneCorner = {
  readonly at: Vec2;
  /** Unit bisector pointing into the open wedge (the side the bit cuts). */
  readonly open: Vec2;
  /** Angle of the open wedge between the corner's two edges, in radians. */
  readonly openAngleRad: number;
};

/**
 * The open wedge at `at` between the rays to `prev` and `next` (the smaller of
 * the two angles), or null when an edge has no length or the edges are
 * collinear.
 */
export function dogboneCorner(prev: Vec2, at: Vec2, next: Vec2): DogboneCorner | null {
  const ax = prev.x - at.x;
  const ay = prev.y - at.y;
  const bx = next.x - at.x;
  const by = next.y - at.y;
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la === 0 || lb === 0) return null;
  const sumX = ax / la + bx / lb;
  const sumY = ay / la + by / lb;
  const sumLength = Math.hypot(sumX, sumY);
  if (sumLength < MIN_BISECTOR_LENGTH) return null;
  const cos = Math.min(1, Math.max(-1, (ax * bx + ay * by) / (la * lb)));
  return {
    at: { x: at.x, y: at.y },
    open: { x: sumX / sumLength, y: sumY / sumLength },
    openAngleRad: Math.acos(cos),
  };
}

/**
 * The relief capsule for one corner: radius bit radius + margin, from the
 * centre that touches the corner out to the centre that touches both walls,
 * drawn as a CCW polygon that circumscribes it (every edge at least the full
 * radius from its axis).
 */
export function dogboneReliefPath(corner: DogboneCorner, bitRadiusMm: number): PathD {
  const halfAngleSine = Math.max(Math.sin(corner.openAngleRad / 2), MIN_HALF_ANGLE_SINE);
  const tip = alongBisector(corner, bitRadiusMm);
  const mouth = alongBisector(corner, Math.max(bitRadiusMm, bitRadiusMm / halfAngleSine));
  const vertexRadiusMm =
    (bitRadiusMm + DOGBONE_REACH_MARGIN_MM) / Math.cos(Math.PI / (2 * ARC_SEGMENTS_PER_HALF));
  const heading = Math.atan2(corner.open.y, corner.open.x);
  // The half facing the corner around the tip, then the far half around the mouth.
  return [
    ...halfArc(tip, vertexRadiusMm, heading + Math.PI / 2),
    ...halfArc(mouth, vertexRadiusMm, heading - Math.PI / 2),
  ];
}

function alongBisector(corner: DogboneCorner, distanceMm: number): Vec2 {
  return {
    x: corner.at.x + distanceMm * corner.open.x,
    y: corner.at.y + distanceMm * corner.open.y,
  };
}

function halfArc(center: Vec2, radiusMm: number, startAngle: number): PathD {
  const points: PathD = [];
  for (let i = 0; i <= ARC_SEGMENTS_PER_HALF; i += 1) {
    const angle = startAngle + (i / ARC_SEGMENTS_PER_HALF) * Math.PI;
    points.push({
      x: center.x + radiusMm * Math.cos(angle),
      y: center.y + radiusMm * Math.sin(angle),
    });
  }
  return points;
}
