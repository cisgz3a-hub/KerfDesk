// Apollonius' problem for the Tangent Circle Generator (LightBurn Tools): the
// circles tangent to three given circles. For each choice of signs s_i (+1:
// touching circle i externally, -1: internal tangency) the centre (x, y) and
// radius r satisfy (x - x_i)^2 + (y - y_i)^2 = (r + s_i r_i)^2. Subtracting
// pairs gives two equations linear in x, y and r. Choose a well-conditioned
// pair of pivot coordinates and solve a quadratic in the remaining coordinate.
// This also handles collinear centres when radius is a pivot. Every positive radius is a
// solution; duplicates across sign choices are merged.

import type { Vec2 } from '../scene';

export type Circle = { readonly center: Vec2; readonly radius: number };

export type TangentCircle = Circle & {
  /** Per input circle: external ('outside') or internal ('inside') tangency. */
  readonly contact: readonly ['outside' | 'inside', 'outside' | 'inside', 'outside' | 'inside'];
};

const EPS = 1e-9;
const SIGNS = [-1, 1] as const;

export function tangentCircles(a: Circle, b: Circle, c: Circle): ReadonlyArray<TangentCircle> {
  const inputs = [a, b, c] as const;
  if (
    inputs.some(
      (circle) =>
        !Number.isFinite(circle.center.x) ||
        !Number.isFinite(circle.center.y) ||
        !Number.isFinite(circle.radius) ||
        circle.radius <= 0,
    )
  )
    return [];
  const scale = Math.max(
    ...inputs.flatMap((circle) => [
      Math.abs(circle.center.x - a.center.x),
      Math.abs(circle.center.y - a.center.y),
      circle.radius,
    ]),
  );
  if (!Number.isFinite(scale)) return [];
  // Local coordinates avoid cancellation of squared global positions; scaling
  // makes determinant and root tolerances independent of artwork units.
  const normalized = inputs.map((circle) => ({
    center: {
      x: (circle.center.x - a.center.x) / scale,
      y: (circle.center.y - a.center.y) / scale,
    },
    radius: circle.radius / scale,
  })) as [Circle, Circle, Circle];
  const found: TangentCircle[] = [];
  for (const s1 of SIGNS) {
    for (const s2 of SIGNS) {
      for (const s3 of SIGNS) {
        for (const circle of solve(normalized, [s1, s2, s3])) {
          if (!found.some((other) => sameCircle(other, circle))) found.push(circle);
        }
      }
    }
  }
  return found
    .sort((p, q) => p.radius - q.radius)
    .map((circle) => ({
      ...circle,
      center: { x: a.center.x + circle.center.x * scale, y: a.center.y + circle.center.y * scale },
      radius: circle.radius * scale,
    }))
    .filter(
      (circle) =>
        Number.isFinite(circle.radius) &&
        Number.isFinite(circle.center.x) &&
        Number.isFinite(circle.center.y),
    );
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
  const u = [r2.a, r2.b, r2.c] as const;
  const v = [r3.a, r3.b, r3.c] as const;
  const pivots = ([0, 1, 2] as const)
    .map((free) => {
      const i = ((free + 1) % 3) as 0 | 1 | 2;
      const j = ((free + 2) % 3) as 0 | 1 | 2;
      return { free, i, j, det: u[i] * v[j] - u[j] * v[i] };
    })
    .sort((p, q) => Math.abs(q.det) - Math.abs(p.det));
  const pivot = pivots[0];
  if (pivot === undefined || Math.abs(pivot.det) < EPS) return [];
  const { free, i, j, det } = pivot;
  const base: [number, number, number] = [0, 0, 0];
  const direction: [number, number, number] = [0, 0, 0];
  base[i] = (r2.k * v[j] - u[j] * r3.k) / det;
  base[j] = (u[i] * r3.k - r2.k * v[i]) / det;
  direction[free] = 1;
  direction[i] = (-u[free] * v[j] + u[j] * v[free]) / det;
  direction[j] = (-u[i] * v[free] + u[free] * v[i]) / det;
  const [x, y, radius] = base;
  const [dx, dy, dr] = direction;
  const qa = dx ** 2 + dy ** 2 - dr ** 2;
  const qb = 2 * (x * dx + y * dy - (radius + s1 * c1.radius) * dr);
  const qc = x ** 2 + y ** 2 - (radius + s1 * c1.radius) ** 2;
  return quadraticRoots(qa, qb, qc)
    .map((t) => ({
      center: { x: x + dx * t, y: y + dy * t },
      radius: radius + dr * t,
      contact: signs.map((s) =>
        s > 0 ? 'outside' : 'inside',
      ) as unknown as TangentCircle['contact'],
    }))
    .filter(
      (circle) =>
        circle.radius > EPS &&
        circles.every((input, index) => {
          const distance = Math.hypot(
            circle.center.x - input.center.x,
            circle.center.y - input.center.y,
          );
          const expected = Math.abs(circle.radius + (signs[index] ?? 1) * input.radius);
          return Math.abs(distance - expected) <= 1e-7 * Math.max(1, circle.radius);
        }),
    );
}

function quadraticRoots(a: number, b: number, c: number): ReadonlyArray<number> {
  if (Math.abs(a) < EPS) return Math.abs(b) < EPS ? [] : [-c / b];
  const disc = b * b - 4 * a * c;
  if (disc < -EPS) return [];
  const root = Math.sqrt(Math.max(0, disc));
  return [(-b - root) / (2 * a), (-b + root) / (2 * a)];
}

function sameCircle(p: Circle, q: Circle): boolean {
  // Merge numerical copies, not distinct solutions whose contact differs on tiny inputs.
  const tol = 256 * Number.EPSILON * Math.max(1, p.radius, q.radius);
  return (
    Math.abs(p.radius - q.radius) < tol &&
    Math.abs(p.center.x - q.center.x) < tol &&
    Math.abs(p.center.y - q.center.y) < tol
  );
}
