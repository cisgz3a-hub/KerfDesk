import { type AABB, emptyAABB, mergeAABB } from '../types';
import { type Scene } from './Scene';
import { computeObjectBounds } from '../../geometry/bounds';

export type BoundsMode = 'visible' | 'output' | 'selected' | 'all';

export interface SelectSceneBoundsOptions {
  selectedIds?: ReadonlySet<string> | readonly string[];
}

function toSelectedIdSet(ids: SelectSceneBoundsOptions['selectedIds']): ReadonlySet<string> {
  if (!ids) return new Set<string>();
  if (typeof (ids as ReadonlySet<string>).has === 'function') {
    return ids as ReadonlySet<string>;
  }
  return new Set(ids as readonly string[]);
}

function isValidBounds(bounds: AABB): boolean {
  return Number.isFinite(bounds.minX) &&
    Number.isFinite(bounds.minY) &&
    Number.isFinite(bounds.maxX) &&
    Number.isFinite(bounds.maxY) &&
    bounds.maxX >= bounds.minX &&
    bounds.maxY >= bounds.minY;
}

/**
 * T3-67: canonical scene-bounds selector.
 *
 * - visible: objects the canvas can render, excluding hidden layers/objects.
 * - output: objects the compiler can emit, excluding hidden/non-output layers.
 * - selected: selected object ids only, independent of layer output state.
 * - all: every scene object, including hidden/locked/reference content.
 */
export function selectSceneBounds(
  scene: Scene,
  mode: BoundsMode,
  options: SelectSceneBoundsOptions = {},
): AABB {
  let bounds = emptyAABB();
  const layerById = new Map(scene.layers.map((layer) => [layer.id, layer]));
  const selectedIds = mode === 'selected' ? toSelectedIdSet(options.selectedIds) : null;

  for (const object of scene.objects) {
    const layer = layerById.get(object.layerId);

    if (mode === 'visible') {
      if (!object.visible || !layer?.visible) continue;
    } else if (mode === 'output') {
      if (!object.visible || !layer?.visible || !layer.output) continue;
    } else if (mode === 'selected') {
      if (!selectedIds?.has(object.id)) continue;
    }

    const objectBounds = computeObjectBounds(object);
    if (isValidBounds(objectBounds)) {
      bounds = mergeAABB(bounds, objectBounds);
    }
  }

  return bounds;
}
