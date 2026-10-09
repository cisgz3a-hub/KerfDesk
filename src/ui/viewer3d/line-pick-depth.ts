// The cropped ID pass compares eye distance directly. Converting a physical
// plane to perspective NDC first can round distinct nearby moves to one depth.
import type * as ThreeNamespace from 'three';
import { installXYPlaneDepth } from './line-plane-depth';
import { DEPTH_PLANE_ATTRIBUTE, DEPTH_PLANE_ORIGIN_ATTRIBUTE } from './line-depth-plane-geometry';
import { PICK_SOURCE_AXIS_ATTRIBUTE, PICK_SOURCE_AXIS_GLSL } from './line-pick-source-axis';
import { insertBefore, MAIN, type ShaderSource } from './line-shader-edits';
import type { ViewCamera } from './scene-setup';

const EYE_PLANE = 'vKerfdeskPickEyePlane';
const CLIP_Z = 'vKerfdeskPickPlaneZ';
const RANGE = 'kerfdeskPickClipRange';
const PERSPECTIVE = 'kerfdeskPickPerspective';
const PLANE_MATRIX = 'kerfdeskXYPlaneMatrix';

function appendMain(source: string, body: string): string {
  const end = source.lastIndexOf('}');
  return end < 0 ? source : source.slice(0, end) + body + source.slice(end);
}

function withPickVertex(source: string, kind: 'fat' | 'native'): string {
  const axisDeclaration =
    kind === 'fat' ? PICK_SOURCE_AXIS_GLSL : `attribute vec3 ${PICK_SOURCE_AXIS_ATTRIBUTE};\n`;
  const axis =
    kind === 'fat'
      ? 'kerfdeskPickFullSourceAxis( instanceStart, instanceEnd )'
      : PICK_SOURCE_AXIS_ATTRIBUTE;
  return appendMain(
    insertBefore(
      source,
      MAIN,
      `flat varying vec4 ${EYE_PLANE};\nflat varying float ${CLIP_Z};\n` +
        `invariant ${EYE_PLANE};\ninvariant ${CLIP_Z};\n` +
        axisDeclaration +
        `uniform float ${PERSPECTIVE};\n`,
    ),
    `
  ${EYE_PLANE} = vec4( kerfdeskDepthNormalEye,
    kerfdeskDepthLocalOffset - dot( kerfdeskDepthNormal, kerfdeskDepthOriginDelta ) );
  ${CLIP_Z} = vKerfdeskXYPlane.z;
  // The visible pass keeps raster fallback. Only the ID pass chooses this
  // second physical plane through the full stored source axis and origin.
  bool pickSourcePlaneKnown = ${DEPTH_PLANE_ATTRIBUTE}.z == 1.0
    || ( all( equal( ${DEPTH_PLANE_ATTRIBUTE}.xyz, vec3( 0.0 ) ) )
      && ${DEPTH_PLANE_ORIGIN_ATTRIBUTE}.w == 1.0 );
  if ( !( abs( ${CLIP_Z} ) > 1e-8 ) && pickSourcePlaneKnown ) {
    vec3 pickSourceAxis = ${axis};
    float pickAxisSquared = dot( pickSourceAxis, pickSourceAxis );
    if ( pickAxisSquared > 0.0 ) {
      vec3 pickViewRay = ${PERSPECTIVE} > 0.5
        ? kerfdeskDepthOriginDelta : vec3( 0.0, 0.0, 1.0 ) * normalMatrix;
      vec3 pickFacingNormal = pickViewRay - pickSourceAxis
        * ( dot( pickViewRay, pickSourceAxis ) / pickAxisSquared );
      vec3 pickFacingNormalEye = normalMatrix * pickFacingNormal;
      vec4 pickFacingEyePlane = vec4( pickFacingNormalEye,
        -dot( pickFacingNormal, kerfdeskDepthOriginDelta ) );
      float pickFacingClipZ = ( ${PLANE_MATRIX} * pickFacingEyePlane ).z;
      if ( abs( pickFacingClipZ ) > 1e-8
        && !any( isnan( pickFacingEyePlane ) ) && !any( isinf( pickFacingEyePlane ) )
        && !isnan( pickFacingClipZ ) && !isinf( pickFacingClipZ ) ) {
        ${EYE_PLANE} = pickFacingEyePlane;
        ${CLIP_Z} = pickFacingClipZ;
      }
    }
  }
`,
  );
}

