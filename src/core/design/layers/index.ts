// core/design/layers — the carve-layer model behind DS-8 (ADR-271 Amendment 1).
// Its own sub-barrel for the same reason snap/ and ops/ have one: the
// core/design barrel is one symbol short of the ADR-015 cap.

export {
  DEFAULT_DESIGN_LAYER,
  DEFAULT_DESIGN_LAYER_ID,
  DESIGN_CUT_TYPES,
  createDesignLayer,
  designLayerColor,
  type DesignCutType,
  type DesignLayer,
} from './design-layer';
export {
  addDesignLayer,
  assignEntitiesToLayer,
  entityDesignLayer,
  moveDesignLayer,
  patchDesignLayer,
  removeDesignLayer,
  sketchLayers,
} from './layer-edit';
