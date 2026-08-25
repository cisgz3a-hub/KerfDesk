// viewer3d-wood-material — the machined-timber surface material (ADR-284).
//
// Built by INJECTING into MeshStandardMaterial rather than replacing it with a
// ShaderMaterial: the pane's lights, tone mapping and colour management keep
// working, and a job whose stock is not timber falls back to the original
// vertex-coloured material with no branch in the scene code.
//
// Injection couples to three.js chunk names, which move between releases, so
// every replacement is checked and the material degrades to plain PBR instead
// of failing to compile. `injected` reports which way it went so a test can
// catch a three upgrade that silently drops the grain.

import type * as ThreeNamespace from 'three';
import type { MeshStandardMaterial } from 'three';
import type { RemovalGrid } from '../../core/sim';
import type { MaterialAppearance } from '../theme/material-appearance';
import type { GrainAppearance } from '../theme/wood-grain-appearance';
import { carveDepthTexturePartialAxes } from './viewer3d-depth-texture-coordinate';
import { buildCarveDepthTexture } from './viewer3d-height-texture';
import {
  WOOD_ALBEDO_BODY_GLSL,
  WOOD_FUNCTIONS_GLSL,
  WOOD_LIGHTING_BODY_GLSL,
  WOOD_NORMAL_BODY_GLSL,
  WOOD_ROUGHNESS_BODY_GLSL,
  WOOD_UNIFORMS_GLSL,
  WOOD_VARYING_GLSL,
  WOOD_VERTEX_BODY_GLSL,
} from './viewer3d-wood-shader';

type ThreeModule = typeof ThreeNamespace;

export type CarvedWoodInput = {
  readonly appearance: MaterialAppearance;
  readonly grain: GrainAppearance;
  readonly grid: RemovalGrid;
  readonly widthMm: number;
  readonly heightMm: number;
};

export type CarvedWoodMaterial = {
  readonly material: MeshStandardMaterial;
  // False when a three.js upgrade renamed a chunk; the surface still renders.
  readonly injected: boolean;
  readonly dispose: () => void;
};

// Places the log's axis below the stock and off-centre, so rings arch across
// the board like flat-sawn timber and shift visibly as a groove cuts down
// through them. Centred would give a mirror-symmetric pattern that reads as
// procedural.
const LOG_CENTRE_Y_FRACTION = 0.18;
const LOG_CENTRE_Z_MM = -45;
const AO_AMOUNT = 0.85;
const SHADOW_AMOUNT = 0.8;

function appendAfter(source: string, marker: string, addition: string): string | null {
  if (!source.includes(marker)) return null;
  return source.replace(marker, marker + addition);
}

function carveGridUniforms(three: ThreeModule, grid: RemovalGrid) {
  const partialAxes = carveDepthTexturePartialAxes(grid);
  return {
    cells: new three.Vector2(grid.widthCells, grid.heightCells),
    partialAxes: new three.Vector2(partialAxes.x, partialAxes.y),
  };
}

function carveLightDirection(three: ThreeModule, widthMm: number, heightMm: number) {
  return new three.Vector3(widthMm, -heightMm, Math.max(widthMm, heightMm)).normalize();
}

/**
 * Creates the carved-timber surface material for a removal grid.
 *
 * @param three The dynamically-imported three module.
 * @param input Stock appearance, grain parameters, and the grid the surface
 *   mesh was built from, with that mesh's extents in mm.
 * @returns The material, whether the shader injection succeeded, and a
 *   disposer that frees both the material and its depth texture.
 */
export function createCarvedWoodMaterial(
  three: ThreeModule,
  input: CarvedWoodInput,
): CarvedWoodMaterial {
  const { appearance, grain, grid, widthMm, heightMm } = input;
  const depth = buildCarveDepthTexture(three, grid);
  const gridUniforms = carveGridUniforms(three, grid);
  // THREE.Color applies ColorManagement's sRGB -> linear conversion. Feeding
  // the packed values in raw renders every species as the same pale tan.
  const early = new three.Color(appearance.shallow);
  const late = new three.Color(appearance.shallow).lerp(
    new three.Color(appearance.deep),
    grain.contrast,
  );
  const light = carveLightDirection(three, widthMm, heightMm);

  const material = new three.MeshStandardMaterial({
    vertexColors: false,
    side: three.DoubleSide,
    flatShading: false,
    roughness: appearance.roughness,
    metalness: appearance.metalness,
  });

  let injected = false;
  material.onBeforeCompile = (shader) => {
    const vertex = appendAfter(
      WOOD_VARYING_GLSL + shader.vertexShader,
      '#include <begin_vertex>',
      WOOD_VERTEX_BODY_GLSL,
    );
    const preamble = WOOD_VARYING_GLSL + WOOD_UNIFORMS_GLSL + WOOD_FUNCTIONS_GLSL;
    const withAlbedo = appendAfter(
      preamble + shader.fragmentShader,
      '#include <map_fragment>',
      WOOD_ALBEDO_BODY_GLSL,
    );
    const withNormal =
      withAlbedo === null
        ? null
        : appendAfter(withAlbedo, '#include <normal_fragment_begin>', WOOD_NORMAL_BODY_GLSL);
    const withRoughness =
      withNormal === null
        ? null
        : appendAfter(withNormal, '#include <roughnessmap_fragment>', WOOD_ROUGHNESS_BODY_GLSL);
    const fragment =
      withRoughness === null
        ? null
        : appendAfter(withRoughness, '#include <lights_fragment_end>', WOOD_LIGHTING_BODY_GLSL);
    if (vertex === null || fragment === null) return;

    shader.uniforms.uCarveDepth = { value: depth.texture };
    shader.uniforms.uCarveSizeMm = { value: new three.Vector2(widthMm, heightMm) };
    shader.uniforms.uCarveCellMm = { value: grid.mmPerCell };
    shader.uniforms.uCarveCells = { value: gridUniforms.cells };
    shader.uniforms.uCarveHasPartialCell = { value: gridUniforms.partialAxes };
    shader.uniforms.uCarveLightDir = { value: light };
    shader.uniforms.uGrainEarly = { value: early };
    shader.uniforms.uGrainLate = { value: late };
    shader.uniforms.uGrainLogCentre = {
      value: new three.Vector2(heightMm * LOG_CENTRE_Y_FRACTION, LOG_CENTRE_Z_MM),
    };
    shader.uniforms.uGrainRingFreq = { value: grain.ringFreq };
    shader.uniforms.uGrainSharp = { value: grain.sharp };
    shader.uniforms.uGrainWarp = { value: grain.warp };
    shader.uniforms.uGrainPore = { value: grain.pore };
    shader.uniforms.uGrainFresh = { value: grain.fresh };
    shader.uniforms.uCarveAoAmount = { value: AO_AMOUNT };
    shader.uniforms.uCarveShadowAmount = { value: SHADOW_AMOUNT };
    shader.vertexShader = vertex;
    shader.fragmentShader = fragment;
    injected = true;
  };
  // Without this three may hand the injected material a program compiled for a
  // plain MeshStandardMaterial with the same parameters.
  material.customProgramCacheKey = () => 'kerfdesk-carved-wood-partial-cell-v1';

  return {
    material,
    get injected() {
      return injected;
    },
    dispose: () => {
      material.dispose();
      depth.dispose();
    },
  };
}
