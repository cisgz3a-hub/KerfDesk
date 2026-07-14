import { addLayer, type Layer, type Scene, updateLayer } from '../../core/scene';
import { recolorLayer } from '../../core/scene/scene';

export function applyLayerDraft(scene: Scene, draft: Layer): Scene {
  const existing = scene.layers.find((layer) => layer.id === draft.id);
  const colorOwner = scene.layers.find((layer) => layer.color === draft.color);
  if (existing === undefined) {
    return colorOwner === undefined ? addLayer(scene, { ...draft, id: draft.color }) : scene;
  }
  if (colorOwner !== undefined && colorOwner.id !== existing.id) return scene;
  const normalizedDraft = { ...draft, id: existing.id };
  if (JSON.stringify(existing) === JSON.stringify(normalizedDraft)) return scene;
  const recolored = recolorLayer(scene, existing.id, draft.color);
  const { id: _id, color: _color, ...patch } = normalizedDraft;
  return updateLayer(recolored, existing.id, patch);
}
