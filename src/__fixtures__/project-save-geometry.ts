import { polylineToCurveSubpath, type Project } from '../core/scene';
import { projectWithLine } from './file-actions';

export function denseProjectSaveGeometry(mutation?: string): Project {
  const base = projectWithLine();
  const object = base.scene.objects[0]!;
  if (!('paths' in object)) throw new Error('Vector fixture is missing.');
  const original = object.paths[0]!;
  const polyline = {
    closed: false,
    points: Array.from({ length: 6_000 }, (_, x) => ({ x, y: x % 7 })),
  };
  const curve = polylineToCurveSubpath(polyline);
  let changedPolyline: unknown = polyline;
  let changedCurve: unknown = curve;
  switch (mutation) {
    case undefined:
      break;
    case 'numeric-string':
      changedPolyline = { ...polyline, points: [{ x: '0', y: 0 }, ...polyline.points.slice(1)] };
      break;
    case 'closed-string':
      changedPolyline = { ...polyline, closed: 'false' };
      break;
    case 'point-field':
      changedPolyline = {
        ...polyline,
        points: [{ ...polyline.points[0], rawExtra: 'preserve' }, ...polyline.points.slice(1)],
      };
      break;
    case 'polyline-field':
      changedPolyline = { ...polyline, rawExtra: 'preserve' };
      break;
    case 'curve-field':
      changedCurve = { ...curve, rawExtra: 'preserve' };
      break;
    case 'segment-field':
      changedCurve = {
        ...curve,
        segments: [{ ...curve.segments[0], rawExtra: 'preserve' }, ...curve.segments.slice(1)],
      };
      break;
    case 'arc-flag':
      changedCurve = {
        ...curve,
        segments: [
          {
            kind: 'elliptical-arc',
            to: { x: 1, y: 1 },
            radiusX: 5,
            radiusY: 5,
            rotationDeg: 0,
            largeArc: 'false',
            sweep: false,
          },
          ...curve.segments.slice(1),
        ],
      };
      break;
  }
  return {
    ...base,
    scene: {
      ...base.scene,
      objects: [
        {
          ...object,
          paths: [{ ...original, polylines: [changedPolyline], curves: [changedCurve] }],
        },
      ],
    },
  } as unknown as Project;
}
