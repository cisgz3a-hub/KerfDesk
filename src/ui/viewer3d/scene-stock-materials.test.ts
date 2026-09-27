import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  STOCK_MATERIALS,
  applyStockMaterial,
  createStockUniforms,
  stockFragmentChunks,
  stockVertexChunks,
} from './scene-stock-materials';

describe('carved stock materials (ADR-487)', () => {
  it('colours and shines each pixel after three sets them, in both shaders', () => {
    const vertex = stockVertexChunks(THREE.ShaderLib.standard.vertexShader);
    expect(vertex.indexOf('vStockPoint = transformed;')).toBeLessThan(
      vertex.indexOf('#include <project_vertex>'),
    );
    const fragment = stockFragmentChunks(THREE.ShaderLib.standard.fragmentShader);
    expect(fragment.indexOf('diffuseColor.rgb = stockColour')).toBeGreaterThan(
      fragment.indexOf('#include <color_fragment>'),
    );
    expect(fragment.indexOf('roughnessFactor = stockRoughness')).toBeGreaterThan(
      fragment.indexOf('#include <roughnessmap_fragment>'),
    );
    // Every material has its own branch in the shader.
    for (let kind = 0; kind < STOCK_MATERIALS.length - 1; kind += 1) {
      expect(fragment).toContain(`stockKind == ${kind}`);
    }
  });

  it('changes a uniform and the shine, not the shader, for a new material or look', () => {
    const uniforms = createStockUniforms(-4);
    const top = new THREE.MeshStandardMaterial();
    const sides = new THREE.MeshStandardMaterial();
    applyStockMaterial(uniforms, [top, sides], 'aluminium', 'studio');
    expect(uniforms.stockKind.value).toBe(STOCK_MATERIALS.indexOf('aluminium'));
    expect(uniforms.stockBottom.value).toBe(-4);
    expect(uniforms.stockGain.value).toBeLessThan(1);
    expect([top.metalness, sides.metalness]).toEqual([1, 1]);
    // Classic has nothing for metal to reflect, so it is only part metal there.
    applyStockMaterial(uniforms, [top, sides], 'aluminium', 'classic');
    expect(top.metalness).toBeLessThan(0.5);
    expect(uniforms.stockGain.value).toBe(1);
    applyStockMaterial(uniforms, [top, sides], 'wood', 'classic');
    expect(uniforms.stockKind.value).toBe(0);
    expect(top.metalness).toBe(0);
  });
});
