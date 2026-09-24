import { IDENTITY_TRANSFORM, type ImportedSvg, type Polyline, type Vec2 } from '../core/scene';

export function repairLine(...points: Vec2[]): Polyline {
  return { points, closed: false };
}

export function repairRectangle(x: number, y: number, width: number, height: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
      { x, y },
    ],
  };
}

export function repairArtwork(
  id: string,
  polylines: ReadonlyArray<Polyline>,
  patch: Partial<ImportedSvg> = {},
): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: id,
    operationIds: ['cut'],
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#000000', polylines }],
    ...patch,
  };
}

/** Independent shoelace and Euclidean metrics, with no boolean/join engine calls. */
export function repairMetrics(object: ImportedSvg): { area: number; length: number } {
  let area = 0;
  let length = 0;
  for (const path of object.paths.flatMap((batch) => batch.polylines)) {
    for (let index = 0; index < path.points.length; index += 1) {
      const point = path.points[index];
      const next = path.points[index + 1] ?? (path.closed ? path.points[0] : undefined);
      if (point === undefined || next === undefined) continue;
      area += (point.x * next.y - point.y * next.x) / 2;
      length += Math.hypot(point.x - next.x, point.y - next.y);
    }
  }
  return { area: Math.abs(area), length };
}
