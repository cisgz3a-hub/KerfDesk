import { refreshReliefRailLinks } from './relief-rail-profile-links';
import type { ReliefAuthoringDocument, ReliefVectorMask } from '../scene/relief/relief-authoring';
import type { SceneObject, Transform } from '../scene/scene-object';
import { applyTransform } from '../scene/transform';
import { IDENTITY_TRANSFORM } from '../scene/scene-object';
import {
  inverseReliefPoint,
  reliefBoundaryError,
  reliefBoundarySizeError,
} from './relief-vector-boundary';
import { reviseReliefDocument } from './relief-authoring-document';

export type ReliefLinkRefreshResult =
  | { readonly kind: 'ok'; readonly document: ReliefAuthoringDocument; readonly changed: boolean }
  | { readonly kind: 'error'; readonly reason: string };

/** Linked changes atomically revise retained intent; caller materialises before committing. */
export function refreshReliefVectorLinks(
  document: ReliefAuthoringDocument,
  objects: ReadonlyArray<SceneObject>,
  reliefTransform: Transform,
): ReliefLinkRefreshResult {
  let changed = false;
  function refresh(
    mask: ReliefVectorMask | undefined,
    componentTransform = IDENTITY_TRANSFORM,
  ): ReliefVectorMask | undefined {
    const updated = refreshedMask(mask, objects, reliefTransform, componentTransform);
    if (updated !== mask) changed = true;
    return updated;
  }
  try {
    const clip = refresh(document.clip);
    const levels = document.levels.map((level) => {
      const mask = refresh(level.mask);
      return mask === undefined ? level : { ...level, mask };
    });
    const components = document.components.map((component) => {
      const mask = refresh(component.mask, component.transform);
      let source = component.source;
      if (source.kind === 'vector-shape-v1')
        source = {
          ...source,
          boundary: refresh(source.boundary, component.transform) ?? source.boundary,
        };
      if (source.kind === 'rail-profile-v1') {
        const updated = refreshReliefRailLinks(
          source,
          objects,
          reliefTransform,
          component.transform,
          document.algorithmRevision === 'retained-relief-v1',
        );
        source = updated.source;
        changed ||= updated.changed;
      }
      return { ...component, source, ...(mask === undefined ? {} : { mask }) };
    });
    const strokes = document.strokes.map((stroke) => {
      const region = refresh(stroke.region);
      return region === undefined ? stroke : { ...stroke, region };
    });
    if (!changed) return { kind: 'ok', document, changed: false };
    return {
      kind: 'ok',
      document: reviseReliefDocument(document, {
        levels,
        components,
        strokes,
        ...(clip === undefined ? {} : { clip }),
      }),
      changed: true,
    };
  } catch (error) {
    return {
      kind: 'error',
      reason: error instanceof Error ? error.message : 'Relief link refresh failed.',
    };
  }
}

function refreshedMask(
  mask: ReliefVectorMask | undefined,
  objects: ReadonlyArray<SceneObject>,
  root: Transform,
  component: Transform,
): ReliefVectorMask | undefined {
  if (mask?.linkedObjectId === undefined) return mask;
  const source = objects.find((o) => o.id === mask.linkedObjectId);
  if (source === undefined || !('paths' in source))
    throw new Error(
      `Linked relief boundary ${mask.linkedObjectId} is missing or is not vector artwork.`,
    );
  const polylines = source.paths.flatMap((path) => path.polylines);
  const sizeError = reliefBoundarySizeError(polylines);
  if (sizeError !== null) throw new Error(sizeError);
  const rings = polylines.map((ring) => ({
    closed: ring.closed,
    points: ring.points.map((p) =>
      inverseReliefPoint(
        inverseReliefPoint(applyTransform(p, source.transform), root),
        mask.linkComponentTransform ?? component,
      ),
    ),
  }));
  const updated = { ...mask, rings },
    error = reliefBoundaryError(updated);
  if (error !== null) throw new Error(error);
  return JSON.stringify(mask.rings) === JSON.stringify(rings) ? mask : updated;
}
