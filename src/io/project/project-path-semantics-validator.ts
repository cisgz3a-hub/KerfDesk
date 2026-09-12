import { firstError, isObject, requireNumber } from './project-shape-primitives';

/** Version 7 path semantics must be understood, never silently discarded. */
export function validatePathSemantics(value: Record<string, unknown>, path: string): string | null {
  const fillRule = value['fillRule'];
  if (fillRule !== undefined && fillRule !== 'nonzero' && fillRule !== 'evenodd') {
    return `missing or invalid \`${path}.fillRule\``;
  }
  const transform = value['strokeTransform'];
  if (transform === undefined) return null;
  const transformPath = `${path}.strokeTransform`;
  if (!isObject(transform) || value['strokeWidthMm'] === undefined) {
    return `missing or invalid \`${transformPath}\``;
  }
  const error = firstError(
    ['a', 'b', 'c', 'd'].map((key) => requireNumber(transform, `${transformPath}.${key}`)),
  );
  if (error !== null) return error;
  const a = transform['a'] as number;
  const b = transform['b'] as number;
  const c = transform['c'] as number;
  const d = transform['d'] as number;
  const determinant = a * d - b * c;
  if (
    !Number.isFinite(determinant) ||
    (determinant !== 0 && [a, b, c, d].some((entry) => !Number.isFinite(entry / determinant)))
  ) {
    return `missing or invalid \`${transformPath}\``;
  }
  return null;
}
