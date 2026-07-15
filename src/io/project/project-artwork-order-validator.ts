import { validateArray } from './project-shape-primitives';

export function validateOptionalArtworkOrder(
  scene: Record<string, unknown>,
  path: string,
): string | null {
  const order = scene['artworkOrder'];
  if (order === undefined) return null;
  if (!Array.isArray(order)) return `missing or invalid \`${path}\``;
  return validateArray(order, path, (value, itemPath) =>
    typeof value === 'string' ? null : `missing or invalid \`${itemPath}\``,
  );
}
