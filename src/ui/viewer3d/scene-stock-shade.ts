// Shadows and occlusion on the carved stock's top (ADR-487). The top is a
// height field, so the shader finds both from the same depth texture the
// carving fills, with no shadow map: a pixel steps across the cells towards
// the key light, and the light it gets falls off softly the nearer the ray
// passes under a cell that stands higher. The ambient light a pixel gets
// falls with how much of the stock around it stands above it, eight ways at
// two reaches. Pocket floors take the walls' shadows, and the bottoms of
// grooves and the feet of walls darken.
//
// The key is Classic's own key light or Studio's sun. The shadow darkens all
// the direct light, the rim light's too, which is weak beside the key. The
// uncut top has nothing above it, so it skips both.

import { SUN_DIRECTION } from './studio-stage';
import type { Viewer3dLook } from './viewer3d-look';

/** Towards the key light the stock brings to Classic (scene-stock.ts). */
export const CLASSIC_KEY_DIRECTION = [-0.5, -0.8, 1] as const;

export type StockShadeUniforms = {
  /** 1 while shading. */
  readonly stockShade: { value: number };
  /** Towards the key light, of unit length. */
  readonly stockLight: { value: [number, number, number] };
};

export function createShadeUniforms(): StockShadeUniforms {
  return { stockShade: { value: 1 }, stockLight: { value: towards(CLASSIC_KEY_DIRECTION) } };
}

export function applyStockShade(
  uniforms: StockShadeUniforms,
  shaded: boolean,
  look: Viewer3dLook,
): void {
  uniforms.stockShade.value = shaded ? 1 : 0;
  uniforms.stockLight.value = towards(look === 'studio' ? SUN_DIRECTION : CLASSIC_KEY_DIRECTION);
}

function towards(direction: readonly [number, number, number]): [number, number, number] {
  const length = Math.hypot(...direction);
  return [direction[0] / length, direction[1] / length, direction[2] / length];
}

/**
 * Shades the top's light once three has summed it. Needs the depth texture,
 * its cell size, the pixel's place on it and its depth declared before it
 * (scene-stock.ts), and the stock's bottom (scene-stock-materials.ts).
 */
export function stockShadeFragment(source: string): string {
  return `${SHADE_FUNCTIONS}
${source}`.replace(
    '#include <lights_fragment_end>',
    `#include <lights_fragment_end>
if (stockShade == 1) {
  float stockHeight0 = max(vStockDepth, stockBottom);
  vec2 stockAt = vStockUv * vec2(textureSize(stockDepth, 0) - 1);
  float stockLit = stockShadow(stockAt, stockHeight0);
  float stockOpen = stockOcclusion(stockAt, stockHeight0);
  reflectedLight.directDiffuse *= stockLit;
  reflectedLight.directSpecular *= stockLit;
  reflectedLight.indirectDiffuse *= stockOpen;
  reflectedLight.indirectSpecular *= stockOpen;
}`,
  );
}

// Heights are in millimetres, places in cells; the cells are square.
// SOFTNESS sets the penumbra: full light once the ray clears the stock by a
// quarter of a millimetre in every six across. The ray starts a cell out and
// a cell up, so a slope does not shadow itself between cell centres.
const SHADE_FUNCTIONS = `uniform int stockShade;
uniform vec3 stockLight;
const int STOCK_SHADOW_STEPS = 40;
const float STOCK_SOFTNESS = 6.0;
const float STOCK_OCCLUSION_MM = 1.0;
const float STOCK_OCCLUSION = 0.7;
float stockShadow(vec2 here, float height) {
  float run = length(stockLight.xy);
  if (height >= -1e-4 || run < 1e-4) return 1.0;
  vec2 across = stockLight.xy / run;
  float rise = stockLight.z / run;
  ivec2 size = textureSize(stockDepth, 0);
  // Past this reach the ray is above the stock's top.
  float reach = -height / rise;
  float lit = 1.0;
  for (int i = 1; i <= STOCK_SHADOW_STEPS; i++) {
    float mm = stockCell + reach * float(i) / float(STOCK_SHADOW_STEPS);
    ivec2 cell = ivec2(round(here + across * (mm / stockCell)));
    if (any(lessThan(cell, ivec2(0))) || any(greaterThanEqual(cell, size))) break;
    float clear = height + stockCell + rise * mm - texelFetch(stockDepth, cell, 0).r;
    lit = min(lit, clamp(STOCK_SOFTNESS * clear / mm, 0.0, 1.0));
    if (lit <= 0.0) break;
  }
  return lit;
}
float stockOcclusion(vec2 here, float height) {
  if (height >= -1e-4) return 1.0;
  ivec2 size = textureSize(stockDepth, 0);
  float closed = 0.0;
  for (int ring = 1; ring <= 2; ring++) {
    float mm = STOCK_OCCLUSION_MM * float(ring * 2 - 1);
    float cells = max(mm / stockCell, 1.0);
    for (int way = 0; way < 8; way++) {
      float angle = (float(way) + 0.5 * float(ring - 1)) * 0.7853982;
      ivec2 cell = ivec2(round(here + vec2(cos(angle), sin(angle)) * cells));
      float above = texelFetch(stockDepth, clamp(cell, ivec2(0), size - 1), 0).r - height;
      closed += clamp(above / mm, 0.0, 1.0);
    }
  }
  return 1.0 - STOCK_OCCLUSION * closed / 16.0;
}
`;
