import type { Project } from '../../core/scene';

type RecordValue = Record<string, unknown>;
const POINT_KEYS = ['x', 'y'];
const POLYLINE_KEYS = ['points', 'closed'];
const CURVE_KEYS = ['start', 'segments', 'closed'];
const LINE_KEYS = ['kind', 'to'];
const CUBIC_KEYS = ['kind', 'control1', 'control2', 'to'];
const ARC_KEYS = ['kind', 'radiusX', 'radiusY', 'rotationDeg', 'largeArc', 'sweep', 'to'];

// Packed geometry writes Float64 values/boolean flags and reconstructs known
// fields. Only exact typed shapes may take that route: malformed coordinates,
// flags or extra geometry properties must reach Save validation unchanged.
export function projectSaveGeometryCanPack(project: Project): boolean {
  try {
    if (!Array.isArray(project.scene?.objects)) return false;
    for (const object of project.scene.objects) {
      if (!record(object)) return false;
      if ('paths' in object && !pathsCanPack(object['paths'])) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function pathsCanPack(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  for (const path of value) {
    if (!record(path) || !Array.isArray(path['polylines'])) return false;
    for (const polyline of path['polylines']) if (!polylineCanPack(polyline)) return false;
    if (path['curves'] !== undefined && !curvesCanPack(path['curves'])) return false;
  }
  return true;
}

function polylineCanPack(value: unknown): boolean {
  if (!keys(value, POLYLINE_KEYS) || typeof value['closed'] !== 'boolean') return false;
  if (!Array.isArray(value['points'])) return false;
  for (const point of value['points']) if (!pointCanPack(point)) return false;
  return true;
}

function curvesCanPack(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  for (const curve of value) {
    if (!keys(curve, CURVE_KEYS) || typeof curve['closed'] !== 'boolean') return false;
    if (!pointCanPack(curve['start']) || !Array.isArray(curve['segments'])) return false;
    for (const segment of curve['segments']) if (!segmentCanPack(segment)) return false;
  }
  return true;
}

function segmentCanPack(value: unknown): boolean {
  if (!record(value) || !pointCanPack(value['to'])) return false;
  switch (value['kind']) {
    case 'line':
      return keys(value, LINE_KEYS);
    case 'cubic':
      return (
        keys(value, CUBIC_KEYS) &&
        pointCanPack(value['control1']) &&
        pointCanPack(value['control2'])
      );
    case 'elliptical-arc':
      return arcCanPack(value);
    default:
      return false;
  }
}

function arcCanPack(value: RecordValue): boolean {
  return (
    keys(value, ARC_KEYS) &&
    finite(value['radiusX']) &&
    finite(value['radiusY']) &&
    finite(value['rotationDeg']) &&
    typeof value['largeArc'] === 'boolean' &&
    typeof value['sweep'] === 'boolean'
  );
}

function pointCanPack(value: unknown): boolean {
  return keys(value, POINT_KEYS) && finite(value['x']) && finite(value['y']);
}

function finite(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function keys(value: unknown, expected: readonly string[]): value is RecordValue {
  return (
    record(value) &&
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function record(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
