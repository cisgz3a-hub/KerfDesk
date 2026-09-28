import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createStockView } from './scene-stock';
import {
  applyStockShade,
  CLASSIC_KEY_DIRECTION,
  createShadeUniforms,
  stockShadeFragment,
} from './scene-stock-shade';
import { SUN_DIRECTION } from './studio-stage';

function unit(direction: readonly number[]): number[] {
  const length = Math.hypot(...direction);
  return direction.map((value) => value / length);
}

// The stock's top as three would compile it.
function topShader(): { readonly uniforms: Record<string, unknown>; readonly fragment: string } {
  const scene = new THREE.Scene();
  const view = createStockView(THREE, scene, new THREE.Group());
  view.set({
    originX: 0,
    originY: 0,
    mmPerCell: 0.5,
    columns: 4,
    rows: 3,
    depth: new Float32Array(12).fill(-1),
    bottomZ: -4,
  });
  let top: THREE.Mesh | undefined;
  scene.traverse((object) => {
    const material = (object as THREE.Mesh).material as THREE.Material | undefined;
    if (material?.customProgramCacheKey() === 'carved-stock-top') top = object as THREE.Mesh;
  });
  const material = top?.material as THREE.MeshStandardMaterial;
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  material.onBeforeCompile(shader as never, undefined as never);
  return { uniforms: shader.uniforms, fragment: shader.fragmentShader };
}

describe('carved stock shadows and occlusion (ADR-487)', () => {
  it('darkens the direct light by the shadow and the ambient by the occlusion, once three sums them', () => {
    const fragment = stockShadeFragment(THREE.ShaderLib.standard.fragmentShader);
    const summed = fragment.indexOf('#include <lights_fragment_end>');
    expect(fragment.indexOf('reflectedLight.directDiffuse *= stockLit')).toBeGreaterThan(summed);
    expect(fragment.indexOf('reflectedLight.directSpecular *= stockLit')).toBeGreaterThan(summed);
    expect(fragment.indexOf('reflectedLight.indirectDiffuse *= stockOpen')).toBeGreaterThan(summed);
    expect(fragment.indexOf('reflectedLight.indirectSpecular *= stockOpen')).toBeGreaterThan(
      summed,
    );
    // Before the pixel's colour is written out.
    expect(fragment.indexOf('stockOpen')).toBeLessThan(
      fragment.indexOf('#include <opaque_fragment>'),
    );
  });

  it("falls from the look's key light, and can be turned off", () => {
    const uniforms = createShadeUniforms();
    expect(uniforms.stockShade.value).toBe(1);
    applyStockShade(uniforms, true, 'studio');
    uniforms.stockLight.value.forEach((value, axis) =>
      expect(value).toBeCloseTo(unit(SUN_DIRECTION)[axis] ?? Number.NaN),
    );
    applyStockShade(uniforms, false, 'classic');
    expect(uniforms.stockShade.value).toBe(0);
    uniforms.stockLight.value.forEach((value, axis) =>
      expect(value).toBeCloseTo(unit(CLASSIC_KEY_DIRECTION)[axis] ?? Number.NaN),
    );
  });

  it("shades only the stock's top, which declares its depths before the functions read them", () => {
    const { uniforms, fragment } = topShader();
    expect(uniforms).toHaveProperty('stockShade');
    expect(uniforms).toHaveProperty('stockLight');
    const declared = fragment.indexOf('uniform sampler2D stockDepth;');
    expect(declared).toBeGreaterThanOrEqual(0);
    expect(fragment.indexOf('uniform sampler2D stockDepth;', declared + 1)).toBe(-1);
    expect(fragment.indexOf('varying vec2 vStockUv;')).toBeLessThan(
      fragment.indexOf('float stockShadow('),
    );
    expect(declared).toBeLessThan(fragment.indexOf('float stockShadow('));
    expect(declared).toBeLessThan(fragment.indexOf('vec3 stockCompareColour('));
    expect(fragment.indexOf('stockShadow(stockAt')).toBeGreaterThan(fragment.indexOf('void main'));
  });
});
