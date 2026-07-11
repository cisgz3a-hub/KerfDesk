// Axis-aligned bounding box of a G2/G3 circular arc, for the emitted-text
// bounds preflight. The endpoint X/Y words alone miss an arc that bows past a
// bed edge while both of its endpoints sit inside the bed.
//
// GRBL/emitter convention (cnc-grbl-strategy): the arc centre is start + (I, J);
// G2 sweeps clockwise and G3 counter-clockwise, viewed from +Z. The arc's AABB
// is the box of its two endpoints, widened by any cardinal extremum
// (centre ± r on the ±X / ±Y axes) that the sweep actually passes through.

export type ArcAabb = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

const TWO_PI = Math.PI * 2;
// A start/end that coincide describe the full circle the emitter writes for a
// closed arc; treat every cardinal as swept.
const FULL_CIRCLE_EPS = 1e-9;
// Numerical slack so a cardinal sitting exactly on an endpoint is treated as
// swept (it is already an endpoint of the box, so including it never hurts).
const ANGLE_EPS = 1e-9;

export function arcAabb(
  start: { readonly x: number; readonly y: number },
  end: { readonly x: number; readonly y: number },
  i: number,
  j: number,
  clockwise: boolean,
): ArcAabb {
  const cx = start.x + i;
  const cy = start.y + j;
  const r = Math.hypot(i, j);

  let minX = Math.min(start.x, end.x);
  let maxX = Math.max(start.x, end.x);
  let minY = Math.min(start.y, end.y);
  let maxY = Math.max(start.y, end.y);

  const fullCircle = Math.hypot(end.x - start.x, end.y - start.y) < FULL_CIRCLE_EPS;
  const startAngle = Math.atan2(start.y - cy, start.x - cx);
  const endAngle = Math.atan2(end.y - cy, end.x - cx);

  const cardinals = [
    { angle: 0, x: cx + r, y: cy }, // +X
    { angle: Math.PI / 2, x: cx, y: cy + r }, // +Y
    { angle: Math.PI, x: cx - r, y: cy }, // -X
    { angle: -Math.PI / 2, x: cx, y: cy - r }, // -Y
  ];

  for (const c of cardinals) {
    if (fullCircle || angleOnArc(c.angle, startAngle, endAngle, clockwise)) {
      minX = Math.min(minX, c.x);
      maxX = Math.max(maxX, c.x);
      minY = Math.min(minY, c.y);
      maxY = Math.max(maxY, c.y);
    }
  }
  return { minX, minY, maxX, maxY };
}

// Is `angle` within the arc swept from startAngle to endAngle in the given
// direction? Everything is measured as CCW travel; a clockwise arc is just the
// CCW arc traversed from end back to start.
function angleOnArc(
  angle: number,
  startAngle: number,
  endAngle: number,
  clockwise: boolean,
): boolean {
  const from = clockwise ? endAngle : startAngle;
  const to = clockwise ? startAngle : endAngle;
  const sweep = norm(to - from);
  return norm(angle - from) <= sweep + ANGLE_EPS;
}

function norm(a: number): number {
  return ((a % TWO_PI) + TWO_PI) % TWO_PI;
}
