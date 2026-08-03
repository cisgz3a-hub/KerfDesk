import * as three from 'three';
import { describe, expect, it } from 'vitest';
import type { RemovalGrid } from '../../core/sim';
import { materialAppearance } from '../theme/material-appearance';
import { woodGrainFor } from '../theme/wood-grain-appearance';
import { createCarvedWoodMaterial } from './viewer3d-wood-material';
import { WOOD_REQUIRED_CHUNKS } from './viewer3d-wood-shader';

// z <= 0 by RemovalGrid's contract; the texture must publish +depth.
function grid(): RemovalGrid {
  return {
    widthCells: 2,
    heightCells: 2,
    mmPerCell: 1,
    originX: 0,
    originY: 0,
    depth: new Float32Array([0, -1, -2.5, 0]),
  };
}

function woodMaterial() {
  const grain = woodGrainFor(undefined);
  if (grain === null) throw new Error('Custom stock must have a grain');
  return createCarvedWoodMaterial(three, {
    appearance: materialAppearance(undefined),
    grain,
    grid: grid(),
    widthMm: 20,
    heightMm: 10,
  });
}

// A stand-in for what three hands onBeforeCompile, built from the REAL shader
// library so a chunk rename in a three upgrade fails here.
function standardShader() {
  return {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: three.ShaderLib.standard.vertexShader,
    fragmentShader: three.ShaderLib.standard.fragmentShader,
  };
}

describe('createCarvedWoodMaterial', () => {
  it('injects the grain and occlusion shader into MeshStandardMaterial', () => {
    const wood = woodMaterial();
    expect(wood.injected).toBe(false);
    const shader = standardShader();
    wood.material.onBeforeCompile(shader as never, null as never);

    expect(wood.injected).toBe(true);
    expect(shader.vertexShader).toContain('vCarveLocal = transformed;');
    expect(shader.fragmentShader).toContain('carveWoodAlbedo');
    expect(shader.fragmentShader).toContain('reflectedLight.directDiffuse *= carveShadowValue;');
    wood.dispose();
  });

  it('publishes the removal grid as positive depth in millimetres', () => {
    const wood = woodMaterial();
    const shader = standardShader();
    wood.material.onBeforeCompile(shader as never, null as never);

    const texture = shader.uniforms.uCarveDepth?.value as three.DataTexture;
    const data = texture.image.data as Uint16Array;
    expect([...data].map((h) => three.DataUtils.fromHalfFloat(h))).toEqual([0, 1, 2.5, 0]);
    expect(texture.image.width).toBe(2);
    expect(texture.image.height).toBe(2);
    wood.dispose();
  });

  it('sizes the shader to the mesh, not to the grid cell count', () => {
    const wood = woodMaterial();
    const shader = standardShader();
    wood.material.onBeforeCompile(shader as never, null as never);

    const size = shader.uniforms.uCarveSizeMm?.value as three.Vector2;
    expect([size.x, size.y]).toEqual([20, 10]);
    wood.dispose();
  });

  // The whole point of checking every replacement: a three upgrade that renames
  // a chunk must lose the grain, not fail to compile and blank the pane.
  it.each(WOOD_REQUIRED_CHUNKS)('leaves the surface renderable when %s is gone', (chunk) => {
    const wood = woodMaterial();
    const shader = standardShader();
    shader.vertexShader = shader.vertexShader.replace(chunk, '');
    shader.fragmentShader = shader.fragmentShader.replace(chunk, '');
    wood.material.onBeforeCompile(shader as never, null as never);

    expect(wood.injected).toBe(false);
    expect(shader.fragmentShader).not.toContain('carveWoodAlbedo');
    expect(shader.uniforms.uCarveDepth).toBeUndefined();
    wood.dispose();
  });

  it('every chunk it depends on is present in this three version', () => {
    const source = three.ShaderLib.standard.vertexShader + three.ShaderLib.standard.fragmentShader;
    for (const chunk of WOOD_REQUIRED_CHUNKS) expect(source).toContain(chunk);
  });
});
