// Screen-width ribbons can disagree in depth when an XY stroke is reversed or
// shortened. Compare their shared work plane at the raster sample instead.
// Nonvertical strokes use their physical least-slope XY plane; vertical strokes
// share a camera-facing plane. Edge-on strokes retain raster depth.
import type * as ThreeNamespace from 'three';
import { insertBefore, MAIN, type ShaderSource } from './line-shader-edits';
import {
  DEPTH_PLANE_ATTRIBUTE,
  DEPTH_PLANE_OFFSET_ATTRIBUTE,
  DEPTH_PLANE_ORIGIN_ATTRIBUTE,
} from './line-depth-plane-geometry';

type StrokeKind = 'fat' | 'native';

/** Only a full, opaque, wider completed batch can cover its own thin ghost. */
export type CoveredGhost = {
  readonly start: { value: number };
  readonly end: { value: number };
  readonly eligible: (geometry: ThreeNamespace.BufferGeometry) => boolean;
  /** Separate conservative opt-in; the historical constant-Z guard is unchanged. */
  readonly rampEligible?: (
    renderer: ThreeNamespace.WebGLRenderer,
    geometry: ThreeNamespace.BufferGeometry,
    object: ThreeNamespace.Object3D,
  ) => boolean;
};

const PLANE_MATRIX = 'kerfdeskXYPlaneMatrix';
const VIEWPORT = 'kerfdeskDepthViewport';
const CAMERA_HIGH = 'kerfdeskDepthCameraHigh';
const CAMERA_LOW = 'kerfdeskDepthCameraLow';
const PLANE = 'vKerfdeskXYPlane';

function declarations(): string {
  return `flat varying vec4 ${PLANE};\n`;
}

