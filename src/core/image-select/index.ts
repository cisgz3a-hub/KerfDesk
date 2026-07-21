// Image Studio selection core (Phase L, ADR-242) — the "change selected
// areas" half of IE-1: alpha selection masks, marquee/lasso/wand builders,
// marching-ants boundary extraction, and the fill/extract/blit region ops
// the UI composes into delete, fill, and move.

export type { SelectionMask } from './selection-mask';
export { invertMask, isMaskEmpty, MASK_SOLID, maskBounds, selectAllMask } from './selection-mask';

export { ellipseSelection, rectSelection } from './marquee';
export { polygonSelection } from './lasso';

export type { WandOptions } from './wand';
export { wandSelection } from './wand';

export type { OutlinePoint } from './mask-outline';
export { maskOutline } from './mask-outline';

export type { FloatingRegion } from './region-ops';
export { blitFloatingInPlace, extractFloatingRegion, fillMaskedInPlace } from './region-ops';
