// Screen-width ribbons can disagree in depth when an XY stroke is reversed or
// shortened. Compare their shared work plane at the raster sample instead.
// Each nonvertical stroke uses its physical least-slope XY plane; vertical
// and edge-on strokes retain raster depth. Scene geometry still occludes it.
import type * as ThreeNamespace from 'three';
import { insertBefore, MAIN, type ShaderSource } from './line-shader-edits';
import { DEPTH_PLANE_ATTRIBUTE, DEPTH_PLANE_OFFSET_ATTRIBUTE } from './line-depth-plane-geometry';

type StrokeKind = 'fat' | 'native';

/** Only a full, opaque, wider completed batch can cover its own thin ghost. */
export type CoveredGhost = {
  readonly start: { value: number };
  readonly end: { value: number };
  readonly eligible: (geometry: ThreeNamespace.BufferGeometry) => boolean;
};

const PLANE_MATRIX = 'kerfdeskXYPlaneMatrix';
const VIEWPORT = 'kerfdeskDepthViewport';
const PLANE = 'vKerfdeskXYPlane';

function declarations(): string {
  return `flat varying vec4 ${PLANE};\n`;
}

/** Fat and native strokes evaluate the same physical plane at the raster pixel. */
export function withXYPlaneDepth(shader: ShaderSource, _kind: StrokeKind): ShaderSource {
  if (!shader.vertexShader.includes(MAIN) || !shader.fragmentShader.includes(MAIN)) return shader;
  const plane = `${PLANE} = ${PLANE_MATRIX} * ${DEPTH_PLANE_ATTRIBUTE}
    + ${PLANE_MATRIX}[3] * ${DEPTH_PLANE_OFFSET_ATTRIBUTE};`;
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
          `attribute vec4 ${DEPTH_PLANE_ATTRIBUTE};\n` +
          `attribute float ${DEPTH_PLANE_OFFSET_ATTRIBUTE};\n` +
          declarations() +
          `invariant ${PLANE};\n`,
      ),
      '\n  ' + plane + '\n',
    ),
    fragmentShader: appendMain(
      insertBefore(
        shader.fragmentShader,
        MAIN,
        `uniform vec4 ${VIEWPORT};\n` + declarations() + 'invariant gl_FragDepth;\n',
      ),
      depth,
    ),
  };
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
  covered?: CoveredGhost,
): void {
  const planeMatrix = new three.Matrix4();
  const viewport = new three.Vector4();
  const coveredEnabled = { value: 0 };
  const compile = material.onBeforeCompile;
  const render = material.onBeforeRender;
  const cacheKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    shader.uniforms[PLANE_MATRIX] = { value: planeMatrix };
    shader.uniforms[VIEWPORT] = { value: viewport };
    Object.assign(shader, withXYPlaneDepth(shader, kind));
    if (covered && kind === 'fat') {
      shader.uniforms.kerfdeskCoveredStart = covered.start;
      shader.uniforms.kerfdeskCoveredEnd = covered.end;
      shader.uniforms.kerfdeskCoveredEnabled = coveredEnabled;
      // This runs after the helper has decided whether plane depth applies.
      // A ramp or edge-on fallback must keep its original ghost coverage.
      shader.vertexShader = appendMain(
        insertBefore(
          shader.vertexShader,
          MAIN,
          `uniform float kerfdeskCoveredStart;
uniform float kerfdeskCoveredEnd;
uniform float kerfdeskCoveredEnabled;
`,
        ),
        `
  if ( kerfdeskCoveredEnabled > 0.5 && instanceStart.z == instanceEnd.z
    && abs( ${PLANE}.z ) > 1e-8
    && float( gl_InstanceID ) >= kerfdeskCoveredStart
    && float( gl_InstanceID ) < kerfdeskCoveredEnd )
    gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );
`,
      );
    }
  };
  material.customProgramCacheKey = () =>
    cacheKey + '-physical-plane-depth-' + kind + (covered ? '-covered-ghost' : '');
  material.onBeforeRender = (renderer, scene, camera, geometry, object, group) => {
    render.call(material, renderer, scene, camera, geometry, object, group);
    planeMatrix
      .multiplyMatrices(camera.projectionMatrix, object.modelViewMatrix)
      .invert()
      .transpose();
    // Current viewport is in drawing-buffer pixels, including target/window and DPR.
    renderer.getCurrentViewport(viewport);
    coveredEnabled.value = covered?.eligible(geometry) ? 1 : 0;
  };
}
