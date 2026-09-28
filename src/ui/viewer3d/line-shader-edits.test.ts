import * as three from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { describe, expect, it } from 'vitest';
import { addTrail } from './line-trail';
import { editLineMaterial, withShownMoves } from './line-shader-edits';
import { withInstancePickIds } from './pick-ids';
import { SHOWN_ATTRIBUTE } from './program-lines';

describe('fat-line shader edits (ADR-485)', () => {
  it('drops moves that are not shown, after the clip position is final', () => {
    const vertex = withShownMoves(new LineMaterial()).vertexShader;
    expect(vertex.indexOf(`attribute float ${SHOWN_ATTRIBUTE};`)).toBeLessThan(
      vertex.indexOf('void main()'),
    );
    expect(vertex.indexOf(`if ( ${SHOWN_ATTRIBUTE} < 0.5 )`)).toBeGreaterThan(
      vertex.lastIndexOf('#include <fog_vertex>'),
    );
  });

  it('paints each instance in its pick identity, as the last word of the fragment', () => {
    const shader = withInstancePickIds(new LineMaterial());
    expect(shader.vertexShader).toContain('uint( gl_InstanceID ) + 1u');
    const fragment = shader.fragmentShader;
    expect(fragment.indexOf('flat varying vec4 vPickId;')).toBeLessThan(
      fragment.indexOf('void main()'),
    );
    expect(fragment.lastIndexOf('gl_FragColor = vPickId;')).toBeGreaterThan(
      fragment.lastIndexOf('#include <premultiplied_alpha_fragment>'),
    );
  });

  it('leave a shader without the anchors as it is', () => {
    const shader = { vertexShader: 'void f() {}', fragmentShader: 'void g() {}' };
    expect(withShownMoves(shader)).toEqual(shader);
    expect(withInstancePickIds(shader)).toEqual(shader);
  });

  it('give each edit its own compiled program', () => {
    const solid = new LineMaterial();
    addTrail(three, solid);
    const ghost = new LineMaterial();
    editLineMaterial(ghost, 'kerfdesk-shown-moves', withShownMoves);
    const pick = new LineMaterial();
    editLineMaterial(pick, 'kerfdesk-pick-moves', (shader) =>
      withInstancePickIds(withShownMoves(shader)),
    );
    const keys = [solid, ghost, pick].map((material) => material.customProgramCacheKey());
    expect(new Set(keys).size).toBe(3);
  });
});
