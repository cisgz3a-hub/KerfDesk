import { IDENTITY_TRANSFORM, type ImportedSvg } from '../scene/scene-object';
export function compoundRectangle(id: string, x = 0, operationId = 'cut'): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    name: id,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: { ...IDENTITY_TRANSFORM, x },
    operationIds: [operationId],
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
              { x: 0, y: 10 },
            ],
          },
        ],
      },
    ],
  };
}
export function compoundArea(object: ImportedSvg): number {
  return Math.abs(
    object.paths
      .flatMap((path) => path.polylines)
      .reduce(
        (total, line) =>
          total +
          line.points.reduce((area, point, index) => {
            const next = line.points[(index + 1) % line.points.length];
            return next === undefined ? area : area + (point.x * next.y - next.x * point.y) / 2;
          }, 0),
        0,
      ),
  );
}
