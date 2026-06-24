import type { Polyline, Vec2 } from '../scene';

export type StarSpec = {
  readonly points: number; // clamped to [3, 64]
  readonly outerRadiusMm: number;
  readonly innerRadiusRatio: number; // clamped to (0, 1)
};

const MIN_POINTS = 3;
const MAX_POINTS = 64;
const DEFAULT_INNER_RADIUS_RATIO = 0.5;
const MIN_INNER_RADIUS_RATIO = 0.05;
const MAX_INNER_RADIUS_RATIO = 0.95;
const START_ANGLE_RAD = -Math.PI / 2;

export function starToPolylines(spec: StarSpec): ReadonlyArray<Polyline> {
  const points = clampPoints(spec.points);
  const outerRadius = Math.max(0, spec.outerRadiusMm);
  const innerRadius = outerRadius * clampInnerRadiusRatio(spec.innerRadiusRatio);
  const center = { x: outerRadius, y: outerRadius };
  const vertices: Vec2[] = [];
  const vertexCount = points * 2;
  for (let i = 0; i < vertexCount; i += 1) {
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = START_ANGLE_RAD + (Math.PI * i) / points;
    vertices.push({
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    });
  }
  const first = vertices[0];
  if (first !== undefined) vertices.push(first);
  return [{ points: vertices, closed: true }];
}

function clampPoints(points: number): number {
  if (!Number.isFinite(points)) return MIN_POINTS;
  return Math.min(MAX_POINTS, Math.max(MIN_POINTS, Math.floor(points)));
}

function clampInnerRadiusRatio(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_INNER_RADIUS_RATIO;
  return Math.min(MAX_INNER_RADIUS_RATIO, Math.max(MIN_INNER_RADIUS_RATIO, value));
}
