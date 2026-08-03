// The one CNC cut type whose cost is not a function of its input size.
//
// Every other responsiveness gate in the app answers "is this expensive?" by
// counting input segments — raw vectors, estimated fill hatches, segments times
// depth passes. That model holds for profile, pocket and engrave, which trace
// the artwork roughly once per pass. V-carve breaks it: it resolves a medial
// axis and emits a dense variable-depth route, so the compiled program is
// unbounded in the input's segment count.
//
// Measured on the current engine (vcarveMedialPasses, ADR-285): 120 closed
// contours carrying 480 raw segments — 0.5% of the 100,000-segment budget —
// take ~1.5 s to prepare, and real glyph outlines carry far more points than
// that synthetic case. Selecting the V-carve cut type therefore sailed through
// every gate and compiled on the main thread, freezing the app.
//
// Routing only, never a refusal (rule 7): a scene reported here still compiles
// and emits in full on every path. It just does so off the main thread.

import { DEFAULT_CNC_LAYER_SETTINGS, type Scene } from '../scene';

/**
 * True when any output layer carves with a V-bit, meaning this scene's
 * preparation cost cannot be predicted from its geometry and must be treated
 * as over-budget by the responsiveness gates.
 */
export function sceneHasVCarveOutputLayer(scene: Scene): boolean {
  return scene.layers.some(
    (layer) => layer.output && (layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS).cutType === 'v-carve',
  );
}
