import * as three from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { describe, expect, it } from 'vitest';
import { addTrail, setTrail, TRAIL_FADE, withTrail } from './line-trail';

describe('withTrail', () => {
  it('adds the trail to the fat-line shader three ships', () => {
    const material = new LineMaterial();
    const shader = withTrail(material);
    const vertex = shader.vertexShader;
    expect(vertex.indexOf('uniform float trailStart;')).toBeLessThan(vertex.indexOf('void main()'));
    expect(vertex.indexOf('gl_InstanceID')).toBeGreaterThan(
      vertex.lastIndexOf('#include <fog_vertex>'),
    );
    const fragment = shader.fragmentShader;
    expect(fragment.indexOf('varying float vTrailFade;')).toBeLessThan(
      fragment.indexOf('void main()'),
    );
    expect(fragment.indexOf('mix( diffuseColor.rgb, trailFadeColor')).toBeGreaterThan(
      fragment.indexOf('#include <color_fragment>'),
    );
  });

  it('leaves a shader without the anchors as it is', () => {
    const shader = { vertexShader: 'void f() {}', fragmentShader: 'void g() {}' };
    expect(withTrail(shader)).toEqual(shader);
  });
});

describe('trail uniforms', () => {
  it('start off, then draw from the trail start and fade toward the colour given', () => {
    const material = new LineMaterial();
    const uniforms = addTrail(three, material);
    expect(uniforms.trailStart.value).toBe(0);
    expect(uniforms.trailFade.value).toBe(0);
    setTrail(uniforms, 12, 40, [0.1, 0.2, 0.3]);
    expect(uniforms.trailStart.value).toBe(12);
    expect(uniforms.trailEnd.value).toBe(40);
    expect(uniforms.trailFade.value).toBe(TRAIL_FADE);
    expect(uniforms.trailFadeColor.value.toArray()).toEqual([0.1, 0.2, 0.3]);
    setTrail(uniforms, 0, 40, null);
    expect(uniforms.trailFade.value).toBe(0);
  });

  it('reach the shader when it compiles', () => {
    const material = new LineMaterial();
    const uniforms = addTrail(three, material);
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: material.vertexShader,
      fragmentShader: material.fragmentShader,
    };
    material.onBeforeCompile(shader as never, {} as never);
    expect(shader.uniforms['trailStart']).toBe(uniforms.trailStart);
    expect(shader.vertexShader).toContain('vTrailFade');
  });
});
