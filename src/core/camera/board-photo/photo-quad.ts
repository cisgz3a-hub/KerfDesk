import type { Vec2 } from '../../scene';
import { solveHomography, type Mat3 } from '../homography';

export type PhotoReference = { readonly widthMm: number; readonly heightMm: number };
export type OrderedQuad = readonly [Vec2, Vec2, Vec2, Vec2];

export function orderQuadCorners(points: ReadonlyArray<Vec2>): OrderedQuad | null {
  if (points.length !== 4 || points.some((point) => !finite(point))) return null;
  const centre = {
    x: points.reduce((sum, point) => sum + point.x, 0) / 4,
    y: points.reduce((sum, point) => sum + point.y, 0) / 4,
  };
  let ordered = [...points].sort(
    (left, right) =>
      Math.atan2(left.y - centre.y, left.x - centre.x) -
      Math.atan2(right.y - centre.y, right.x - centre.x),
  );
  const first = ordered.reduce(
    (best, point, index) =>
      point.x + point.y < (ordered[best]?.x ?? 0) + (ordered[best]?.y ?? 0) ? index : best,
    0,
  );
  ordered = [...ordered.slice(first), ...ordered.slice(0, first)];
  if (signedArea(ordered) < 0) ordered = [ordered[0] as Vec2, ...ordered.slice(1).reverse()];
  if (Math.abs(signedArea(ordered)) < 100 || !convex(ordered)) return null;
  return ordered as unknown as OrderedQuad;
}

export function orientReference(
  quad: OrderedQuad,
  widthMm: number,
  heightMm: number,
): PhotoReference {
  const horizontal = distance(quad[0], quad[1]) + distance(quad[2], quad[3]);
  const vertical = distance(quad[1], quad[2]) + distance(quad[3], quad[0]);
  const quadWide = horizontal >= vertical;
  const referenceWide = widthMm >= heightMm;
  return quadWide === referenceWide
    ? { widthMm, heightMm }
    : { widthMm: heightMm, heightMm: widthMm };
}

export function photoToMm(quad: OrderedQuad, ref: PhotoReference): Mat3 | null {
  const destinations: OrderedQuad = [
    { x: 0, y: 0 },
    { x: ref.widthMm, y: 0 },
    { x: ref.widthMm, y: ref.heightMm },
    { x: 0, y: ref.heightMm },
  ];
  const result = solveHomography(
    quad.map((src, index) => ({ src, dst: destinations[index] as Vec2 })),
  );
  return result.ok ? result.matrix : null;
}

function convex(points: ReadonlyArray<Vec2>): boolean {
  const turns = points.map((point, index) =>
    cross(point, points[(index + 1) % 4] as Vec2, points[(index + 2) % 4] as Vec2),
  );
  return turns.every((turn) => turn > 0) || turns.every((turn) => turn < 0);
}

function signedArea(points: ReadonlyArray<Vec2>): number {
  return (
    points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length] as Vec2;
      return sum + point.x * next.y - next.x * point.y;
    }, 0) / 2
  );
}

function cross(a: Vec2, b: Vec2, c: Vec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function finite(point: Vec2): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
