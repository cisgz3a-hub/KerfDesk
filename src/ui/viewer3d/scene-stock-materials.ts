// What the carved stock is made of (ADR-487), drawn in its shaders: the
// colour and shine of each material, worked out per pixel from where the
// pixel is in the block, so a cut shows what is under the surface. Wood has
// growth rings that a carving cuts across; MDF a darker skin over a paler
// core; acrylic a gloss top and frosted cuts; aluminium rolled plate with
// brighter, shinier machined faces; the two-colour laminate a thin cap over a core of
// the other colour, as engraving plastics are; flat grey shows only the
// shape; the height map colours each depth, from pale at the top to dark at
// the bottom. One shader serves them all, so changing material changes a
// uniform and nothing is rebuilt.

import type * as ThreeNamespace from 'three';
import type { Viewer3dLook } from './viewer3d-look';

export const STOCK_MATERIALS = [
  'wood',
  'mdf',
  'acrylic',
  'aluminium',
  'laminate',
  'grey',
  'height',
] as const;
export type StockMaterial = (typeof STOCK_MATERIALS)[number];

export const STOCK_MATERIAL_LABEL: Readonly<Record<StockMaterial, string>> = {
  wood: 'Wood',
  mdf: 'MDF',
  acrylic: 'Acrylic',
  aluminium: 'Aluminium',
  laminate: 'Two-colour laminate',
  grey: 'Flat grey',
  height: 'Height map',
};

type Shine = { readonly roughness: number; readonly metalness: number };

const SHINE: Readonly<Record<StockMaterial, Shine>> = {
  wood: { roughness: 0.78, metalness: 0 },
  mdf: { roughness: 0.9, metalness: 0 },
  acrylic: { roughness: 0.08, metalness: 0 },
  aluminium: { roughness: 0.34, metalness: 1 },
  laminate: { roughness: 0.45, metalness: 0 },
  grey: { roughness: 0.7, metalness: 0 },
  height: { roughness: 0.75, metalness: 0 },
};

// Studio's key light and environment are brighter than Classic's rig.
const STUDIO_GAIN = 0.78;
// Classic has no environment for metal to reflect: it would draw black.
const CLASSIC_METAL = 0.35;

/** The uniforms both the stock's top and its sides read. */
export type StockUniforms = {
  readonly stockKind: { value: number };
  readonly stockBottom: { value: number };
  readonly stockGain: { value: number };
};

export function createStockUniforms(bottomZ: number): StockUniforms {
  return { stockKind: { value: 0 }, stockBottom: { value: bottomZ }, stockGain: { value: 1 } };
}

/** Puts the material and look into the uniforms and the materials' shine. */
export function applyStockMaterial(
  uniforms: StockUniforms,
  materials: ReadonlyArray<ThreeNamespace.MeshStandardMaterial>,
  material: StockMaterial,
  look: Viewer3dLook,
): void {
  const shine = SHINE[material];
  uniforms.stockKind.value = STOCK_MATERIALS.indexOf(material);
  uniforms.stockGain.value = look === 'studio' ? STUDIO_GAIN : 1;
  for (const each of materials) {
    each.roughness = shine.roughness;
    each.metalness = shine.metalness * (look === 'studio' ? 1 : CLASSIC_METAL);
  }
}

/** Passes each vertex's place in the block on to the fragment shader. */
export function stockVertexChunks(source: string): string {
  return `varying vec3 vStockPoint;
${source}`.replace(
    '#include <project_vertex>',
    `vStockPoint = transformed;
#include <project_vertex>`,
  );
}

/** Colours and shines each pixel as the material is there. */
export function stockFragmentChunks(source: string): string {
  return `${STOCK_FUNCTIONS}
${source}`
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
diffuseColor.rgb = stockColour(vStockPoint) * stockGain;`,
    )
    .replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
roughnessFactor = stockRoughness(vStockPoint, roughnessFactor);`,
    );
}

// Colours are linear. Lengths are millimetres.
const STOCK_FUNCTIONS = `uniform int stockKind;
uniform float stockBottom;
uniform float stockGain;
varying vec3 vStockPoint;
float stockHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float stockNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(stockHash(i), stockHash(i + vec3(1, 0, 0)), f.x),
        mix(stockHash(i + vec3(0, 1, 0)), stockHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(stockHash(i + vec3(0, 0, 1)), stockHash(i + vec3(1, 0, 1)), f.x),
        mix(stockHash(i + vec3(0, 1, 1)), stockHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
bool stockCut(vec3 p) { return p.z < -0.02; }
vec3 stockWood(vec3 p) {
  // Growth rings round a trunk along X, below and behind the board.
  float radius = length(vec2(p.y + 140.0, (p.z + 60.0) * 2.5));
  radius += 3.0 * stockNoise(p * vec3(0.02, 0.15, 0.15));
  float ring = fract(radius / 2.4);
  float late = smoothstep(0.6, 0.82, ring) * (1.0 - smoothstep(0.9, 1.0, ring));
  vec3 colour = mix(vec3(0.70, 0.46, 0.23), vec3(0.43, 0.24, 0.10), late);
  return colour * (0.93 + 0.07 * stockNoise(p * vec3(0.1, 5.0, 5.0)));
}
vec3 stockMdf(vec3 p) {
  vec3 colour = p.z > -0.4 ? vec3(0.40, 0.23, 0.11) : vec3(0.56, 0.36, 0.19);
  return colour * (0.95 + 0.1 * stockNoise(p * 9.0));
}
vec3 stockAluminium(vec3 p) {
  if (stockCut(p)) return vec3(0.80, 0.81, 0.82);
  // Rolled plate: faint streaks along X.
  return vec3(0.56, 0.57, 0.59) * (0.9 + 0.1 * stockNoise(p * vec3(0.04, 14.0, 1.0)));
}
vec3 stockHeight(vec3 p) {
  float t = clamp(p.z / min(stockBottom, -1e-3), 0.0, 1.0);
  vec3 top = vec3(0.92, 0.86, 0.60);
  vec3 upper = vec3(0.30, 0.66, 0.36);
  vec3 lower = vec3(0.08, 0.36, 0.62);
  vec3 bottom = vec3(0.04, 0.06, 0.24);
  if (t < 0.33) return mix(top, upper, t / 0.33);
  if (t < 0.66) return mix(upper, lower, (t - 0.33) / 0.33);
  return mix(lower, bottom, (t - 0.66) / 0.34);
}
vec3 stockColour(vec3 p) {
  if (stockKind == 0) return stockWood(p);
  if (stockKind == 1) return stockMdf(p);
  if (stockKind == 2) return stockCut(p) ? vec3(0.62, 0.72, 0.80) : vec3(0.18, 0.40, 0.64);
  if (stockKind == 3) return stockAluminium(p);
  if (stockKind == 4) return p.z > -0.2 ? vec3(0.02, 0.02, 0.025) : vec3(0.80, 0.80, 0.77);
  if (stockKind == 5) return vec3(0.42);
  return stockHeight(p);
}
float stockRoughness(vec3 p, float roughness) {
  if (stockKind == 2) return stockCut(p) ? 0.62 : roughness;
  if (stockKind == 3) return stockCut(p) ? 0.2 : roughness;
  return roughness;
}
`;
