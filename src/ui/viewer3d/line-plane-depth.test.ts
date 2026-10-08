import * as three from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { describe, expect, it, vi } from 'vitest';
import { addTrail } from './line-trail';
import {
  addXYPlaneFlags,
  installXYPlaneDepth,
  withXYPlaneDepth,
  XY_PLANE_ATTRIBUTE,
} from './line-plane-depth';

function compiled(
  material: three.Material,
  source: { vertexShader: string; fragmentShader: string },
) {
  const shader = { ...source, uniforms: {} as Record<string, { value: unknown }> };
  material.onBeforeCompile(shader as never, {} as never);
  return shader;
}

describe('native XY plane eligibility', () => {
  it('shares one byte per vertex only for exact equal-Z pairs, retaining ramp depth', () => {
    const geometry = new three.BufferGeometry();
    geometry.setAttribute(
      'position',
      new three.BufferAttribute(
        new Float32Array([0, 0, 0, 100, 0, 0, 0, 0, 0, 100, 0, 10, 0, 0, 2, 0, 100, 2]),
        3,
      ),
    );
    addXYPlaneFlags(three, geometry);
    const flags = geometry.getAttribute(XY_PLANE_ATTRIBUTE);
    expect(flags.array).toBeInstanceOf(Uint8Array);
    expect([...flags.array]).toEqual([1, 1, 0, 0, 1, 1]);
    addXYPlaneFlags(three, geometry);
    expect(geometry.getAttribute(XY_PLANE_ATTRIBUTE)).toBe(flags);
    geometry.dispose();
  });
});

describe('plane depth shader composition', () => {
  it('keeps the actual trail/filter shader edits and uniform handoff', () => {
    const material = new LineMaterial();
    const trail = addTrail(three, material);
    installXYPlaneDepth(three, material, 'fat');
    const shader = compiled(material, material);
    expect(shader.uniforms.trailStart).toBe(trail.trailStart);
    expect(shader.vertexShader).toContain('instanceShown');
    expect(shader.vertexShader).toContain('gl_InstanceID');
    expect(shader.vertexShader).toContain('instanceStart.z == instanceEnd.z');
    expect(shader.fragmentShader).toContain('gl_FragDepth = gl_FragCoord.z');
    expect(shader.fragmentShader).toContain('abs( vKerfdeskXYPlane.z ) > 1e-8');
    expect(material.customProgramCacheKey()).toBe('kerfdesk-solid-path-xy-plane-depth-fat');
    material.dispose();
  });

  it('supports a bare native pick shader, without fog/logdepth chunks', () => {
    const source = {
      vertexShader:
        'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }',
    };
    const edited = withXYPlaneDepth(source, 'native');
    expect(edited.vertexShader).toContain('attribute float kerfdeskFlatXY;');
    expect(edited.vertexShader).toContain('kerfdeskFlatXY > 0.5');
    expect(edited.fragmentShader).toContain('gl_FragDepth = planeDepth');
    expect(edited.fragmentShader.indexOf('gl_FragColor')).toBeLessThan(
      edited.fragmentShader.indexOf('gl_FragDepth'),
    );
  });

  it('leaves an unknown shader without main anchors intact', () => {
    const source = { vertexShader: 'void other() {}', fragmentShader: 'void other() {}' };
    expect(withXYPlaneDepth(source, 'fat')).toBe(source);
  });
});

describe('raster plane depth against an independent ray oracle', () => {
  it.each([
    { perspective: false, cropped: false, viewport: [0, 0, 800, 400] },
    { perspective: true, cropped: false, viewport: [0, 0, 800, 400] },
    { perspective: false, cropped: false, viewport: [20, 30, 1600, 800] },
    { perspective: true, cropped: false, viewport: [20, 30, 1600, 800] },
    { perspective: false, cropped: true, viewport: [0, 0, 13, 13] },
    { perspective: true, cropped: true, viewport: [0, 0, 13, 13] },
  ])(
    'preserves ray depth for $perspective/$cropped/$viewport',
    ({ perspective, cropped, viewport }) => {
      const camera = perspective
        ? new three.PerspectiveCamera(40, 2, 0.1, 1000)
        : new three.OrthographicCamera(-80, 80, 40, -40, 0.1, 1000);
      camera.up.set(0, 0, 1);
      camera.position.set(100, -100, 25);
      camera.lookAt(50, 0, 0);
      if (cropped) camera.setViewOffset(800, 400, 410, 205, 13, 13);
      camera.updateMatrixWorld();
      const object = new three.LineSegments();
      object.position.set(7, -3, 0);
      object.updateMatrixWorld();
      object.modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, object.matrixWorld);
      const material = new LineMaterial();
      const previous = vi.fn();
      material.onBeforeRender = previous;
      installXYPlaneDepth(three, material, 'fat');
      const shader = compiled(material, material);
      const actualViewport = new three.Vector4(...(viewport as [number, number, number, number]));
      const renderer = {
        getCurrentViewport: (target: three.Vector4) => target.copy(actualViewport),
      };
      material.onBeforeRender(
        renderer as never,
        new three.Scene(),
        camera,
        new three.BufferGeometry(),
        object,
        {} as never,
      );
      expect(previous).toHaveBeenCalledOnce();
      expect(shader.uniforms.kerfdeskDepthViewport?.value).toEqual(actualViewport);
      const matrix = shader.uniforms.kerfdeskXYPlaneMatrix?.value as three.Matrix4;
      const planeAt = (ndc: three.Vector2, z: number) => {
        const plane = new three.Vector4(0, 0, 1, -z).applyMatrix4(matrix);
        const raster = new three.Vector2(
          viewport[0]! + ((ndc.x + 1) * viewport[2]!) / 2,
          viewport[1]! + ((ndc.y + 1) * viewport[3]!) / 2,
        );
        const xy = new three.Vector2(
          ((raster.x - actualViewport.x) / actualViewport.z) * 2 - 1,
          ((raster.y - actualViewport.y) / actualViewport.w) * 2 - 1,
        );
        return (-(plane.x * xy.x + plane.y * xy.y + plane.w) / plane.z + 1) / 2;
      };
      for (const ndc of [new three.Vector2(-0.1, 0.05), new three.Vector2(0.1, -0.1)]) {
        const ray = new three.Raycaster();
        ray.setFromCamera(ndc, camera);
        const depths: number[] = [];
        for (const z of [-1, 0, 1]) {
          const point = ray.ray.intersectPlane(
            new three.Plane(new three.Vector3(0, 0, 1), -z),
            new three.Vector3(),
          );
          expect(point).not.toBeNull();
          const expected = (point!.clone().project(camera).z + 1) / 2;
          const depth = planeAt(ndc, z);
          expect(depth).toBeCloseTo(expected, 12);
          depths.push(depth);
        }
        expect(depths[2]).toBeLessThan(depths[1]!);
        expect(depths[1]).toBeLessThan(depths[0]!);
      }
      material.dispose();
    },
  );
});
