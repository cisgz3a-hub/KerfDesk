import * as three from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { describe, expect, it, vi } from 'vitest';
import { installPickDepth, withLinearPickDepth } from './line-pick-depth';

describe('cropped ID eye-depth encoding', () => {
  it.each(['fat', 'native'] as const)(
    'composes physical clipping and resolved planes for %s',
    (kind) => {
      const material = new LineMaterial();
      const previousCompile = vi.fn();
      const previousRender = vi.fn();
      material.onBeforeCompile = previousCompile;
      material.onBeforeRender = previousRender;
      installPickDepth(three, material, kind);
      const shader = {
        vertexShader: material.vertexShader,
        fragmentShader: material.fragmentShader,
        uniforms: {} as Record<string, { value: unknown }>,
      };
      material.onBeforeCompile(shader as never, {} as never);
      expect(previousCompile).toHaveBeenCalledOnce();
      expect(
        shader.vertexShader.indexOf('kerfdeskDepthNormal = vec3( kerfdeskDepthOriginDelta.xy'),
      ).toBeLessThan(shader.vertexShader.indexOf('vKerfdeskPickEyePlane = vec4('));
      expect(
        shader.fragmentShader.indexOf('if ( planeDepth < 0.0 || planeDepth > 1.0 ) discard;'),
      ).toBeLessThan(shader.fragmentShader.indexOf('float pickEyeDistance;'));
      expect(shader.vertexShader).toContain('invariant vKerfdeskPickEyePlane;');
      expect(material.customProgramCacheKey()).toContain(
        '-physical-source-plane-depth-' + kind + '-linear-pick-eye-depth',
      );
      const object = new three.LineSegments();
      const projection = new three.Matrix4();
      for (const perspective of [false, true]) {
        const camera = perspective
          ? new three.PerspectiveCamera(40, 4 / 3, 0.1, 1000)
          : new three.OrthographicCamera(-60, 60, 45, -45, 0.1, 1000);
        camera.position.set(50, 0, 130);
        camera.lookAt(50, 0, 0);
        camera.updateMatrixWorld();
        camera.setViewOffset(800, 600, 394, 294, 13, 13);
        projection.copy(camera.projectionMatrix);
        object.modelViewMatrix.copy(camera.matrixWorldInverse);
        const renderer = {
          getCurrentViewport: (target: three.Vector4) => target.set(0, 0, 13, 13),
        };
        material.onBeforeRender(
          renderer as never,
          new three.Scene(),
          camera,
          object.geometry,
          object,
          {} as never,
        );
        expect(shader.uniforms.kerfdeskPickClipRange?.value).toEqual(new three.Vector2(0.1, 1000));
        expect(shader.uniforms.kerfdeskPickPerspective?.value).toBe(perspective ? 1 : 0);
        expect(camera.projectionMatrix).toEqual(projection);
        expect([camera.near, camera.far]).toEqual([0.1, 1000]);
      }
      expect(previousRender).toHaveBeenCalledTimes(2);
      material.dispose();
      object.geometry.dispose();
    },
  );

  it('requires the physical helper instead of changing an unknown shader', () => {
    const source = { vertexShader: 'void main() {}', fragmentShader: 'void main() {}' };
    expect(withLinearPickDepth(source)).toBe(source);
  });
});
