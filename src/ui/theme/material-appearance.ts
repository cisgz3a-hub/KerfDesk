// material-appearance — how each stock material looks in the previews.
//
// The stock material is already chosen once per job in the Material & Bit
// panel (ADR-112, CncStock.materialKey), but both previews drew every job as
// the same brown board. Acrylic looking like walnut is a small lie that costs
// the operator a beat every time they check they loaded the right stock.
//
// One table serves BOTH previews: the 3D viewport takes the packed numbers,
// the 2D depth map takes the same colours as RGB triples. viewer3d-theme.ts
// notes that the two must not "tell the operator different stories about the
// same cut", and sharing this table is what keeps that true.
//
// PURE: a key in, constants out. No three import, so the Canvas2D path and the
// WebGL path can both use it.

import { CHIPLOAD_MATERIALS, type ChiploadMaterial } from '../../core/cnc';

export type MaterialAppearance = {
  // Stock top, and full depth. The ramp between them is the depth cue.
  readonly shallow: number;
  readonly deep: number;
  // The same two colours as 0-255 triples, for the Canvas2D depth map.
  readonly shallowRgb: readonly [number, number, number];
  readonly deepRgb: readonly [number, number, number];
  // MeshStandardMaterial parameters. Metal is the only one of these that is
  // actually metallic; the rest stay dielectric or they render as chrome.
  readonly roughness: number;
  readonly metalness: number;
};

function appearance(
  shallowRgb: readonly [number, number, number],
  deepRgb: readonly [number, number, number],
  roughness: number,
  metalness: number,
): MaterialAppearance {
  return {
    shallow: packRgb(shallowRgb),
    deep: packRgb(deepRgb),
    shallowRgb,
    deepRgb,
    roughness,
    metalness,
  };
}

function packRgb(rgb: readonly [number, number, number]): number {
  return (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
}

// Machined timber is matte; cast acrylic is glossy; milled aluminium is bright
// and metallic but carries fine tooling marks, so it gets metalness without a
// mirror roughness.
const APPEARANCE_BY_MATERIAL = {
  softwood: appearance([216, 183, 132], [138, 98, 52], 0.85, 0),
  hardwood: appearance([176, 122, 68], [74, 44, 18], 0.8, 0),
  'plywood-mdf': appearance([214, 191, 154], [122, 103, 70], 0.9, 0),
  acrylic: appearance([150, 214, 232], [24, 92, 116], 0.25, 0),
  aluminum: appearance([207, 212, 216], [82, 90, 98], 0.35, 0.85),
};

// No project material ("Custom") keeps the palette both previews already
// shipped with, so an unconfigured job looks exactly as it did before.
const DEFAULT_APPEARANCE = appearance([196, 160, 116], [74, 48, 28], 0.85, 0);

/**
 * Looks up how a stock material should be shaded.
 *
 * @param key The job's ChiploadMaterial key, or undefined for "Custom".
 * @returns Colours and PBR parameters for that stock.
 */
export function materialAppearance(key: ChiploadMaterial | undefined): MaterialAppearance {
  if (key === undefined) return DEFAULT_APPEARANCE;
  const family = CHIPLOAD_MATERIALS.find((material) => material.value === key)?.family;
  return family === undefined ? DEFAULT_APPEARANCE : APPEARANCE_BY_MATERIAL[family];
}
