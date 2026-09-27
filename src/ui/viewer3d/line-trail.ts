// The playback trail (ADR-470): the solid path's line shader skips the done
// moves older than the trail and fades the rest toward the background, oldest
// most. Moves are instances drawn in program order, so the trail is two
// numbers (its first and last instance) and nothing is copied or rebuilt as
// the playhead moves. With the trail off the shader draws every instance as
// before.

import type * as ThreeNamespace from 'three';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

/** How far toward the background the oldest move of a trail fades. */
export const TRAIL_FADE = 0.7;

export type TrailUniforms = {
  readonly trailStart: { value: number };
  readonly trailEnd: { value: number };
  readonly trailFade: { value: number };
  readonly trailFadeColor: { value: ThreeNamespace.Color };
};

type ShaderSource = { vertexShader: string; fragmentShader: string };

const MAIN = 'void main() {';

const VERTEX_DECLARATIONS = `uniform float trailStart;
uniform float trailEnd;
uniform float trailFade;
varying float vTrailFade;
`;

// After the line's own clip position: an instance before the trail moves
// past the far plane, and the rest carry how faded they are.
const VERTEX_BODY = `
  float trailInstance = float( gl_InstanceID );
  if ( trailInstance < trailStart ) gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );
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
  return {
    vertexShader: insertAfter(
      insertBefore(shader.vertexShader, MAIN, VERTEX_DECLARATIONS),
      '#include <fog_vertex>',
      VERTEX_BODY,
    ),
    fragmentShader: insertAfter(
      insertBefore(shader.fragmentShader, MAIN, FRAGMENT_DECLARATIONS),
      '#include <color_fragment>',
      FRAGMENT_BODY,
    ),
  };
}

/** Gives a fat-line material the trail, off until `setTrail` turns it on. */
export function addTrail(three: typeof ThreeNamespace, material: LineMaterial): TrailUniforms {
  const uniforms: TrailUniforms = {
    trailStart: { value: 0 },
    trailEnd: { value: 0 },
    trailFade: { value: 0 },
    trailFadeColor: { value: new three.Color() },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    Object.assign(shader, withTrail(shader));
  };
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

function insertBefore(source: string, anchor: string, text: string): string {
  const at = source.indexOf(anchor);
  return at < 0 ? source : source.slice(0, at) + text + source.slice(at);
}

function insertAfter(source: string, anchor: string, text: string): string {
  const at = source.lastIndexOf(anchor);
  if (at < 0) return source;
  const end = at + anchor.length;
  return source.slice(0, end) + text + source.slice(end);
}
