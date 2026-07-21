// Layer-list operations (ADR-245): pure array transforms for the Layers
// panel — add, duplicate, remove, reorder, merge down, and property edits.
// Every function returns a new list; buffers are shared except where the
// operation's meaning requires a copy (duplicate, merge).

import { cloneRgbaBuffer } from '../image-edit';
import { compositeLayersInPlace } from './composite';
import { createLayer, type EditorLayer } from './layer';

function indexOfLayer(layers: readonly EditorLayer[], id: string): number {
  return layers.findIndex((layer) => layer.id === id);
}

/** Insert a new transparent layer directly above the given layer. */
export function addLayerAbove(
  layers: readonly EditorLayer[],
  aboveId: string,
  newId: string,
  name: string,
): readonly EditorLayer[] {
  const at = indexOfLayer(layers, aboveId);
  const reference = layers[at];
  if (reference === undefined) return layers;
  const layer = createLayer(
    newId,
    name,
    reference.buffer.width,
    reference.buffer.height,
    'transparent',
  );
  return [...layers.slice(0, at + 1), layer, ...layers.slice(at + 1)];
}

export function duplicateLayer(
  layers: readonly EditorLayer[],
  id: string,
  newId: string,
): readonly EditorLayer[] {
  const at = indexOfLayer(layers, id);
  const source = layers[at];
  if (source === undefined) return layers;
  const copy: EditorLayer = {
    ...source,
    id: newId,
    name: `${source.name} copy`,
    buffer: cloneRgbaBuffer(source.buffer),
  };
  return [...layers.slice(0, at + 1), copy, ...layers.slice(at + 1)];
}

/** Remove a layer; the last remaining layer can never be removed. */
export function removeLayer(layers: readonly EditorLayer[], id: string): readonly EditorLayer[] {
  if (layers.length <= 1) return layers;
  const at = indexOfLayer(layers, id);
  if (at < 0) return layers;
  return [...layers.slice(0, at), ...layers.slice(at + 1)];
}

/** Move a layer one step up (+1, toward the top) or down (-1). */
export function moveLayer(
  layers: readonly EditorLayer[],
  id: string,
  direction: 1 | -1,
): readonly EditorLayer[] {
  const at = indexOfLayer(layers, id);
  const to = at + direction;
  if (at < 0 || to < 0 || to >= layers.length) return layers;
  const next = [...layers];
  const moved = next[at];
  const displaced = next[to];
  if (moved === undefined || displaced === undefined) return layers;
  next[to] = moved;
  next[at] = displaced;
  return next;
}

/**
 * Merge a layer into the one below it (composited with its blend and
 * opacity); the merged layer keeps the LOWER layer's identity and settings.
 */
export function mergeDown(layers: readonly EditorLayer[], id: string): readonly EditorLayer[] {
  const at = indexOfLayer(layers, id);
  const upper = layers[at];
  const lower = layers[at - 1];
  if (upper === undefined || lower === undefined) return layers;
  const merged = cloneRgbaBuffer(lower.buffer);
  compositeLayersInPlace(merged, [upper]);
  return [...layers.slice(0, at - 1), { ...lower, buffer: merged }, ...layers.slice(at + 1)];
}

export function setLayerProps(
  layers: readonly EditorLayer[],
  id: string,
  props: Partial<Pick<EditorLayer, 'name' | 'isVisible' | 'opacity' | 'blend'>>,
): readonly EditorLayer[] {
  return layers.map((layer) => (layer.id === id ? { ...layer, ...props } : layer));
}
