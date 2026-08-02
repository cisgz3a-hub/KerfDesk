// Shared image-mask fixture. Builds a kind:'shape' SceneObject whose single
// closed polyline is EXACTLY the point list given — createPolyline fairs
// (rounds) lists of five or more vertices, which would move the very contour a
// mask test is pinning. Used by the mask scanline parity suite and the mask
// performance regression suite, so it lives here rather than being duplicated.
// Test-only helper: under src/__fixtures__ (boundary- and coverage-exempt per
// eslint.config.mjs). Pure and deterministic.

import {
  IDENTITY_TRANSFORM,
  type Bounds,
  type ShapeObject,
  type Transform,
  type Vec2,
} from '../core/scene';

export function maskShape(
  id: string,
  points: ReadonlyArray<Vec2>,
  transform: Transform = IDENTITY_TRANSFORM,
): ShapeObject {
  return {
    kind: 'shape',
    id,
    spec: { kind: 'polyline', points, closed: true },
    color: '#000000',
    bounds: boundsOfPoints(points),
    transform,
    paths: [{ color: '#000000', polylines: [{ points, closed: true }] }],
  };
}

// Regular n-gon on a circle — a stand-in for a traced mask contour, whose
// point count is what makes the per-pixel even-odd test quadratic.
export function maskCirclePoints(
  pointCount: number,
  radius: number,
  centerX: number,
  centerY: number,
): ReadonlyArray<Vec2> {
  const points: Vec2[] = [];
  for (let i = 0; i < pointCount; i += 1) {
    const angle = (i / pointCount) * 2 * Math.PI;
    points.push({
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    });
  }
  return points;
}

// Reduced rather than spread: a traced-mask fixture can carry thousands of
// points, which would overflow the argument list of Math.min(...xs).
function boundsOfPoints(points: ReadonlyArray<Vec2>): Bounds {
  return points.reduce<Bounds>(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxX: Math.max(bounds.maxX, point.x),
      maxY: Math.max(bounds.maxY, point.y),
    }),
    { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  );
}
