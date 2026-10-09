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
    expect(vertex.indexOf('gl_InstanceID')).toBeGreaterThan(vertex.indexOf('void main()'));
    expect(vertex.indexOf('if ( float( gl_InstanceID ) < trailStart )')).toBeLessThan(
      vertex.indexOf('float aspect = resolution.x / resolution.y;'),
    );
    expect(vertex).toContain('gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );\n    return;');
    expect(vertex.indexOf('float trailInstance =')).toBeGreaterThan(
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
    const unknownMain = {
      vertexShader: 'void main() { gl_Position = vec4(1.0); }',
      fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }',
    };
    expect(withTrail(unknownMain)).toBe(unknownMain);
  });

  it('keeps admitted line extrusion and the existing fade expression intact', () => {
    const original = new LineMaterial();
    const edited = withTrail(original);
    const start = 'float aspect = resolution.x / resolution.y;';
    const end = '#include <fog_vertex>';
    const body = (source: string) =>
      source.slice(source.indexOf(start), source.lastIndexOf(end) + end.length);
    expect(body(edited.vertexShader)).toBe(body(original.vertexShader));
    expect(edited.vertexShader).toContain(
      'vTrailFade = trailFade * ( 1.0 - clamp( ( trailInstance - trailStart ) / trailSpan, 0.0, 1.0 ) );',
    );
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
