// Edits to three's fat-line shader (ADR-470, ADR-485). Each edit anchors on
// lines the shader ships with and leaves a source without them as it is.

import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { SHOWN_ATTRIBUTE } from './program-lines';

export type ShaderSource = { vertexShader: string; fragmentShader: string };
type Uniforms = Record<string, { value: unknown }>;

export const MAIN = 'void main() {';
/** The last line of the vertex shader's main: the clip position is final. */
export const VERTEX_END = '#include <fog_vertex>';

// Moved past the far plane, every corner of the move: nothing is drawn.
const SHOWN_DECLARATION = `attribute float ${SHOWN_ATTRIBUTE};
`;
const SHOWN_BODY = `
  if ( ${SHOWN_ATTRIBUTE} < 0.5 ) gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );
`;

/** Drops the moves whose shown flag is off (rapids, filtered moves). */
export function withShownMoves(shader: ShaderSource): ShaderSource {
  return {
    vertexShader: insertAfter(
      insertBefore(shader.vertexShader, MAIN, SHOWN_DECLARATION),
      VERTEX_END,
      SHOWN_BODY,
    ),
    fragmentShader: shader.fragmentShader,
  };
}

/**
 * Applies `edit` to a line material's shader when it compiles. `key` names
 * the edit: three shares one compiled program between materials with the
 * same key, so two different edits must never share one.
 */
export function editLineMaterial(
  material: LineMaterial,
  key: string,
  edit: (shader: ShaderSource) => ShaderSource,
  uniforms: Uniforms = {},
): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    Object.assign(shader, edit(shader));
  };
  material.customProgramCacheKey = () => key;
}

export function insertBefore(source: string, anchor: string, text: string): string {
  const at = source.indexOf(anchor);
  return at < 0 ? source : source.slice(0, at) + text + source.slice(at);
}

export function insertAfter(source: string, anchor: string, text: string): string {
  const at = source.lastIndexOf(anchor);
  if (at < 0) return source;
  const end = at + anchor.length;
  return source.slice(0, end) + text + source.slice(end);
}
