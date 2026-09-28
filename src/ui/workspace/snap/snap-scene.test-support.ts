// Scene fixtures for the workspace snapping tests (LBG-F06).

import {
  createLayer,
  createProject,
  curveSubpathBounds,
  IDENTITY_TRANSFORM,
  type Bounds,
  type ColoredPath,
  type Layer,
  type Project,
  type SceneObject,
  type Transform,
  type Vec2,
} from '../../../core/scene';

// Scene data (path and layer colour), not UI chrome (ADR-047).
// eslint-disable-next-line no-restricted-syntax
const ARTWORK_COLOR = '#000000';

export function projectWith(
  objects: ReadonlyArray<SceneObject>,
  layers: ReadonlyArray<Layer> = [createLayer({ id: 'default', color: ARTWORK_COLOR })],
): Project {
  const project = createProject();
  return { ...project, scene: { ...project.scene, objects, layers } };
}

export function pathObject(
  id: string,
  paths: ReadonlyArray<ColoredPath>,
  transform: Partial<Transform> = {},
): SceneObject {
  let bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const include = (b: Bounds): void => {
    bounds = {
      minX: Math.min(bounds.minX, b.minX),
      minY: Math.min(bounds.minY, b.minY),
      maxX: Math.max(bounds.maxX, b.maxX),
      maxY: Math.max(bounds.maxY, b.maxY),
    };
  };
  for (const path of paths) {
    for (const curve of path.curves ?? []) include(curveSubpathBounds(curve));
    for (const polyline of path.polylines) {
      for (const p of polyline.points) include({ minX: p.x, minY: p.y, maxX: p.x, maxY: p.y });
    }
  }
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds,
    transform: { ...IDENTITY_TRANSFORM, ...transform },
    paths,
  };
}

export function polylinePath(points: ReadonlyArray<Vec2>, closed = false): ColoredPath {
  return { color: ARTWORK_COLOR, polylines: [{ points, closed }] };
}

export function squarePoints(x: number, y: number, size = 10): ReadonlyArray<Vec2> {
  return [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ];
}

// A closed square (10 mm unless sized) with its local origin at (x, y).
export function square(
  id: string,
  x: number,
  y: number,
  transform: Partial<Transform> = {},
  size = 10,
): SceneObject {
  return pathObject(id, [polylinePath(squarePoints(0, 0, size), true)], { x, y, ...transform });
}

export function line(id: string, from: Vec2, to: Vec2): SceneObject {
  return pathObject(id, [polylinePath([from, to])]);
}
