// Guidelines (LightBurn: drag a guide out of a ruler). A guide is a line
// across the workspace at a fixed X (axis 'x', vertical) or Y (axis 'y',
// horizontal). Guides are layout aids saved with the project: they snap
// artwork and pointers, and never reach output, Frame or job bounds.

export type GuideAxis = 'x' | 'y';

export type ProjectGuide = {
  readonly id: string;
  readonly axis: GuideAxis;
  readonly positionMm: number;
};

export const MAX_GUIDES = 200;

/** The guides a saved project may carry: well-formed entries, at most MAX_GUIDES. */
export function normalizeGuides(value: unknown): ReadonlyArray<ProjectGuide> | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = new Set<string>();
  const guides: ProjectGuide[] = [];
  for (const entry of value) {
    if (guides.length >= MAX_GUIDES) break;
    const guide = parseGuide(entry);
    if (guide === null || ids.has(guide.id)) continue;
    ids.add(guide.id);
    guides.push(guide);
  }
  return guides.length === 0 ? undefined : guides;
}

function parseGuide(entry: unknown): ProjectGuide | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const { id, axis, positionMm } = entry as Record<string, unknown>;
  if (typeof id !== 'string' || id === '') return null;
  if (axis !== 'x' && axis !== 'y') return null;
  if (typeof positionMm !== 'number' || !Number.isFinite(positionMm)) return null;
  return { id, axis, positionMm };
}

/** The nearest guide position on `axis` within `reachMm` of `valueMm`, or null. */
export function nearestGuidePosition(
  guides: ReadonlyArray<ProjectGuide> | undefined,
  axis: GuideAxis,
  valueMm: number,
  reachMm: number,
): number | null {
  let best: number | null = null;
  for (const guide of guides ?? []) {
    if (guide.axis !== axis) continue;
    const distance = Math.abs(guide.positionMm - valueMm);
    if (distance <= reachMm && (best === null || distance < Math.abs(best - valueMm))) {
      best = guide.positionMm;
    }
  }
  return best;
}
