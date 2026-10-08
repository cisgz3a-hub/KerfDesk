import { detachedRailProfile } from '../../core/relief/relief-rail-profile-links';
import type {
  ReliefAuthoringDocument,
  ReliefComponent,
  ReliefSculptStroke,
  ReliefVectorMask,
} from '../../core/scene/relief/relief-authoring';
import { createBlankReliefAuthoringDocument } from '../../core/relief/relief-authoring-document';
import { reliefAuthoringError } from '../../core/relief/relief-authoring-validation';
import { validateReliefHeightfield } from './project-relief-heightfield-validator';
import { isObject } from './project-shape-primitives';

export type ReliefComponentAsset = {
  readonly schemaVersion: 1;
  readonly kind: 'kerfdesk-relief-component-v1';
  readonly units: 'mm';
  readonly physicalWidthMm: number;
  readonly physicalHeightMm: number;
  readonly maxDepthMm: number;
  readonly component: ReliefComponent;
  readonly strokes: ReadonlyArray<ReliefSculptStroke>;
};

/** Local reuse owns geometry snapshots; cross-project links never silently rebind. */
export function reliefComponentAsset(
  document: ReliefAuthoringDocument,
  component: ReliefComponent,
): ReliefComponentAsset {
  const source =
    component.source.kind === 'vector-shape-v1'
      ? { ...component.source, boundary: detachedMask(component.source.boundary) }
      : component.source.kind === 'rail-profile-v1'
        ? detachedRailProfile(component.source)
        : component.source;
  return {
    kind: 'kerfdesk-relief-component-v1',
    schemaVersion: 1,
    units: 'mm',
    physicalWidthMm: document.physicalWidthMm,
    physicalHeightMm: document.physicalHeightMm,
    maxDepthMm: document.maxDepthMm,
    component: {
      ...component,
      source,
      ...(component.mask === undefined ? {} : { mask: detachedMask(component.mask) }),
    },
    strokes: document.strokes
      .filter((s) => s.componentId === component.id)
      .map((s) => ({
        ...s,
        ...(s.region === undefined ? {} : { region: detachedMask(s.region) }),
      })),
  };
}

export function parseReliefComponentAsset(
  json: string,
):
  | { readonly kind: 'ok'; readonly asset: ReliefComponentAsset }
  | { readonly kind: 'error'; readonly reason: string } {
  if (json.length > 32 * 1024 * 1024)
    return { kind: 'error', reason: 'Relief component file exceeds 32 MiB.' };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { kind: 'error', reason: 'Relief component file is not valid JSON.' };
  }
  if (
    !isObject(raw) ||
    raw['kind'] !== 'kerfdesk-relief-component-v1' ||
    raw['schemaVersion'] !== 1 ||
    raw['units'] !== 'mm' ||
    !isObject(raw['component'])
  )
    return { kind: 'error', reason: 'Unsupported relief component file or units.' };
  const asset = raw as unknown as ReliefComponentAsset;
  const doc = createBlankReliefAuthoringDocument({
    width: 1,
    height: 1,
    physicalWidthMm: asset.physicalWidthMm,
    physicalHeightMm: asset.physicalHeightMm,
    maxDepthMm: asset.maxDepthMm,
  });
  const candidate = {
    ...doc,
    components: [{ ...asset.component, levelId: 'level-1' }],
    strokes: asset.strokes,
  };
  const error = reliefAuthoringError(candidate);
  if (error !== null) return { kind: 'error', reason: error };
  if (asset.component.source.kind === 'retained-field-v1') {
    const sourceError = validateReliefHeightfield(
      asset.component.source.field,
      'component.source.field',
    );
    if (sourceError !== null) return { kind: 'error', reason: sourceError };
  }
  return {
    kind: 'ok',
    asset: reliefComponentAsset(candidate, candidate.components[0] ?? asset.component),
  };
}

export function importReliefComponentAsset(
  document: ReliefAuthoringDocument,
  asset: ReliefComponentAsset,
  id: string,
): ReliefAuthoringDocument {
  const levelId = document.levels[0]?.id;
  if (levelId === undefined)
    throw new Error('Relief component import requires a destination level.');
  return {
    ...document,
    revision: document.revision + 1,
    components: [...document.components, { ...asset.component, id, levelId }],
    strokes: [
      ...document.strokes,
      ...asset.strokes.map((s, index) => ({ ...s, id: `${id}-stroke-${index}`, componentId: id })),
    ],
  };
}

function detachedMask(mask: ReliefVectorMask): ReliefVectorMask {
  return { rings: mask.rings };
}
