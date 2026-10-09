import * as three from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { describe, expect, it, vi } from 'vitest';
import { installPickDepth, withLinearPickDepth } from './line-pick-depth';

describe('cropped ID eye-depth encoding', () => {
  it.each(['fat', 'native'] as const)(
    'composes physical clipping and resolved planes for %s',
    (kind) => {
      const material =
        kind === 'fat'
          ? new LineMaterial()
          : new three.ShaderMaterial({
              vertexShader:
                'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
              fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }',
            });
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

  it.each(['fat', 'native'] as const)('adds a source-plane tier only to ID %s shaders', (kind) => {
    const material =
      kind === 'fat'
        ? new LineMaterial()
        : new three.ShaderMaterial({
            vertexShader:
              'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
            fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }',
          });
    installPickDepth(three, material, kind);
    const shader = {
      vertexShader: material.vertexShader,
      fragmentShader: material.fragmentShader,
      uniforms: {},
    };
    material.onBeforeCompile(shader as never, {} as never);
    if (kind === 'fat') {
      expect(shader.vertexShader).not.toContain('attribute vec3 kerfdeskPickSourceAxis;');
      expect(shader.vertexShader).toContain(
        'vec3 pickSourceAxis = kerfdeskPickFullSourceAxis( instanceStart, instanceEnd );',
      );
      expect(shader.vertexShader.indexOf('start *= 0.5;')).toBeLessThan(
        shader.vertexShader.indexOf('vec3 delta = end - start;'),
      );
      for (const component of ['x', 'y', 'z']) {
        expect(shader.vertexShader).toContain(
          `kerfdeskPickNeedsHalf( start.${component}, end.${component} )`,
        );
      }
      expect(shader.vertexShader).toContain('delta *= 16777216.0;');
      expect(shader.vertexShader.indexOf('delta *= 16777216.0;')).toBeLessThan(
        shader.vertexShader.indexOf('float scale = uintBitsToFloat('),
      );
      expect(shader.vertexShader).toContain(
        'uintBitsToFloat( floatBitsToUint( maximum ) & 0x7f800000u )',
      );
      expect(shader.vertexShader).not.toContain('log2(');
      expect(shader.vertexShader).not.toContain('exp2(');
    } else {
      expect(shader.vertexShader).toContain('attribute vec3 kerfdeskPickSourceAxis;');
      expect(shader.vertexShader).toContain('vec3 pickSourceAxis = kerfdeskPickSourceAxis;');
      expect(shader.vertexShader).not.toContain('kerfdeskPickFullSourceAxis');
    }
    expect(shader.vertexShader).toContain('if ( pickAxisSquared > 0.0 )');
    expect(shader.vertexShader).toContain('uniform float kerfdeskPickPerspective;');
    expect(shader.vertexShader).toContain('invariant vKerfdeskPickPlaneZ;');
    expect(shader.vertexShader).toContain(
      '!( abs( vKerfdeskPickPlaneZ ) > 1e-8 ) && pickSourcePlaneKnown',
    );
    expect(shader.vertexShader).toContain(
      '? kerfdeskDepthOriginDelta : vec3( 0.0, 0.0, 1.0 ) * normalMatrix;',
    );
    expect(shader.vertexShader).toContain('-dot( pickFacingNormal, kerfdeskDepthOriginDelta )');
    expect(shader.vertexShader).toContain('if ( abs( pickFacingClipZ ) > 1e-8');
    expect(shader.vertexShader).toContain(
      '!any( isnan( pickFacingEyePlane ) ) && !any( isinf( pickFacingEyePlane ) )',
    );

    const nativeFar = 'if ( !( gl_FragDepth < 1.0 ) ) discard;';
    if (kind === 'native') {
      expect(shader.fragmentShader).toContain(nativeFar);
      expect(shader.fragmentShader.indexOf('gl_FragDepth = planeDepth;')).toBeLessThan(
        shader.fragmentShader.indexOf(nativeFar),
      );
      expect(shader.fragmentShader.indexOf(nativeFar)).toBeLessThan(
        shader.fragmentShader.indexOf('float pickEyeDistance;'),
      );
    } else {
      expect(shader.fragmentShader).not.toContain(nativeFar);
    }
    expect(shader.fragmentShader).toContain('if ( abs( vKerfdeskPickPlaneZ ) > 1e-8 )');
    expect(shader.fragmentShader).toContain(
      'if ( !( pickDepth >= 0.0 && pickDepth <= 1.0 ) ) discard;',
    );
    expect(
      shader.fragmentShader.indexOf('if ( planeDepth < 0.0 || planeDepth > 1.0 ) discard;'),
    ).toBeLessThan(shader.fragmentShader.indexOf('float pickDepth ='));
    expect(shader.fragmentShader).toContain('else if ( kerfdeskPickPerspective > 0.5 )');
    expect(material.customProgramCacheKey()).toContain(
      '-linear-pick-eye-depth-source-axis-f32-visible-far-v3-' + kind,
    );
    material.dispose();
  });
  it('requires the physical helper instead of changing an unknown shader', () => {
    const source = { vertexShader: 'void main() {}', fragmentShader: 'void main() {}' };
    expect(withLinearPickDepth(source, 'fat')).toBe(source);
  });

  it('preserves raster near/far endpoints in Float32 without inverse-depth cancellation', () => {
    const material = new three.ShaderMaterial({
      vertexShader: 'void main() {}',
      fragmentShader: 'void main() {}',
    });
    installPickDepth(three, material, 'native');
    const shader = {
      vertexShader: material.vertexShader,
      fragmentShader: material.fragmentShader,
      uniforms: {},
    };
    material.onBeforeCompile(shader as never, {} as never);
    const fallback = shader.fragmentShader.slice(
      shader.fragmentShader.lastIndexOf('else if ( kerfdeskPickPerspective'),
    );
    for (const far of [1000, 100000]) {
      const camera = new three.PerspectiveCamera(40, 1, 0.1, far);
      for (const z of [0, 0.5, 1]) {
        const variables: Record<string, number> = {
          'kerfdeskPickClipRange.x': Math.fround(camera.near),
          'kerfdeskPickClipRange.y': Math.fround(far),
          'gl_FragCoord.z': Math.fround(z),
        };
        const temporary = fallback.match(/float pickEyeDistance = ([\s\S]*?);/);
        if (temporary?.[1]) variables.pickEyeDistance = evaluateFloat32(temporary[1], variables);
        const assignment = fallback.match(/gl_FragDepth = ([\s\S]*?);/);
        expect(assignment).not.toBeNull();
        const actual = evaluateFloat32(assignment?.[1] ?? '', variables);
        const eye = new three.Vector3(0, 0, z * 2 - 1).applyMatrix4(camera.projectionMatrixInverse);
        const expected = (-eye.z - camera.near) / (far - camera.near);
        expect(Math.abs(actual - expected)).toBeLessThanOrEqual(
          Math.max(4 * 2 ** -23 * Math.abs(expected), 4 * Number.EPSILON),
        );
        if (z === 0 || z === 1) expect(actual).toBe(z);
      }
    }
    material.dispose();
  });
});

