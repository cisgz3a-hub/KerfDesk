import {
  firstError,
  isObject,
  optionalLiteral,
  requireBoolean,
  requireNumber,
  requireString,
} from './project-shape-primitives';

export function validatePathText(value: unknown, path: string): string | null {
  if (value === undefined) return null;
  if (!isObject(value)) return `missing or invalid \`${path}\``;
  const fieldError = firstError([
    requireString(value, `${path}.guideObjectId`),
    requireNumber(value, `${path}.offsetMm`),
    requireBoolean(value, `${path}.reverse`),
    optionalLiteral(value, `${path}.alongAlign`, ['start', 'middle', 'end']),
    optionalLiteral(value, `${path}.acrossAlign`, ['above', 'center', 'below']),
  ]);
  if (fieldError !== null) return fieldError;
  return typeof value['offsetMm'] === 'number' && value['offsetMm'] < 0
    ? `invalid \`${path}.offsetMm\``
    : null;
}
