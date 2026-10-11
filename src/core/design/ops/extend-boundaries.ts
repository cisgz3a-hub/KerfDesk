// Exact forward-ray contacts with the Studio's analytic boundary geometry.
// The direction is a unit vector, so every returned distance is millimetres.
import type { Vec2 } from '../../scene';
import { sanitizeEntity, type SketchEntity } from '../sketch-entity';

export const EXTEND_EPS_MM = 1e-7;
export type RayContact = { readonly distance: number; readonly overlap: boolean };
export type ExtendRay = { readonly from: Vec2; readonly direction: Vec2 };

export function boundaryContacts(ray: ExtendRay, entity: SketchEntity): RayContact[] {
  const clean = sanitizeEntity(entity);
  if (clean === null) return [];
  switch (clean.kind) {
    case 'line':
      return lineContacts(ray, clean.start, clean.end);
    case 'path':
      return clean.points.flatMap((point, index) => {
        const next = clean.points[index + 1] ?? (clean.closed ? clean.points[0] : undefined);
        return next === undefined ? [] : lineContacts(ray, point, next);
      });
    case 'circle':
      return ellipseContacts(ray, clean.center, clean.radiusMm, clean.radiusMm);
    case 'ellipse':
      return ellipseContacts(ray, clean.center, clean.radiusXMm, clean.radiusYMm);
    case 'arc':
      return arcContacts(ray, clean.center, clean.radiusMm, clean.startAngleDeg, clean.sweepDeg);
    case 'rect':
      return rectangleContacts(ray, clean);
  }
}

function lineContacts(ray: ExtendRay, a: Vec2, b: Vec2): RayContact[] {
  const sx = b.x - a.x;
  const sy = b.y - a.y;
  const length = Math.hypot(sx, sy);
  if (length <= EXTEND_EPS_MM) return [];
  const dx = a.x - ray.from.x;
  const dy = a.y - ray.from.y;
  const cross = ray.direction.x * sy - ray.direction.y * sx;
  if (Math.abs(cross) <= 1e-12 * length) {
    if (Math.abs(dx * ray.direction.y - dy * ray.direction.x) > EXTEND_EPS_MM) return [];
    const first = dx * ray.direction.x + dy * ray.direction.y;
    const last = first + sx * ray.direction.x + sy * ray.direction.y;
    if (Math.max(first, last) < -EXTEND_EPS_MM) return [];
    return [{ distance: Math.max(0, Math.min(first, last)), overlap: true }];
  }
  const distance = (dx * sy - dy * sx) / cross;
  const fraction = (dx * ray.direction.y - dy * ray.direction.x) / cross;
  const margin = EXTEND_EPS_MM / length;
  return distance >= -EXTEND_EPS_MM && fraction >= -margin && fraction <= 1 + margin
    ? [{ distance: Math.max(0, distance), overlap: false }]
    : [];
}

function ellipseContacts(ray: ExtendRay, center: Vec2, rx: number, ry: number): RayContact[] {
  const x = (ray.from.x - center.x) / rx;
  const y = (ray.from.y - center.y) / ry;
  const dx = ray.direction.x / rx;
  const dy = ray.direction.y / ry;
  const a = dx * dx + dy * dy;
  const b = 2 * (x * dx + y * dy);
  const c = x * x + y * y - 1;
  const discriminant = b * b - 4 * a * c;
  const roundoff = 32 * Number.EPSILON * (b * b + Math.abs(4 * a * c));
  if (discriminant < -roundoff || a === 0) return [];
  const root = Math.sqrt(Math.max(0, discriminant));
  // The alternate quadratic form avoids cancellation at a nearby contact.
  const q = -0.5 * (b + (b < 0 ? -root : root));
  const distances = q === 0 ? [-b / (2 * a)] : [q / a, c / q];
  return distances
    .filter((distance) => Number.isFinite(distance) && distance >= -EXTEND_EPS_MM)
    .map((distance) => ({ distance: Math.max(0, distance), overlap: false }));
}

function arcContacts(
  ray: ExtendRay,
  center: Vec2,
  radius: number,
  start: number,
  sweep: number,
): RayContact[] {
  return ellipseContacts(ray, center, radius, radius).filter(({ distance }) => {
    const x = ray.from.x + distance * ray.direction.x - center.x;
    const y = ray.from.y + distance * ray.direction.y - center.y;
    const angle = (Math.atan2(y, x) * 180) / Math.PI;
    const progress = modulo(sweep < 0 ? start - angle : angle - start);
    const tolerance = (EXTEND_EPS_MM / radius) * (180 / Math.PI);
    return progress <= Math.abs(sweep) + tolerance || 360 - progress <= tolerance;
  });
}

function modulo(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

function rectangleContacts(
  ray: ExtendRay,
  rect: Extract<SketchEntity, { readonly kind: 'rect' }>,
): RayContact[] {
  const { x, y } = rect.origin;
  const right = x + rect.widthMm;
  const top = y + rect.heightMm;
  const radius = rect.cornerRadiusMm;
  const lines = [
    [
      { x: x + radius, y },
      { x: right - radius, y },
    ],
    [
      { x: right, y: y + radius },
      { x: right, y: top - radius },
    ],
    [
      { x: right - radius, y: top },
      { x: x + radius, y: top },
    ],
    [
      { x, y: top - radius },
      { x, y: y + radius },
    ],
  ] as const;
  const contacts = lines.flatMap(([a, b]) => lineContacts(ray, a, b));
  if (radius === 0) return contacts;
  const corners = [
    { x: right - radius, y: top - radius, angle: 0 },
    { x: x + radius, y: top - radius, angle: 90 },
    { x: x + radius, y: y + radius, angle: 180 },
    { x: right - radius, y: y + radius, angle: 270 },
  ];
  return contacts.concat(
    corners.flatMap((corner) => arcContacts(ray, corner, radius, corner.angle, 90)),
  );
}
