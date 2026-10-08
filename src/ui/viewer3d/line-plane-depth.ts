// Screen-width ribbons can disagree in depth when an XY stroke is reversed or
// shortened. Compare their shared work plane at the raster sample instead.
// Different Z planes, sloping fat strokes and scene geometry retain real depth.
import type * as ThreeNamespace from 'three';
import { insertBefore, MAIN, type ShaderSource } from './line-shader-edits';

type StrokeKind = 'fat' | 'native';

const PLANE_MATRIX = 'kerfdeskXYPlaneMatrix';
const VIEWPORT = 'kerfdeskDepthViewport';
const PLANE = 'vKerfdeskXYPlane';
export const XY_PLANE_ATTRIBUTE = 'kerfdeskFlatXY';

function declarations(): string {
  return `flat varying vec4 ${PLANE};\n`;
}

/** Applies one geometric depth definition to constant-Z fat and native lines. */
export function withXYPlaneDepth(shader: ShaderSource, kind: StrokeKind): ShaderSource {
  if (!shader.vertexShader.includes(MAIN) || !shader.fragmentShader.includes(MAIN)) return shader;
  const plane =
    kind === 'fat'
      ? `${PLANE} = vec4( 0.0 );
  if ( instanceStart.z == instanceEnd.z )
    ${PLANE} = ${PLANE_MATRIX} * vec4( 0.0, 0.0, 1.0, -instanceStart.z );`
      : `${PLANE} = vec4( 0.0 );
  if ( ${XY_PLANE_ATTRIBUTE} > 0.5 )
    ${PLANE} = ${PLANE_MATRIX} * vec4( 0.0, 0.0, 1.0, -position.z );`;
  const depth = `
  gl_FragDepth = gl_FragCoord.z;
  if ( abs( ${PLANE}.z ) > 1e-8 ) {
    vec2 planeNdc = ( gl_FragCoord.xy - ${VIEWPORT}.xy ) / ${VIEWPORT}.zw * 2.0 - 1.0;
    float planeZ = -( dot( ${PLANE}.xy, planeNdc ) + ${PLANE}.w ) / ${PLANE}.z;
    float planeDepth = planeZ * 0.5 + 0.5;
    if ( planeDepth < 0.0 || planeDepth > 1.0 ) discard;
    gl_FragDepth = planeDepth;
  }
`;
  return {
    vertexShader: appendMain(
      insertBefore(
        shader.vertexShader,
        MAIN,
        `uniform mat4 ${PLANE_MATRIX};\n` +
          (kind === 'native' ? `attribute float ${XY_PLANE_ATTRIBUTE};\n` : '') +
          declarations(),
      ),
      '\n  ' + plane + '\n',
    ),
    fragmentShader: appendMain(
      insertBefore(shader.fragmentShader, MAIN, `uniform vec4 ${VIEWPORT};\n` + declarations()),
      depth,
    ),
  };
}

/** Both native vertices carry one byte: varying-Z rapids keep their original depth. */
export function addXYPlaneFlags(
  three: typeof ThreeNamespace,
  geometry: ThreeNamespace.BufferGeometry,
): void {
  if (geometry.hasAttribute(XY_PLANE_ATTRIBUTE)) return;
  const positions = geometry.getAttribute('position');
  const flags = new Uint8Array(positions.count);
  for (let vertex = 0; vertex + 1 < positions.count; vertex += 2) {
    if (positions.getZ(vertex) !== positions.getZ(vertex + 1)) continue;
    flags[vertex] = 1;
    flags[vertex + 1] = 1;
  }
  geometry.setAttribute(XY_PLANE_ATTRIBUTE, new three.BufferAttribute(flags, 1));
}

function appendMain(source: string, body: string): string {
  const end = source.lastIndexOf('}');
  return end < 0 ? source : source.slice(0, end) + body + source.slice(end);
}

/** Compose existing edits and update the clip-plane transform once per draw. */
export function installXYPlaneDepth(
  three: typeof ThreeNamespace,
  material: ThreeNamespace.Material,
  kind: StrokeKind,
): void {
  const planeMatrix = new three.Matrix4();
  const viewport = new three.Vector4();
  const compile = material.onBeforeCompile;
  const render = material.onBeforeRender;
  const cacheKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    shader.uniforms[PLANE_MATRIX] = { value: planeMatrix };
    shader.uniforms[VIEWPORT] = { value: viewport };
    Object.assign(shader, withXYPlaneDepth(shader, kind));
  };
  material.customProgramCacheKey = () => cacheKey + '-xy-plane-depth-' + kind;
  material.onBeforeRender = (renderer, scene, camera, geometry, object, group) => {
    render.call(material, renderer, scene, camera, geometry, object, group);
    planeMatrix
      .multiplyMatrices(camera.projectionMatrix, object.modelViewMatrix)
      .invert()
      .transpose();
    // Current viewport is in drawing-buffer pixels, including target/window and DPR.
    renderer.getCurrentViewport(viewport);
  };
}
