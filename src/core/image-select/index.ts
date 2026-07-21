// Image Studio selection core (Phase L, ADR-242) — the "change selected
// areas" half of IE-1: alpha selection masks, marquee/lasso/wand builders,
// marching-ants boundary extraction, and the fill/extract/blit region ops
// the UI composes into delete, fill, and move.

export type { SelectionMask } from './selection-mask';
export { invertMask, isMaskEmpty, maskBounds, selectAllMask } from './selection-mask';

export { ellipseSelection, rectSelection } from './marquee';
export { polygonSelection } from './lasso';

export type { SelectionCombineMode } from './combine-masks';
export { combineMasks } from './combine-masks';
export { borderMask, contractMask, expandMask, featherMask, smoothMask } from './mask-morphology';

export { wandSelection } from './wand';
export { maskOutline } from './mask-outline';
export { blitFloatingInPlace, extractFloatingRegion, fillMaskedInPlace } from './region-ops';
