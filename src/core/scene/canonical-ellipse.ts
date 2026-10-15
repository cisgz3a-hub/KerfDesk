import { parametricEllipseCurve } from '../geometry/ellipse-curve';
import type { SceneObject } from './scene-object';

/** A shape tag alone is not proof: legacy saved paths and bounds are independent. */
export function isCanonicalEllipse(object: SceneObject): boolean {
  if (object.kind !== 'shape' || object.spec.kind !== 'ellipse') return false;
  const { widthMm, heightMm } = object.spec;
  if (!(widthMm > 0 && heightMm > 0)) return false;
  if (!hasEllipseBounds(object.bounds, widthMm, heightMm)) return false;
  const path = object.paths[0];
  if (object.paths.length !== 1 || path === undefined || path.curves?.length !== 1) return false;
  const rx = widthMm / 2;
  const ry = heightMm / 2;
  const expected = parametricEllipseCurve({
    center: { x: rx, y: ry },
    majorAxis: { x: rx, y: 0 },
    ratio: ry / rx,
    startParam: 0,
    sweep: 2 * Math.PI,
    closed: true,
  });
  // An older/different representation simply takes the conservative rectangle
  // fit. This comparison is an optimisation, never a project validity rule.
  if (JSON.stringify(path.curves[0]) !== JSON.stringify(expected)) return false;
  return path.polylines.every((line) =>
    line.points.every((p) => ((p.x - rx) / rx) ** 2 + ((p.y - ry) / ry) ** 2 <= 1 + 1e-12),
  );
}

function hasEllipseBounds(b: SceneObject['bounds'], width: number, height: number): boolean {
  return b.minX === 0 && b.minY === 0 && b.maxX === width && b.maxY === height;
}
