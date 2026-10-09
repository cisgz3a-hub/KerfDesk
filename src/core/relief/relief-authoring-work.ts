import { reliefSourceWork } from './relief-rail-profile-validation';

const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
/** Count polygon traversal as well as pixels before any authoring field allocation. */
export function reliefMaskWork(mask: unknown, wholeCell = false): number {
  if (!record(mask) || !Array.isArray(mask['rings'])) return 0;
  if (mask['rings'].length > 128) return Infinity;
  return (
    (wholeCell ? 16 : 2) *
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
  const wholeCell =
    document['algorithmRevision'] === 'retained-relief-v2' &&
    document['outsideMask'] === 'excluded';
  const clip = reliefMaskWork(document['clip'], wholeCell);
  const cost = components.reduce<number>((sum, component) => {
    if (!record(component)) return sum + 1;
    const level = levels.find((entry) => record(entry) && entry['id'] === component['levelId']);
    const source = component['source'];
    const shapeWork =
      record(source) && source['kind'] === 'vector-shape-v1'
        ? reliefMaskWork(source['boundary'], wholeCell)
        : 0;
    return (
      sum +
      reliefSourceWork(source) +
      shapeWork +
      clip +
      reliefMaskWork(component['mask'], wholeCell) +
      reliefMaskWork(record(level) ? level['mask'] : undefined, wholeCell)
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