// Evaluate the emitted scalar GLSL expression, rounding each operation as a
// separate Float32 step. The expected depth above comes from Three's inverse
// projection, independently of the shader's selected algebra.
function evaluateFloat32(source: string, values: Record<string, number>): number {
  const tokens = source.match(/[A-Za-z_][\w.]*|\d+(?:\.\d+)?|[()+*/-]/g) ?? [];
  const precedence: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };
  let at = 0;
  const expression = (minimum = 0): number => {
    const token = tokens[at++];
    let left: number;
    if (token === '(') {
      left = expression();
      if (tokens[at++] !== ')') throw Error('Unbalanced GLSL expression');
    } else {
      left = Math.fround(values[token ?? ''] ?? Number(token));
      if (!Number.isFinite(left)) throw Error('Unknown GLSL operand: ' + token);
    }
    while ((precedence[tokens[at] ?? ''] ?? -1) >= minimum) {
      const operator = tokens[at++] ?? '';
      const right = expression((precedence[operator] ?? 0) + 1);
      left = Math.fround(binaryValue(operator, left, right));
    }
    return left;
  };
  const result = expression();
  if (at !== tokens.length) throw Error('Unconsumed GLSL expression');
  return result;
}

function binaryValue(operator: string, left: number, right: number): number {
  switch (operator) {
    case '+':
      return left + right;
    case '-':
      return left - right;
    case '*':
      return left * right;
    case '/':
      return left / right;
    default:
      throw Error('Unknown GLSL operator: ' + operator);
  }
}
