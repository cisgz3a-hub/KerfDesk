// The playback trail (ADR-470): the solid path's line shader skips the done
// moves older than the trail and fades the rest toward the background, oldest
// most. Instance i is move i (ADR-485), so the trail is two move numbers and
// nothing is copied or rebuilt as the playhead moves. With the trail off the
// shader draws every instance as before.

import type * as ThreeNamespace from 'three';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import {
  editLineMaterial,
  insertAfter,
  insertBefore,
  MAIN,
  VERTEX_END,
  withShownMoves,
  type ShaderSource,
} from './line-shader-edits';

/** How far toward the background the oldest move of a trail fades. */
export const TRAIL_FADE = 0.7;

export type TrailUniforms = {
  readonly trailStart: { value: number };
  readonly trailEnd: { value: number };
  readonly trailFade: { value: number };
  readonly trailFadeColor: { value: ThreeNamespace.Color };
};

const VERTEX_DECLARATIONS = `uniform float trailStart;
uniform float trailEnd;
uniform float trailFade;
varying float vTrailFade;
`;

// Reject the same old trail interval before extrusion or physical-plane work.
const VERTEX_EARLY = `
  if ( float( gl_InstanceID ) < trailStart ) {
    gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );
    return;
  }
`;

// Admitted instances retain the original fade arithmetic and its position.
const VERTEX_BODY = `
  float trailInstance = float( gl_InstanceID );
  float trailSpan = max( trailEnd - trailStart, 1.0 );
  vTrailFade = trailFade * ( 1.0 - clamp( ( trailInstance - trailStart ) / trailSpan, 0.0, 1.0 ) );
`;

const FRAGMENT_DECLARATIONS = `uniform vec3 trailFadeColor;
varying float vTrailFade;
`;

const FRAGMENT_BODY = `
  diffuseColor.rgb = mix( diffuseColor.rgb, trailFadeColor, vTrailFade );
`;

/** Adds the trail to a line shader's source; a source without the anchors stays as it is. */
export function withTrail(shader: ShaderSource): ShaderSource {
  if (!shader.vertexShader.includes(MAIN) || !shader.vertexShader.includes(VERTEX_END))
    return shader;
  return {
    vertexShader: insertAfter(
      insertAfter(insertBefore(shader.vertexShader, MAIN, VERTEX_DECLARATIONS), MAIN, VERTEX_EARLY),
      VERTEX_END,
      VERTEX_BODY,
    ),
    fragmentShader: insertAfter(
      insertBefore(shader.fragmentShader, MAIN, FRAGMENT_DECLARATIONS),
      '#include <color_fragment>',
      FRAGMENT_BODY,
    ),
  };
}

/**
 * Gives the solid path's material the trail, off until `setTrail` turns it
 * on, and drops the moves it does not show.
 */
export function addTrail(three: typeof ThreeNamespace, material: LineMaterial): TrailUniforms {
  const uniforms: TrailUniforms = {
    trailStart: { value: 0 },
    trailEnd: { value: 0 },
    trailFade: { value: 0 },
    trailFadeColor: { value: new three.Color() },
  };
  editLineMaterial(
    material,
    'kerfdesk-solid-path',
    (shader) => withShownMoves(withTrail(shader)),
    uniforms,
  );
  return uniforms;
}

/**
 * Draws instances from `start` on, fading toward `fadeColor` (r g b, as the
 * lines' colours are encoded) up to `end`; a start of 0 with no fade is the
 * whole path.
 */
export function setTrail(
  uniforms: TrailUniforms,
  start: number,
  end: number,
  fadeColor: readonly [number, number, number] | null,
): void {
  uniforms.trailStart.value = start;
  uniforms.trailEnd.value = end;
  uniforms.trailFade.value = fadeColor === null ? 0 : TRAIL_FADE;
  if (fadeColor !== null) uniforms.trailFadeColor.value.setRGB(...fadeColor);
}
