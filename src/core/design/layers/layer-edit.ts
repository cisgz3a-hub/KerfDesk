// layer-edit — pure carve-layer operations on a Sketch (ADR-272 Amendment 1,
// DS-8). Every function is pure and total, like sketch-edit: nothing mutates,
// nothing throws, and an edit that cannot apply returns the sketch unchanged.
//
// A sketch with no `layers` field behaves as if it had exactly the default
// layer, so every sketch built before layers existed keeps working; the field
// materializes on the first layer edit.

import type { Sketch, SketchEntity } from '../sketch-entity';
import { DEFAULT_DESIGN_LAYER, type DesignCutType, type DesignLayer } from './design-layer';

// Field-wise layer patch. `null` on a bit field CLEARS it (back to the
// machine's active bit / single-stage v-carve); `undefined` leaves it alone —
// the distinction exactOptionalPropertyTypes exists to keep honest.
export type DesignLayerPatch = {
  readonly name?: string;
  readonly color?: string;
  readonly cutType?: DesignCutType;
  readonly depthMm?: number;
  readonly toolId?: string | null;
  readonly vClearToolId?: string | null;
};

/** The sketch's layer list; never empty (absent = the default layer). */
export function sketchLayers(sketch: Sketch): ReadonlyArray<DesignLayer> {
  const layers = sketch.layers;
  return layers === undefined || layers.length === 0 ? [DEFAULT_DESIGN_LAYER] : layers;
}

/** The layer this entity belongs to; an unknown or absent id means the first layer. */
export function entityDesignLayer(
  entity: SketchEntity,
  layers: ReadonlyArray<DesignLayer>,
): DesignLayer {
  const first = layers[0] ?? DEFAULT_DESIGN_LAYER;
  if (entity.layerId === undefined) return first;
  return layers.find((layer) => layer.id === entity.layerId) ?? first;
}

/** Appends a layer; a duplicate id returns the sketch unchanged. */
export function addDesignLayer(sketch: Sketch, layer: DesignLayer): Sketch {
  const layers = sketchLayers(sketch);
  if (layers.some((existing) => existing.id === layer.id)) return sketch;
  return { ...sketch, layers: [...layers, layer] };
}

/**
 * Patches one layer's editable settings. Non-finite or non-positive depths are
 * ignored field-wise; an unknown id returns the sketch unchanged.
 */
export function patchDesignLayer(sketch: Sketch, layerId: string, patch: DesignLayerPatch): Sketch {
  const layers = sketchLayers(sketch);
  const index = layers.findIndex((layer) => layer.id === layerId);
  const current = layers[index];
  if (current === undefined) return sketch;
  const next = patchedLayer(current, patch);
  const updated = layers.map((layer, at) => (at === index ? next : layer));
  return { ...sketch, layers: updated };
}

function patchedLayer(current: DesignLayer, patch: DesignLayerPatch): DesignLayer {
  const depthOk =
    patch.depthMm !== undefined && Number.isFinite(patch.depthMm) && patch.depthMm > 0;
  const toolId = patchedToolId(current.toolId, patch.toolId);
  const vClearToolId = patchedToolId(current.vClearToolId, patch.vClearToolId);
  return {
    id: current.id,
    name: patch.name ?? current.name,
    color: patch.color ?? current.color,
    cutType: patch.cutType ?? current.cutType,
    depthMm: depthOk ? patch.depthMm : current.depthMm,
    ...(toolId === undefined ? {} : { toolId }),
    ...(vClearToolId === undefined ? {} : { vClearToolId }),
  };
}

// undefined = leave alone, null = clear, string = set.
function patchedToolId(
  current: string | undefined,
  patch: string | null | undefined,
): string | undefined {
  if (patch === undefined) return current;
  return patch ?? undefined;
}

/**
 * Removes a layer and re-homes its entities to the first remaining layer.
 * The last layer cannot be removed (a sketch always has one).
 */
export function removeDesignLayer(sketch: Sketch, layerId: string): Sketch {
  const layers = sketchLayers(sketch);
  if (layers.length <= 1) return sketch;
  const remaining = layers.filter((layer) => layer.id !== layerId);
  if (remaining.length === layers.length) return sketch;
  const fallback = remaining[0];
  if (fallback === undefined) return sketch;
  const entities = sketch.entities.map((entity) =>
    entity.layerId === layerId ? { ...entity, layerId: fallback.id } : entity,
  );
  return { ...sketch, entities, layers: remaining };
}

/** Swaps a layer one step toward the front (up) or back (down) of the list. */
export function moveDesignLayer(sketch: Sketch, layerId: string, direction: 'up' | 'down'): Sketch {
  const layers = sketchLayers(sketch);
  const from = layers.findIndex((layer) => layer.id === layerId);
  if (from < 0) return sketch;
  const to = direction === 'up' ? from - 1 : from + 1;
  const source = layers[from];
  const target = layers[to];
  if (source === undefined || target === undefined) return sketch;
  const next = layers.map((layer, at) => (at === from ? target : at === to ? source : layer));
  return { ...sketch, layers: next };
}

/** Stamps the given entities onto a layer; unknown layer ids apply nothing. */
export function assignEntitiesToLayer(
  sketch: Sketch,
  entityIds: ReadonlySet<string>,
  layerId: string,
): Sketch {
  const layers = sketchLayers(sketch);
  if (!layers.some((layer) => layer.id === layerId)) return sketch;
  if (entityIds.size === 0) return sketch;
  const entities = sketch.entities.map((entity) =>
    entityIds.has(entity.id) && entity.layerId !== layerId ? { ...entity, layerId } : entity,
  );
  return { ...sketch, entities, layers };
}
