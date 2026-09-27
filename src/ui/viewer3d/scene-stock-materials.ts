// What the carved stock is made of (ADR-487), drawn in its shaders: the
// colour and shine of each material, worked out per pixel from where the
// pixel is in the block, so a cut shows what is under the surface. Wood is
// Cut 3D's timber (ADR-284): growth rings round a log below the board, which
// a carving cuts across, in the colours and figure of the project's species;
// MDF a darker skin over a paler core; acrylic a gloss top and frosted cuts; aluminium rolled plate with
// brighter, shinier machined faces; the two-colour laminate a thin cap over a core of
// the other colour, as engraving plastics are; flat grey shows only the
// shape; the height map colours each depth, from pale at the top to dark at
// the bottom. One shader serves them all, so changing material changes a
// uniform and nothing is rebuilt.

import type * as ThreeNamespace from 'three';
import { isChiploadMaterialKey } from '../../core/cnc';
import { WOOD_GRAIN_GLSL } from '../cnc-viewer3d/viewer3d-wood-shader';
import { materialAppearance } from '../theme/material-appearance';
import { woodGrainFor, type GrainAppearance } from '../theme/wood-grain-appearance';
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

// Where Cut 3D puts the log the rings grow round: a little behind the
// board's middle and well below its top (viewer3d-wood-material.ts).
const LOG_BEHIND_FRACTION = 0.18;
const LOG_DEPTH_MM = -45;

type Vec3Value = [number, number, number];

/** The uniforms both the stock's top and its sides read. */
export type StockUniforms = {
  readonly stockKind: { value: number };
  readonly stockBottom: { value: number };
  readonly stockGain: { value: number };
  /** The block's middle in X and Y: the grain is worked out from it. */
  readonly stockCentre: { value: [number, number] };
  readonly uGrainEarly: { value: Vec3Value };
  readonly uGrainLate: { value: Vec3Value };
  readonly uGrainLogCentre: { value: [number, number] };
  readonly uGrainRingFreq: { value: number };
  readonly uGrainSharp: { value: number };
  readonly uGrainWarp: { value: number };
  readonly uGrainPore: { value: number };
  readonly uGrainFresh: { value: number };
};

/** The block the uniforms are for: its bottom, middle and depth front to back. */
export type StockBlock = {
  readonly bottomZ: number;
  readonly centreX: number;
  readonly centreY: number;
  readonly lengthY: number;
};

export function createStockUniforms(block: StockBlock): StockUniforms {
  return {
    stockKind: { value: 0 },
    stockBottom: { value: block.bottomZ },
    stockGain: { value: 1 },
    stockCentre: { value: [block.centreX, block.centreY] },
    uGrainEarly: { value: [0, 0, 0] },
    uGrainLate: { value: [0, 0, 0] },
    uGrainLogCentre: { value: [block.lengthY * LOG_BEHIND_FRACTION, LOG_DEPTH_MM] },
    uGrainRingFreq: { value: 0 },
    uGrainSharp: { value: 1 },
    uGrainWarp: { value: 0 },
    uGrainPore: { value: 0 },
    uGrainFresh: { value: 1 },
  };
}

/**
 * Puts the material and look into the uniforms and the materials' shine.
 * `materialKey` is the project's stock (a CNC material key): wood takes that
 * species' colours and grain, or Cut 3D's own timber without one.
 */
export function applyStockMaterial(
  uniforms: StockUniforms,
  materials: ReadonlyArray<ThreeNamespace.MeshStandardMaterial>,
  choice: { readonly material: StockMaterial; readonly materialKey?: string | undefined },
  look: Viewer3dLook,
): void {
  const { material } = choice;
  const shine = SHINE[material];
  uniforms.stockKind.value = STOCK_MATERIALS.indexOf(material);
  uniforms.stockGain.value = look === 'studio' ? STUDIO_GAIN : 1;
  applyGrain(uniforms, choice.materialKey);
  for (const each of materials) {
    each.roughness = shine.roughness;
    each.metalness = shine.metalness * (look === 'studio' ? 1 : CLASSIC_METAL);
  }
}

// A timber key gives its species; any other (acrylic, aluminium, none) the
// timber Cut 3D draws for a project without a material.
function applyGrain(uniforms: StockUniforms, materialKey: string | undefined): void {
  const key = isChiploadMaterialKey(materialKey) ? materialKey : undefined;
  const timber = key !== undefined && woodGrainFor(key) !== null ? key : undefined;
  const grain: GrainAppearance | null = woodGrainFor(timber);
  if (grain === null) return;
  const appearance = materialAppearance(timber);
  const early = linearRgb(appearance.shallowRgb);
  const deep = linearRgb(appearance.deepRgb);
  uniforms.uGrainEarly.value = early;
  uniforms.uGrainLate.value = [0, 1, 2].map(
    (at) => (early[at] ?? 0) + ((deep[at] ?? 0) - (early[at] ?? 0)) * grain.contrast,
  ) as Vec3Value;
  uniforms.uGrainRingFreq.value = grain.ringFreq;
  uniforms.uGrainSharp.value = grain.sharp;
  uniforms.uGrainWarp.value = grain.warp;
  uniforms.uGrainPore.value = grain.pore;
  uniforms.uGrainFresh.value = grain.fresh;
}

// The appearance table is in sRGB; the shader works in linear light, as
// three.Color converts it for Cut 3D.
function linearRgb(rgb: readonly [number, number, number]): Vec3Value {
  return rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Vec3Value;
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
uniform vec2 stockCentre;
uniform vec3 uGrainEarly;
uniform vec3 uGrainLate;
uniform vec2 uGrainLogCentre;
uniform float uGrainRingFreq;
uniform float uGrainSharp;
uniform float uGrainWarp;
uniform float uGrainPore;
uniform float uGrainFresh;
varying vec3 vStockPoint;
${WOOD_GRAIN_GLSL}
float stockWoodRough = 0.78;
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
// Cut 3D's timber, worked out from the block's middle, so the noise keeps its
// detail far from the machine's zero. A cut face is fresh fibre, lighter and
// rougher than the sanded top.
vec3 stockWood(vec3 p) {
  float rough;
  vec3 colour = carveWoodAlbedo(vec3(p.xy - stockCentre, p.z), rough);
  float cut = smoothstep(0.02, 0.45, -p.z);
  stockWoodRough = mix(rough * 0.72, min(0.95, rough * 1.25), cut);
  return mix(colour * 0.88, colour * uGrainFresh, cut);
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
  if (stockKind == 0) return stockWoodRough;
  if (stockKind == 2) return stockCut(p) ? 0.62 : roughness;
  if (stockKind == 3) return stockCut(p) ? 0.2 : roughness;
  return roughness;
}
`;
