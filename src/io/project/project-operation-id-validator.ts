import { validateArray } from './project-shape-primitives';

export function validateOperationIds(value: unknown, path: string): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return `missing or invalid \`${path}\``;
  return validateArray(value, path, (id, idPath) =>
    typeof id === 'string' && id.length > 0 ? null : `missing or invalid \`${idPath}\``,
  );
}
