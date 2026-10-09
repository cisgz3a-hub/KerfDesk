// The cropped ID pass compares eye distance directly. Converting a physical
// plane to perspective NDC first can round distinct nearby moves to one depth.
import type * as ThreeNamespace from 'three';
import { installXYPlaneDepth } from './line-plane-depth';
import { insertBefore, MAIN, type ShaderSource } from './line-shader-edits';
import type { ViewCamera } from './scene-setup';

const EYE_PLANE = 'vKerfdeskPickEyePlane';
const RANGE = 'kerfdeskPickClipRange';
const PERSPECTIVE = 'kerfdeskPickPerspective';
const PLANE_MATRIX = 'kerfdeskXYPlaneMatrix';

function appendMain(source: string, body: string): string {
  const end = source.lastIndexOf('}');
  return end < 0 ? source : source.slice(0, end) + body + source.slice(end);
}

/** Compose after the physical plane helper; keep its original clipping. */
export function withLinearPickDepth(shader: ShaderSource): ShaderSource {
  if (
    !shader.vertexShader.includes('vec3 kerfdeskDepthNormalEye =') ||
    !shader.fragmentShader.includes('gl_FragDepth = planeDepth;')
  )
    return shader;
  const declaration = `flat varying vec4 ${EYE_PLANE};\n`;
  return {
    vertexShader: appendMain(
      insertBefore(shader.vertexShader, MAIN, declaration + `invariant ${EYE_PLANE};\n`),
      `\n  ${EYE_PLANE} = vec4( kerfdeskDepthNormalEye,
    kerfdeskDepthLocalOffset - dot( kerfdeskDepthNormal, kerfdeskDepthOriginDelta ) );\n`,
    ),
    fragmentShader: appendMain(
      insertBefore(
        shader.fragmentShader,
        MAIN,
        declaration +
          `uniform mat4 ${PLANE_MATRIX};\nuniform vec2 ${RANGE};\nuniform float ${PERSPECTIVE};\n`,
      ),
      `
  if ( abs( vKerfdeskXYPlane.z ) > 1e-8 ) {
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
    gl_FragDepth = ( pickEyeDistance - ${RANGE}.x ) / ( ${RANGE}.y - ${RANGE}.x );
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
    Object.assign(shader, withLinearPickDepth(shader));
  };
  material.onBeforeRender = (renderer, scene, camera, geometry, object, group) => {
    render.call(material, renderer, scene, camera, geometry, object, group);
    const view = camera as ViewCamera;
    range.set(view.near, view.far);
    perspective.value = 'isPerspectiveCamera' in view ? 1 : 0;
  };
  material.customProgramCacheKey = () => cacheKey + '-linear-pick-eye-depth';
}
