import { reliefSourceWork } from './relief-rail-profile-validation';

const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
/** Count polygon traversal as well as pixels before any authoring field allocation. */
export function reliefMaskWork(mask: unknown): number {
  if (!record(mask) || !Array.isArray(mask['rings'])) return 0;
  if (mask['rings'].length > 128) return Infinity;
  return (
    2 *
    mask['rings'].reduce<number>(
      (sum, ring) =>
        sum + (record(ring) && Array.isArray(ring['points']) ? ring['points'].length : 0),
      0,
    )
  );
}
export function reliefCompositionWork(document: Record<string, unknown>): number {
  const components = Array.isArray(document['components']) ? document['components'] : [];
  const levels = Array.isArray(document['levels']) ? document['levels'] : [];
  if (components.length > 64 || levels.length > 64) return Infinity;
  const clip = reliefMaskWork(document['clip']);
  const cost = components.reduce<number>((sum, component) => {
    if (!record(component)) return sum + 1;
    const level = levels.find((entry) => record(entry) && entry['id'] === component['levelId']);
    const source = component['source'];
    const shapeWork =
      record(source) && source['kind'] === 'vector-shape-v1'
        ? reliefMaskWork(source['boundary'])
        : 0;
    return (
      sum +
      reliefSourceWork(source) +
      shapeWork +
      clip +
      reliefMaskWork(component['mask']) +
      reliefMaskWork(record(level) ? level['mask'] : undefined)
    );
  }, clip);
  return (document['width'] as number) * (document['height'] as number) * Math.max(1, cost);
}
export function reliefStrokeSampleWork(stroke: {
  readonly mode: string;
  readonly region?: unknown;
}): number {
  return (stroke.mode === 'smooth' ? 10 : 1) * (1 + reliefMaskWork(stroke.region));
}
