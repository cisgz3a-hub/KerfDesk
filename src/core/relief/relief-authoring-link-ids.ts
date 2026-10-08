import type { ReliefAuthoringDocument } from '../scene/relief/relief-authoring';

/** All live sources refreshed by retained relief authoring, independent of output bindings. */
export function reliefAuthoringLinkIds(document: ReliefAuthoringDocument): readonly string[] {
  const ids = new Set<string>();
  const add = (link: { readonly linkedObjectId?: string } | undefined): void => {
    if (link?.linkedObjectId !== undefined) ids.add(link.linkedObjectId);
  };
  add(document.clip);
  for (const level of document.levels) add(level.mask);
  for (const stroke of document.strokes) add(stroke.region);
  for (const component of document.components) {
    add(component.mask);
    const source = component.source;
    if (source.kind === 'vector-shape-v1') add(source.boundary);
    if (source.kind === 'rail-profile-v1') {
      add(source.rail);
      add(source.secondRail);
    }
  }
  return [...ids].sort();
}
