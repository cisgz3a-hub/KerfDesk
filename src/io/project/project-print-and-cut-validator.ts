import { firstError, isObject, requireCoordinate } from './project-shape-primitives';

export function validatePrintAndCutTargets(value: unknown): string | null {
  if (value === undefined) return null;
  if (!isObject(value) || !isObject(value['first']) || !isObject(value['second'])) {
    return 'missing or invalid `printAndCutTargets`';
  }
  const first = value['first'];
  const second = value['second'];
  const error = firstError([
    requireCoordinate(first, 'printAndCutTargets.first.x'),
    requireCoordinate(first, 'printAndCutTargets.first.y'),
    requireCoordinate(second, 'printAndCutTargets.second.x'),
    requireCoordinate(second, 'printAndCutTargets.second.y'),
  ]);
  if (error !== null) return error;
  const firstX = Number(first['x']);
  const firstY = Number(first['y']);
  const secondX = Number(second['x']);
  const secondY = Number(second['y']);
  return Math.hypot(secondX - firstX, secondY - firstY) >= 0.001
    ? null
    : '`printAndCutTargets` must be distinct';
}
