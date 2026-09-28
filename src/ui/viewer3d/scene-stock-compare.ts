// The carved stock compared with the design (ADR-487): where the design says
// how deep a cell should be, the stock's top is coloured by how far the
// carving is from it. Within the tolerance it is green; material left above
// the design is blue, deeper blue the more is left; a cut below the design is
// red, darker the deeper the gouge. Cells with no design to compare with keep
// the material's colours. The colours are matte and not metal, so aluminium
// shows them as plainly as wood.

import type * as ThreeNamespace from 'three';

export type StockCompareUniforms = {
  /** The depth the design wants in each cell; above Z0 where there is none. */
  readonly stockTarget: { value: ThreeNamespace.Texture };
  /** 1 while comparing. */
  readonly stockCompare: { value: number };
  readonly stockTolerance: { value: number };
};

export function createCompareUniforms(target: ThreeNamespace.Texture): StockCompareUniforms {
  return {
    stockTarget: { value: target },
    stockCompare: { value: 0 },
    stockTolerance: { value: 0 },
  };
}

/**
 * Colours the top's pixels against the design, after the material has
 * coloured them and before three reads the colour and shine.
 */
export function stockCompareFragment(source: string): string {
  return `${COMPARE_FUNCTIONS}
${source}`
    .replace(
      '#include <alphamap_fragment>',
      `bool stockComparing = false;
if (stockCompare == 1) {
  ivec2 stockSize = textureSize(stockTarget, 0);
  ivec2 stockHere = clamp(ivec2(round(vStockUv * vec2(stockSize - 1))), ivec2(0), stockSize - 1);
  float stockWant = texelFetch(stockTarget, stockHere, 0).r;
  if (stockWant <= 0.0) {
    float stockGot = texelFetch(stockDepth, stockHere, 0).r;
    diffuseColor.rgb = stockCompareColour(stockGot - stockWant) * stockGain;
    stockComparing = true;
  }
}
#include <alphamap_fragment>`,
    )
    .replace(
      '#include <metalnessmap_fragment>',
      `#include <metalnessmap_fragment>
if (stockComparing) {
  roughnessFactor = 0.6;
  metalnessFactor = 0.0;
}`,
    );
}

// Colours are linear. `off` is the carving's depth less the design's: above
// the design it is positive.
// The depths and the pixel's place on them are the top's (scene-stock.ts).
const COMPARE_FUNCTIONS = `uniform sampler2D stockTarget;
uniform int stockCompare;
uniform float stockTolerance;
vec3 stockCompareColour(float off) {
  if (off > stockTolerance) {
    float more = clamp((off - stockTolerance) / 2.0, 0.0, 1.0);
    return mix(vec3(0.30, 0.55, 0.95), vec3(0.03, 0.12, 0.62), more);
  }
  if (off < -stockTolerance) {
    float deeper = clamp((-off - stockTolerance) / 1.0, 0.0, 1.0);
    return mix(vec3(0.95, 0.30, 0.24), vec3(0.55, 0.01, 0.01), deeper);
  }
  return vec3(0.16, 0.62, 0.24);
}
`;
