import type { ColoredPath, Vec2 } from '../scene/scene-object';
import { polylineToCurveSubpath } from '../scene/curve-path';
import type { ConstrainedSketch2d } from './constrained-sketch';
import { sketchRequired } from './sketch-indexed';
export function sketchUnprofiledLines(sketch: ConstrainedSketch2d): ConstrainedSketch2d['lines'] {
  return sketch.lines.filter(
    (line) =>
      !sketch.profiles.some((profile) =>
        profile.pointIds.some((first, index) => {
          const second =
            profile.pointIds[index + 1] ?? (profile.closed ? profile.pointIds[0] : undefined);
          return (
            (first === line.first && second === line.second) ||
            (first === line.second && second === line.first)
          );
        }),
      ),
  );
}
export function sketchPathKeys(sketch: ConstrainedSketch2d): readonly string[] {
  return [
    ...sketch.profiles.map((profile) => 'profile-' + profile.id),
    ...sketch.circles.map((circle) => 'circle-' + circle.id),
    ...sketchUnprofiledLines(sketch).map((line) => 'line-' + line.id),
  ];
}
export function sketchPathGeometry(
  sketch: ConstrainedSketch2d,
  color: string,
): readonly ColoredPath[] {
  const points = new Map(sketch.points.map((point) => [point.id, point]));
  const point = (id: string): Vec2 => {
    const source = sketchRequired(points.get(id), 'point ' + id);
    return { x: source.x, y: source.y };
  };
  return [
    ...sketch.profiles.map((profile) =>
      linePath(profile.pointIds.map(point), profile.closed, color),
    ),
    ...sketch.circles.map((circle) => circlePath(point(circle.centre), circle.radiusMm, color)),
    ...sketchUnprofiledLines(sketch).map((line) =>
      linePath([point(line.first), point(line.second)], false, color),
    ),
  ];
}
function linePath(points: readonly Vec2[], closed: boolean, color: string): ColoredPath {
  const polyline = { points, closed };
  return { color, polylines: [polyline], curves: [polylineToCurveSubpath(polyline)] };
}
function circlePath(centre: Vec2, radius: number, color: string): ColoredPath {
  const start = { x: centre.x + radius, y: centre.y },
    opposite = { x: centre.x - radius, y: centre.y };
  const segment = {
    kind: 'elliptical-arc' as const,
    radiusX: radius,
    radiusY: radius,
    rotationDeg: 0,
    largeArc: false,
    sweep: true,
  };
  return {
    color,
    polylines: [
      {
        closed: true,
        points: Array.from({ length: 64 }, (_, i) => ({
          x: centre.x + radius * Math.cos((i * Math.PI) / 32),
          y: centre.y + radius * Math.sin((i * Math.PI) / 32),
        })),
      },
    ],
    curves: [
      {
        start,
        closed: true,
        segments: [
          { ...segment, to: opposite },
          { ...segment, to: start },
        ],
      },
    ],
  };
}
