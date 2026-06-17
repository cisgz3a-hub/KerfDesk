import { type ResolvedRasterScanCalibration } from '../devices';
import type { Polyline, Vec2 } from '../scene';

export function applyFillScanCalibration(
  polylines: ReadonlyArray<Polyline>,
  calibration: ResolvedRasterScanCalibration,
): ReadonlyArray<Polyline> {
  if (calibration.initialXOffsetMm === 0 && calibration.bidirectionalOffsetMm === 0) {
    return polylines;
  }
  return polylines.map((polyline) => shiftPolyline(polyline, calibration));
}

function shiftPolyline(polyline: Polyline, calibration: ResolvedRasterScanCalibration): Polyline {
  const direction = scanDirection(polyline);
  const offset = {
    x: calibration.initialXOffsetMm + calibration.bidirectionalOffsetMm * direction.x,
    y: calibration.bidirectionalOffsetMm * direction.y,
  };
  return {
    closed: polyline.closed,
    points: polyline.points.map((point) => shiftPoint(point, offset)),
  };
}

function scanDirection(polyline: Polyline): { readonly x: number; readonly y: number } {
  const first = polyline.points[0];
  const last = polyline.points[polyline.points.length - 1];
  if (first === undefined || last === undefined) return { x: 1, y: 0 };
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { x: 1, y: 0 };
  return {
    x: dx / length,
    y: dy / length,
  };
}

function shiftPoint(point: Vec2, offset: Vec2): Vec2 {
  return { x: point.x + offset.x, y: point.y + offset.y };
}
