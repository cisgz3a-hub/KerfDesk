import type { Vec2 } from '../../core/scene';

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

export function measureReadout(draft: MeasureDraft): MeasureReadout {
  const dxMm = draft.end.x - draft.start.x;
  const dyMm = draft.end.y - draft.start.y;
  const distanceMm = Math.hypot(dxMm, dyMm);
  const angleDeg = normalizeAngleDeg((Math.atan2(dyMm, dxMm) * 180) / Math.PI);
  return {
    dxMm,
    dyMm,
    distanceMm,
    angleDeg,
    label: `${formatMm(distanceMm)} mm | dx ${formatMm(dxMm)} | dy ${formatMm(
      dyMm,
    )} | ${angleDeg.toFixed(1)} deg`,
  };
}

function normalizeAngleDeg(angle: number): number {
  const normalized = angle % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function formatMm(value: number): string {
  return Object.is(value, -0) ? '0.00' : value.toFixed(2);
}