/** Fat and native strokes evaluate the same physical plane at the raster pixel. */
export function withXYPlaneDepth(shader: ShaderSource, _kind: StrokeKind): ShaderSource {
  if (!shader.vertexShader.includes(MAIN) || !shader.fragmentShader.includes(MAIN)) return shader;
  // Subtract the camera from the canonical source origin before evaluating the
  // plane, keeping its constant local without cancellation through a rotation.
  const plane = `vec3 kerfdeskDepthOriginDelta = ( ${DEPTH_PLANE_ORIGIN_ATTRIBUTE}.xyz - ${CAMERA_HIGH} ) - ${CAMERA_LOW};
  vec3 kerfdeskDepthNormal = ${DEPTH_PLANE_ATTRIBUTE}.xyz;
  float kerfdeskDepthLocalOffset = ${DEPTH_PLANE_ORIGIN_ATTRIBUTE}.w + ${DEPTH_PLANE_OFFSET_ATTRIBUTE};
  if ( all( equal( kerfdeskDepthNormal, vec3( 0.0 ) ) )
    && ${DEPTH_PLANE_ORIGIN_ATTRIBUTE}.w == 1.0 ) {
    kerfdeskDepthNormal = vec3( kerfdeskDepthOriginDelta.xy, 0.0 );
    kerfdeskDepthLocalOffset = 0.0;
  }
  vec3 kerfdeskDepthNormalEye = normalMatrix * kerfdeskDepthNormal;
  ${PLANE} = ${PLANE_MATRIX} * vec4( kerfdeskDepthNormalEye,
    kerfdeskDepthLocalOffset - dot( kerfdeskDepthNormal, kerfdeskDepthOriginDelta ) );`;
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
          `uniform vec3 ${CAMERA_HIGH};\n` +
          `uniform vec3 ${CAMERA_LOW};\n` +
          `attribute vec4 ${DEPTH_PLANE_ATTRIBUTE};\n` +
          `attribute float ${DEPTH_PLANE_OFFSET_ATTRIBUTE};\n` +
          `attribute vec4 ${DEPTH_PLANE_ORIGIN_ATTRIBUTE};\n` +
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

/** Compose existing edits and update the inverse projection once per draw. */
export function installXYPlaneDepth(
  three: typeof ThreeNamespace,
  material: ThreeNamespace.Material,
  kind: StrokeKind,
  covered?: CoveredGhost,
): void {
  const planeMatrix = new three.Matrix4();
  const viewport = new three.Vector4();
  const cameraMatrix = new three.Matrix4();
  const cameraOrigin = new three.Vector3();
  const cameraHigh = new three.Vector3();
  const cameraLow = new three.Vector3();
  const coveredEnabled = { value: 0 };
  const coveredRampEnabled = { value: 0 };
  const compile = material.onBeforeCompile;
  const render = material.onBeforeRender;
  const cacheKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    shader.uniforms[PLANE_MATRIX] = { value: planeMatrix };
    shader.uniforms[VIEWPORT] = { value: viewport };
    shader.uniforms[CAMERA_HIGH] = { value: cameraHigh };
    shader.uniforms[CAMERA_LOW] = { value: cameraLow };
    Object.assign(shader, withXYPlaneDepth(shader, kind));
    if (covered && kind === 'fat') {
      shader.uniforms.kerfdeskCoveredStart = covered.start;
      shader.uniforms.kerfdeskCoveredEnd = covered.end;
      shader.uniforms.kerfdeskCoveredEnabled = coveredEnabled;
      shader.uniforms.kerfdeskCoveredRampEnabled = coveredRampEnabled;
      // This runs after the helper has decided whether plane depth applies.
      // The old flat guard stays separate from the stricter ramp opt-in.
      shader.vertexShader = appendMain(
        insertBefore(
          shader.vertexShader,
          MAIN,
          `uniform float kerfdeskCoveredStart;
uniform float kerfdeskCoveredEnd;
uniform float kerfdeskCoveredEnabled;
uniform float kerfdeskCoveredRampEnabled;
`,
        ),
        `
  if ( kerfdeskCoveredEnabled > 0.5 && instanceStart.z == instanceEnd.z
    && abs( ${PLANE}.z ) > 1e-8
    && float( gl_InstanceID ) >= kerfdeskCoveredStart
    && float( gl_InstanceID ) < kerfdeskCoveredEnd )
    gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );
  if ( kerfdeskCoveredRampEnabled > 0.5 && instanceStart.z != instanceEnd.z
    && ${DEPTH_PLANE_ATTRIBUTE}.z == 1.0 && abs( ${PLANE}.z ) > 1e-8
    && float( gl_InstanceID ) >= kerfdeskCoveredStart
    && float( gl_InstanceID ) < kerfdeskCoveredEnd )
    gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );
`,
      );
    }
  };
  material.customProgramCacheKey = () =>
    cacheKey + '-physical-source-plane-depth-' + kind + (covered ? '-covered-ghost-ramp-v1' : '');
  material.onBeforeRender = (renderer, scene, camera, geometry, object, group) => {
    render.call(material, renderer, scene, camera, geometry, object, group);
    planeMatrix.copy(camera.projectionMatrix).invert().transpose();
    cameraMatrix.copy(object.modelViewMatrix).invert();
    cameraOrigin.setFromMatrixPosition(cameraMatrix);
    cameraHigh.set(
      Math.fround(cameraOrigin.x),
      Math.fround(cameraOrigin.y),
      Math.fround(cameraOrigin.z),
    );
    cameraLow.set(
      Math.fround(cameraOrigin.x - cameraHigh.x),
      Math.fround(cameraOrigin.y - cameraHigh.y),
      Math.fround(cameraOrigin.z - cameraHigh.z),
    );
    // Current viewport is in drawing-buffer pixels, including target/window and DPR.
    renderer.getCurrentViewport(viewport);
    coveredEnabled.value = covered?.eligible(geometry) ? 1 : 0;
    coveredRampEnabled.value = covered?.rampEligible?.(renderer, geometry, object) ? 1 : 0;
  };
}
