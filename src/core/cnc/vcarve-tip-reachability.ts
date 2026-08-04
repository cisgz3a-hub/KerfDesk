import { offsetClosedPolylinesWithRoundJoinsChecked } from '../geometry/kerf-offset';
import { insetContoursChecked } from '../geometry/offset-ladder';
import { differenceClosedPolylinesChecked } from '../geometry/polygon-difference';
import type { Polyline, Vec2 } from '../scene';

const COVERAGE_SLACK_MM = 0.002;

export type VCarveTipReachability = {
  readonly residualThin: boolean;
  readonly offsetFailed: boolean;
};

/** Report artwork a flat tip cannot reach, without turning it into a guard. */
export function vcarveTipReachability(
  source: ReadonlyArray<Polyline>,
  tipRadiusMm: number,
): VCarveTipReachability {
  if (!(tipRadiusMm > 0)) return { residualThin: false, offsetFailed: false };
  const centers = insetContoursChecked(source, tipRadiusMm);
  if (centers.offsetFailed) return { residualThin: false, offsetFailed: true };
  if (centers.contours.length === 0) {
    return { residualThin: source.some(hasArea), offsetFailed: false };
  }
  const covered = offsetClosedPolylinesWithRoundJoinsChecked(
    centers.contours,
    tipRadiusMm + COVERAGE_SLACK_MM,
  );
  if (covered.kind === 'error') return { residualThin: false, offsetFailed: true };
  const residual = differenceClosedPolylinesChecked(source, covered.value);
  if (residual.kind === 'error') return { residualThin: false, offsetFailed: true };
  return { residualThin: residual.value.some(hasArea), offsetFailed: false };
}

function hasArea(polyline: Polyline): boolean {
  const origin = polyline.points.find(isFinitePoint);
  if (origin === undefined) return false;
  let direction: Vec2 | null = null;
  for (const point of polyline.points) {
    if (!isFinitePoint(point)) continue;
    const offset = { x: point.x - origin.x, y: point.y - origin.y };
    if (offset.x === 0 && offset.y === 0) continue;
    if (direction === null) {
      direction = offset;
      continue;
    }
    if (direction.x * offset.y - direction.y * offset.x !== 0) return true;
  }
  return false;
}

function isFinitePoint(point: Vec2): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
