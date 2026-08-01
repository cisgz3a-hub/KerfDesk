// Image Studio retouch core (ADR-246, V2 plan B) — the v2 paint surface:
// gradient fill now; clone stroke and masked-median spot heal join in B2.
// New module because all three original Studio barrels sit at the 20 cap.

export type { GradientSpec } from './gradient-fill';
export { fillGradientInPlace } from './gradient-fill';

export type { CloneStroke } from './clone-stroke';
export { cloneStrokeDirtyRect, cloneStrokeInPlace } from './clone-stroke';

export { healDirtyRect, healSpotInPlace } from './spot-heal';
