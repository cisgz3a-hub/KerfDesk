// Apollonius' problem for the Tangent Circle Generator (LightBurn Tools): the
// circles tangent to three given circles. For each choice of signs s_i (+1:
// touching circle i from outside, -1: enclosing it) the centre (x, y) and
// radius r satisfy (x - x_i)^2 + (y - y_i)^2 = (r + s_i r_i)^2. Subtracting
// pairs gives two equations linear in x, y and r, so x and y are linear in r,
// and the first equation becomes a quadratic in r. Every positive root is a
// solution; duplicates across sign choices are merged.

import type { Vec2 } from '../scene';

export type Circle = { readonly center: Vec2; readonly radius: number };

export type TangentCircle = Circle & {
  /** Per input circle: 'outside' touches it externally, 'inside' encloses it. */
  readonly contact: readonly ['outside' | 'inside', 'outside' | 'inside', 'outside' | 'inside'];
};

const EPS = 1e-9;
const SIGNS = [-1, 1] as const;

export function tangentCircles(a: Circle, b: Circle, c: Circle): ReadonlyArray<TangentCircle> {
  const found: TangentCircle[] = [];
  for (const s1 of SIGNS) {
    for (const s2 of SIGNS) {
      for (const s3 of SIGNS) {
        for (const circle of solve([a, b, c], [s1, s2, s3])) {
          if (!found.some((other) => sameCircle(other, circle))) found.push(circle);
        }
      }
    }
  }
  return found.sort((p, q) => p.radius - q.radius);
}

function solve(
  circles: readonly [Circle, Circle, Circle],
  signs: readonly [number, number, number],
): ReadonlyArray<TangentCircle> {
  const [c1, c2, c3] = circles;
  const [s1, s2, s3] = signs;
  // Row i: 2(x_i - x_1) x + 2(y_i - y_1) y + 2(s_i r_i - s_1 r_1) r = k_i
  const row = (ci: Circle, si: number) => ({
    a: 2 * (ci.center.x - c1.center.x),
    b: 2 * (ci.center.y - c1.center.y),
    c: 2 * (si * ci.radius - s1 * c1.radius),
    k:
      ci.center.x ** 2 -
      c1.center.x ** 2 +
      ci.center.y ** 2 -
      c1.center.y ** 2 -
      ci.radius ** 2 +
      c1.radius ** 2,
  });
  const r2 = row(c2, s2);
  const r3 = row(c3, s3);
  const det = r2.a * r3.b - r2.b * r3.a;
  if (Math.abs(det) < EPS) return [];
  // x = x0 + xr * r, y = y0 + yr * r
  const x0 = (r2.k * r3.b - r2.b * r3.k) / det;
  const xr = (-r2.c * r3.b + r2.b * r3.c) / det;
  const y0 = (r2.a * r3.k - r2.k * r3.a) / det;
  const yr = (-r2.a * r3.c + r2.c * r3.a) / det;
  const dx = x0 - c1.center.x;
  const dy = y0 - c1.center.y;
  const qa = xr ** 2 + yr ** 2 - 1;
  const qb = 2 * (dx * xr + dy * yr - s1 * c1.radius);
  const qc = dx ** 2 + dy ** 2 - c1.radius ** 2;
  return quadraticRoots(qa, qb, qc)
    .filter((r) => r > EPS)
    .map((r) => ({
      center: { x: x0 + xr * r, y: y0 + yr * r },
      radius: r,
      contact: signs.map((s) =>
        s > 0 ? 'outside' : 'inside',
      ) as unknown as TangentCircle['contact'],
    }));
}

function quadraticRoots(a: number, b: number, c: number): ReadonlyArray<number> {
  if (Math.abs(a) < EPS) return Math.abs(b) < EPS ? [] : [-c / b];
  const disc = b * b - 4 * a * c;
  if (disc < -EPS) return [];
  const root = Math.sqrt(Math.max(0, disc));
  return [(-b - root) / (2 * a), (-b + root) / (2 * a)];
}

function sameCircle(p: Circle, q: Circle): boolean {
  const tol = 1e-6 * Math.max(1, p.radius, q.radius);
  return (
    Math.abs(p.radius - q.radius) < tol &&
    Math.abs(p.center.x - q.center.x) < tol &&
    Math.abs(p.center.y - q.center.y) < tol
  );
}
