// Image Studio layers core (Phase L, ADR-245) — the small-layers reduction:
// doc-sized RGBA layers with normal/multiply blending, one composite path
// shared by the canvas preview and the Apply bake, and the pure list ops
// the Layers panel composes.

export type { EditorLayer, LayerBlend, LayerFill } from './layer';
export { createLayer, layerFromBuffer } from './layer';

export { compositeLayersInPlace } from './composite';

export {
  addLayerAbove,
  duplicateLayer,
  mergeDown,
  moveLayer,
  moveLayerTo,
  removeLayer,
  setLayerProps,
} from './layer-ops';
