// Distance-only XY arc qualification. Shared arc-solve stays policy-free;
// neither this tolerance nor these refusals change executable recovery bytes.
import { arcSweepAngle, ijArcCenter, rArcGeometry, type XyPoint } from '../../gcode/arc-solve';

type ArcWords = {
  readonly i: number | undefined;
  readonly j: number | undefined;
  readonly r: number | undefined;
};

type ArcGeometry = { readonly center: XyPoint; readonly radiusMm: number };

// Native arc words are rounded to 0.001 mm. Allow their small radius mismatch,
// conservatively within 0.005 mm; this is a diagnostic limit, not firmware policy.
const RADIUS_MISMATCH_MM = 0.005;

export function resumeArcLengthMm(
  from: XyPoint,
  to: XyPoint,
  words: ArcWords,
  clockwise: boolean,
  scale: number,
): number | null {
  const geometry = arcGeometry(from, to, words, clockwise, scale);
  if (geometry === null) return null;
  const { center, radiusMm } = geometry;
  const startAngle = Math.atan2(from.y - center.y, from.x - center.x);
  const endAngle = Math.atan2(to.y - center.y, to.x - center.x);
  const samePoint = from.x === to.x && from.y === to.y;
  // Distinct endpoints whose angles collapse cannot establish a full turn.
  if (!samePoint && startAngle === endAngle) return null;
  const sweep = arcSweepAngle(startAngle, endAngle, clockwise, samePoint);
  const length = Math.abs(sweep) * radiusMm;
  return Number.isFinite(length) ? length : null;
}

function arcGeometry(
  from: XyPoint,
  to: XyPoint,
  words: ArcWords,
  clockwise: boolean,
  scale: number,
): ArcGeometry | null {
  const hasOffsets = words.i !== undefined || words.j !== undefined;
  if (words.r !== undefined) {
    // Mixed center/radius blocks are ambiguous even when both forms agree.
    return hasOffsets ? null : radiusGeometry(from, to, words.r, clockwise, scale);
  }
  if (!hasOffsets) return null;
  const center = ijArcCenter(from, words.i, words.j, scale);
  const radiusMm = Math.hypot((words.i ?? 0) * scale, (words.j ?? 0) * scale);
  if (!finiteGeometry(center, radiusMm)) return null;
  if (!offsetRadiiMatch(from, to, center, radiusMm)) return null;
  return { center, radiusMm };
}

function offsetRadiiMatch(from: XyPoint, to: XyPoint, center: XyPoint, radiusMm: number): boolean {
  const startRadius = Math.hypot(from.x - center.x, from.y - center.y);
  const endRadius = Math.hypot(to.x - center.x, to.y - center.y);
  return (
    startRadius > 0 &&
    endRadius > 0 &&
    Number.isFinite(startRadius) &&
    Number.isFinite(endRadius) &&
    Math.abs(startRadius - radiusMm) <= RADIUS_MISMATCH_MM &&
    Math.abs(endRadius - radiusMm) <= RADIUS_MISMATCH_MM
  );
}

function radiusGeometry(
  from: XyPoint,
  to: XyPoint,
  r: number,
  clockwise: boolean,
  scale: number,
): ArcGeometry | null {
  const radiusMm = Math.abs(r) * scale;
  const chordMm = Math.hypot(to.x - from.x, to.y - from.y);
  // Reject an infeasible radius BEFORE shared math clamps its negative height.
  if (!Number.isFinite(chordMm) || radiusMm < chordMm / 2) return null;
  const geometry = rArcGeometry(from, to, r, clockwise, scale);
  if (geometry === null || !Number.isFinite(geometry.halfChordGapSq)) return null;
  return finiteGeometry(geometry.center, radiusMm) ? geometry : null;
}

function finiteGeometry(center: XyPoint, radiusMm: number): boolean {
  return (
    radiusMm > 0 &&
    Number.isFinite(radiusMm) &&
    Number.isFinite(center.x) &&
    Number.isFinite(center.y)
  );
}
