// viewer3d-height-texture — uploads a RemovalGrid as a sampleable depth field
// so the surface shader can march it for self-shadowing and ambient occlusion
// (ADR-284).
//
// Half float, not float: R16F is filterable in core WebGL2, whereas linear
// filtering of R32F needs OES_texture_float_linear and silently degrades to
// nearest on the machines that lack it — which shows up as stair-stepped
// shadow edges rather than as an error.
//
// The grid stores z (<= 0, removal-grid.ts:13); the texture stores POSITIVE
// depth in mm, because every consumer in the shader wants a magnitude.

import type * as ThreeNamespace from 'three';
import type { DataTexture } from 'three';
import type { RemovalGrid } from '../../core/sim';

type ThreeModule = typeof ThreeNamespace;

export type CarveDepthTexture = {
  readonly texture: DataTexture;
  readonly dispose: () => void;
};

/**
 * Uploads a removal grid as an R16F depth texture in millimetres.
 *
 * Must be given the SAME grid the surface mesh was built from — the pane
 * downsamples before meshing, and a full-resolution grid here would shade a
 * groove that sits somewhere else.
 *
 * @param three The dynamically-imported three module.
 * @param grid The removal grid the surface mesh was built from.
 * @returns The texture plus its disposer.
 */
export function buildCarveDepthTexture(three: ThreeModule, grid: RemovalGrid): CarveDepthTexture {
  const cells = grid.widthCells * grid.heightCells;
  const data = new Uint16Array(cells);
  for (let index = 0; index < cells; index += 1) {
    // Math.max, not Math.abs: a positive cell would mean material added, and
    // abs() would render that as a groove instead of as the flat it is.
    data[index] = three.DataUtils.toHalfFloat(Math.max(0, -(grid.depth[index] ?? 0)));
  }
  const texture = new three.DataTexture(
    data,
    grid.widthCells,
    grid.heightCells,
    three.RedFormat,
    three.HalfFloatType,
  );
  texture.minFilter = three.LinearFilter;
  texture.magFilter = three.LinearFilter;
  texture.wrapS = three.ClampToEdgeWrapping;
  texture.wrapT = three.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, dispose: () => texture.dispose() };
}
