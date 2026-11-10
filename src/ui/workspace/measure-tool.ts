import type { Vec2 } from '../../core/scene';
import { formatDisplayLengthFixed, type DisplayLengthUnit } from '../display-length';
import { normalizeDegrees } from '../../core/math/wrap';

export type MeasureDraft = {
  readonly start: Vec2;
  readonly end: Vec2;
};

export type MeasureReadout = {
  readonly dxMm: number;
  readonly dyMm: number;
  readonly distanceMm: number;
  readonly angleDeg: number;
  readonly label: string;
};

const SNAP_RADIANS = Math.PI / 4;

export function constrainMeasureEnd(start: Vec2, end: Vec2, constrained: boolean): Vec2 {
  if (!constrained) return end;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return end;
  const snapped = Math.round(Math.atan2(dy, dx) / SNAP_RADIANS) * SNAP_RADIANS;
  return {
    x: start.x + Math.cos(snapped) * distance,
    y: start.y + Math.sin(snapped) * distance,
  };
}

/** The label follows the display unit (ADR-629); the numbers stay in mm. */
export function measureReadout(
  draft: MeasureDraft,
  unit: DisplayLengthUnit = 'mm',
): MeasureReadout {
  const dxMm = draft.end.x - draft.start.x;
  const dyMm = draft.end.y - draft.start.y;
  const distanceMm = Math.hypot(dxMm, dyMm);
  const angleDeg = normalizeDegrees((Math.atan2(dyMm, dxMm) * 180) / Math.PI);
  return {
    dxMm,
    dyMm,
    distanceMm,
    angleDeg,
    label: `${formatMm(distanceMm, unit)} ${unit} | dx ${formatMm(dxMm, unit)} | dy ${formatMm(
      dyMm,
      unit,
    )} | ${angleDeg.toFixed(1)} deg`,
  };
}

// Two decimals of a millimetre, four of an inch; never a negative zero.
function formatMm(value: number, unit: DisplayLengthUnit): string {
  return formatDisplayLengthFixed(value, unit, 2);
}