/** Compose after the physical plane helper; keep its original clipping. */
export function withLinearPickDepth(shader: ShaderSource, kind: 'fat' | 'native'): ShaderSource {
  if (
    !shader.vertexShader.includes('vec3 kerfdeskDepthNormalEye =') ||
    !shader.fragmentShader.includes('gl_FragDepth = planeDepth;')
  )
    return shader;
  const declaration = `flat varying vec4 ${EYE_PLANE};\nflat varying float ${CLIP_Z};\n`;
  // Test the original visible writer's depth before converting the ID encoding.
  // Native travel uses LESS against clear depth 1; internal ID ties remain LEQUAL.
  const nativeVisibleFar = kind === 'native' ? '\n  if ( !( gl_FragDepth < 1.0 ) ) discard;\n' : '';
  return {
    vertexShader: withPickVertex(shader.vertexShader, kind),
    fragmentShader: appendMain(
      insertBefore(
        shader.fragmentShader,
        MAIN,
        declaration +
          `uniform mat4 ${PLANE_MATRIX};\nuniform vec2 ${RANGE};\nuniform float ${PERSPECTIVE};\n`,
      ),
      nativeVisibleFar +
        `
  if ( abs( ${CLIP_Z} ) > 1e-8 ) {
    vec2 pickNdc = ( gl_FragCoord.xy - kerfdeskDepthViewport.xy ) / kerfdeskDepthViewport.zw * 2.0 - 1.0;
    float pickEyeDistance;
    if ( ${PERSPECTIVE} > 0.5 ) {
      vec4 pickRayH = transpose( ${PLANE_MATRIX} ) * vec4( pickNdc, 1.0, 1.0 );
      vec3 pickRay = pickRayH.xyz / -pickRayH.z;
      pickEyeDistance = -${EYE_PLANE}.w / dot( ${EYE_PLANE}.xyz, pickRay );
    } else {
      vec4 pickPointH = transpose( ${PLANE_MATRIX} ) * vec4( pickNdc, 0.0, 1.0 );
      vec2 pickXY = pickPointH.xy / pickPointH.w;
      pickEyeDistance = ( dot( ${EYE_PLANE}.xy, pickXY ) + ${EYE_PLANE}.w ) / ${EYE_PLANE}.z;
    }
    float pickDepth = ( pickEyeDistance - ${RANGE}.x ) / ( ${RANGE}.y - ${RANGE}.x );
    // The alternate physical plane also obeys the original camera range.
    if ( !( pickDepth >= 0.0 && pickDepth <= 1.0 ) ) discard;
    gl_FragDepth = pickDepth;
  } else if ( ${PERSPECTIVE} > 0.5 ) {
    gl_FragDepth = ${RANGE}.x * gl_FragCoord.z /
      ( ${RANGE}.x + ( 1.0 - gl_FragCoord.z ) * ( ${RANGE}.y - ${RANGE}.x ) );
  }
`,
    ),
  };
}

/** Both ID writers use one monotone depth encoding with the current camera. */
export function installPickDepth(
  three: typeof ThreeNamespace,
  material: ThreeNamespace.Material,
  kind: 'fat' | 'native',
): void {
  installXYPlaneDepth(three, material, kind);
  const range = new three.Vector2();
  const perspective = { value: 0 };
  const compile = material.onBeforeCompile;
  const render = material.onBeforeRender;
  const cacheKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    shader.uniforms[RANGE] = { value: range };
    shader.uniforms[PERSPECTIVE] = perspective;
    Object.assign(shader, withLinearPickDepth(shader, kind));
  };
  material.onBeforeRender = (renderer, scene, camera, geometry, object, group) => {
    render.call(material, renderer, scene, camera, geometry, object, group);
    const view = camera as ViewCamera;
    range.set(view.near, view.far);
    perspective.value = 'isPerspectiveCamera' in view ? 1 : 0;
  };
  material.customProgramCacheKey = () =>
    cacheKey + '-linear-pick-eye-depth-source-axis-f32-visible-far-v3-' + kind;
}
