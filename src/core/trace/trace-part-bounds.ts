import {
  curveSubpathBounds,
  type Bounds,
  type ColoredPath,
  type CurveSubpath,
  type Polyline,
} from '../scene';

// Contours are immutable and extraction keeps their references. A prepared
// remainder therefore reuses exact bounds without scanning its vertices again.
const contourBounds = new WeakMap<CurveSubpath | Polyline, Bounds>();
const preparedPaths = new WeakSet<ColoredPath>();

export function traceContourBounds(contour: CurveSubpath | Polyline): Bounds {
  const cached = contourBounds.get(contour);
  if (cached !== undefined) return cached;
  let bounds: Bounds;
  if ('segments' in contour) bounds = curveSubpathBounds(contour);
  else {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const point of contour.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
    bounds = { minX, minY, maxX, maxY };
  }
  contourBounds.set(contour, bounds);
  return bounds;
}

export function hasTracePartBounds(path: ColoredPath): boolean {
  if (preparedPaths.has(path)) return true;
  const ready = (path.curves ?? path.polylines).every((contour) => contourBounds.has(contour));
  if (ready) preparedPaths.add(path);
  return ready;
}

export function prepareTracePartBounds(path: ColoredPath): Float64Array {
  const contours = path.curves ?? path.polylines;
  const values = new Float64Array(contours.length * 4);
  contours.forEach((contour, index) => {
    const bounds = traceContourBounds(contour);
    values.set([bounds.minX, bounds.minY, bounds.maxX, bounds.maxY], index * 4);
  });
  preparedPaths.add(path);
  return values;
}

export function cacheTracePartBounds(path: ColoredPath, values: Float64Array): void {
  const contours = path.curves ?? path.polylines;
  if (values.length !== contours.length * 4) throw new Error('Incomplete trace contour bounds.');
  contours.forEach((contour, index) => {
    const at = index * 4;
    contourBounds.set(contour, {
      minX: values[at] as number,
      minY: values[at + 1] as number,
      maxX: values[at + 2] as number,
      maxY: values[at + 3] as number,
    });
  });
  preparedPaths.add(path);
}

export function boundsFromTracePartPaths(paths: ReadonlyArray<ColoredPath>): Bounds {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const path of paths) {
    for (const contour of path.curves ?? path.polylines) {
      const bounds = traceContourBounds(contour);
      minX = Math.min(minX, bounds.minX);
      minY = Math.min(minY, bounds.minY);
      maxX = Math.max(maxX, bounds.maxX);
      maxY = Math.max(maxY, bounds.maxY);
    }
  }
  return Number.isFinite(minX)
    ? { minX, minY, maxX, maxY }
    : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}
