// The active move's ghost starts at the drawn Float32 playhead and skips its
// core-tip coverage. Simplified geometry retains its full ghost stroke.
import type * as ThreeNamespace from 'three';
import { insertAfter, MAIN } from './line-shader-edits';

export type GhostTailState = {
  readonly index: { value: number };
  readonly point: { value: ThreeNamespace.Vector3 };
  readonly coreWidthCSS: { value: number };
  /** Defaults on; a comparison fixture may retain the historic whole ghost. */
  readonly enabled?: { value: boolean };
};

const TIP = 'vKerfdeskGhostCoreTip';
const DECLARATIONS = `uniform float kerfdeskGhostTailEnabled;
uniform float kerfdeskGhostActiveIndex;
uniform vec3 kerfdeskGhostActivePoint;
uniform vec4 kerfdeskGhostViewport;
flat varying vec3 ${TIP};
`;
const START = `
  ${TIP} = vec3( 0.0 );
  vec3 kerfdeskGhostStart = instanceStart;
  if ( kerfdeskGhostTailEnabled > 0.5
    && float( gl_InstanceID ) == kerfdeskGhostActiveIndex ) {
    kerfdeskGhostStart = kerfdeskGhostActivePoint;
    if ( all( equal( kerfdeskGhostStart, instanceEnd ) ) ) {
      gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );
      return;
    }
    vec4 cameraTip = modelViewMatrix * vec4( kerfdeskGhostActivePoint, 1.0 );
    vec4 clipTip = projectionMatrix * cameraTip;
    if ( clipTip.w > 0.0 && abs( clipTip.z ) <= clipTip.w ) {
      vec2 ndcTip = clipTip.xy / clipTip.w;
      ${TIP} = vec3( kerfdeskGhostViewport.xy
        + ( ndcTip * 0.5 + 0.5 ) * kerfdeskGhostViewport.zw, 1.0 );
    }
  }
`;
const CAP_DECLARATIONS = `uniform float kerfdeskGhostCoreWidthCSS;
uniform vec2 kerfdeskGhostCoreScale;
flat varying vec3 ${TIP};
`;
const CAP = `
  if ( ${TIP}.z > 0.5 && kerfdeskGhostCoreWidthCSS > 0.0
    && all( greaterThan( kerfdeskGhostCoreScale, vec2( 0.0 ) ) ) ) {
    // Every MSAA sample in a pixel gets the same conservative decision.
    vec2 pixelMin = floor( gl_FragCoord.xy );
    vec2 nearest = clamp( ${TIP}.xy, pixelMin, pixelMin + vec2( 1.0 ) );
    vec2 delta = ( ${TIP}.xy - nearest ) / kerfdeskGhostCoreScale;
    float radius = kerfdeskGhostCoreWidthCSS * 0.5;
    if ( dot( delta, delta ) <= radius * radius ) discard;
  }
`;

/** Install before depth edits: they must still classify the source endpoints. */
export function installGhostTail(
  three: typeof ThreeNamespace,
  material: ThreeNamespace.Material,
  fullGeometry: ThreeNamespace.BufferGeometry,
  state: GhostTailState,
): void {
  const eligible = { value: 0 };
  const viewport = { value: new three.Vector4() };
  const scale = { value: new three.Vector2() };
  const logical = new three.Vector4();
  const compile = material.onBeforeCompile;
  const render = material.onBeforeRender;
  const cacheKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    shader.uniforms.kerfdeskGhostTailEnabled = eligible;
    shader.uniforms.kerfdeskGhostActiveIndex = state.index;
    shader.uniforms.kerfdeskGhostActivePoint = state.point;
    shader.uniforms.kerfdeskGhostCoreWidthCSS = state.coreWidthCSS;
    shader.uniforms.kerfdeskGhostViewport = viewport;
    shader.uniforms.kerfdeskGhostCoreScale = scale;
    const source = shader.vertexShader;
    const at = source.indexOf(MAIN);
    const fragment = shader.fragmentShader.indexOf(MAIN);
    if (at < 0 || fragment < 0) return;
    const end = at + MAIN.length;
    // Keep the attribute and any helper outside main under their GPU names.
    const body = source.slice(end).replace(/\binstanceStart\b/g, 'kerfdeskGhostStart');
    shader.vertexShader = source.slice(0, at) + DECLARATIONS + MAIN + START + body;
    shader.fragmentShader = insertAfter(
      shader.fragmentShader.slice(0, fragment) +
        CAP_DECLARATIONS +
        shader.fragmentShader.slice(fragment),
      MAIN,
      CAP,
    );
  };
  material.customProgramCacheKey = () => cacheKey + '-ghost-tail-core-cap';
  material.onBeforeRender = (renderer, scene, camera, geometry, object, group) => {
    render.call(material, renderer, scene, camera, geometry, object, group);
    eligible.value = geometry === fullGeometry && (state.enabled?.value ?? true) ? 1 : 0;
    scale.value.set(0, 0);
    if (!eligible.value) return;
    renderer.getCurrentViewport(viewport.value);
    // Fat-line resolution uses this logical viewport, even on a render target.
    renderer.getViewport(logical);
    if (logical.z > 0 && logical.w > 0)
      scale.value.set(viewport.value.z / logical.z, viewport.value.w / logical.w);
  };
}
