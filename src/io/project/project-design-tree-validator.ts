import { isObject } from './project-shape-primitives';

/** Stale ranks are harmless presentation metadata; live rows ignore/prune them. */
export function validateDesignTreeOrder(value: unknown): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length > 20_000) return 'Invalid scene.designTreeOrder';
  const seen = new Set<string>();
  for (const entry of value) {
    if (
      !isObject(entry) ||
      typeof entry['kind'] !== 'string' ||
      !['group', 'object'].includes(entry['kind']) ||
      typeof entry['id'] !== 'string' ||
      entry['id'].trim() === ''
    )
      return 'Invalid scene.designTreeOrder entry';
    const key = `${entry['kind']}:${entry['id']}`;
    if (seen.has(key)) return 'Duplicate scene.designTreeOrder identity';
    seen.add(key);
  }
  return null;
}
