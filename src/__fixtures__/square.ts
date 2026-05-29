// Shared geometry fixture for fill-hatching tests.
//
// Returns a closed axis-aligned square Polyline. Used by both the
// correctness suite (fill-hatching.test.ts) and the performance regression
// suite (fill-hatching.perf.test.ts), so it lives here rather than being
// duplicated. Test-only helper: under src/__fixtures__ (boundary- and
// coverage-exempt per eslint.config.mjs). Pure and deterministic.

import type { Polyline } from '../core/scene';

export function square(side: number, originX = 0, originY = 0): Polyline {
  return {
    closed: true,
    points: [
      { x: originX, y: originY },
      { x: originX + side, y: originY },
      { x: originX + side, y: originY + side },
      { x: originX, y: originY + side },
    ],
  };
}
