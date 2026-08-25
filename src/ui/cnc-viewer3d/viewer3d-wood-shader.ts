// viewer3d-wood-shader — the GLSL for the carved-timber surface (ADR-284).
//
// Kept in its own module because ESLint's max-lines counts every non-blank
// line inside a template literal, so shader source shares the 400-line budget
// with whatever it is pasted next to.
//
// The grain is a property of the LOG, not of the surface: rings are cylinders
// about an axis running along X and sitting below the stock, so a groove cut
// into the board reveals the ring structure underneath. That is the cue that
// separates a real carve from lettering printed on a board.
//
// Shadow and ambient occlusion march the SAME removal grid the surface mesh
// was built from, so a groove occludes itself without the scene needing shadow
// maps — which the pane's lights do not cast.
//
// PURE: string constants only. No three import, no side effects.

/** Uniform block shared by the vertex and fragment injections. */
export const WOOD_UNIFORMS_GLSL = `
// three declares normalMatrix in its VERTEX prefix only; the fragment stage
// needs its own declaration before it can carry a local normal into view
// space. The renderer still uploads it, because it sets any built-in uniform
// the linked program exposes.
uniform mat3 normalMatrix;
uniform sampler2D uCarveDepth;
uniform vec2 uCarveSizeMm;
uniform float uCarveCellMm;
uniform vec2 uCarveCells;
uniform vec2 uCarveHasPartialCell;
uniform vec3 uCarveLightDir;
uniform vec3 uGrainEarly;
uniform vec3 uGrainLate;
uniform vec2 uGrainLogCentre;
uniform float uGrainRingFreq;
uniform float uGrainSharp;
uniform float uGrainWarp;
uniform float uGrainPore;
uniform float uGrainFresh;
uniform float uCarveAoAmount;
uniform float uCarveShadowAmount;
`;

/** Declared in both stages; carries local (stock-frame) position in mm. */
export const WOOD_VARYING_GLSL = `
varying vec3 vCarveLocal;
`;

/**
 * Vertex injection. Appended after `begin_vertex`, where `transformed` holds
 * the local-space position before any instancing or morphing is applied.
 */
export const WOOD_VERTEX_BODY_GLSL = `
  vCarveLocal = transformed;
`;

// buildSurfaceGeometry bakes scale(1,-1,1) then translate(-w/2, h/2, 0) into
// the positions, so recovering the grid's own (mx, my) means inverting exactly
// that: mx = x + w/2 and my = h/2 - y. Getting this backwards mirrors the
// shading against the geometry and the grain slides the wrong way when the
// operator orbits.
const SAMPLING_GLSL = `
vec2 carveGridMm(vec2 localXy) {
  return vec2(
    localXy.x + uCarveSizeMm.x * 0.5,
    uCarveSizeMm.y * 0.5 - localXy.y
  );
}

float carveAxisUv(float coordinateMm, float extentMm, float cells, float hasPartialCell) {
  if (hasPartialCell < 0.5) return coordinateMm / extentMm;
  float terminalIndex = cells - 1.0;
  float terminalStartMm = terminalIndex * uCarveCellMm;
  float cellCoordinate = coordinateMm <= terminalStartMm
    ? coordinateMm / uCarveCellMm
    : terminalIndex +
      (coordinateMm - terminalStartMm) / (extentMm - terminalStartMm);
  return cellCoordinate / cells;
}

float carveDepthAt(vec2 localXy) {
  vec2 gridMm = carveGridMm(localXy);
  if (
    gridMm.x < 0.0 || gridMm.x > uCarveSizeMm.x ||
    gridMm.y < 0.0 || gridMm.y > uCarveSizeMm.y
  ) return 0.0;
  vec2 uv = vec2(
    carveAxisUv(gridMm.x, uCarveSizeMm.x, uCarveCells.x, uCarveHasPartialCell.x),
    carveAxisUv(gridMm.y, uCarveSizeMm.y, uCarveCells.y, uCarveHasPartialCell.y)
  );
  return texture2D(uCarveDepth, uv).r;
}
`;

const NOISE_GLSL = `
float carveHash(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
}

float carveNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = carveHash(i + vec3(0.0, 0.0, 0.0));
  float n100 = carveHash(i + vec3(1.0, 0.0, 0.0));
  float n010 = carveHash(i + vec3(0.0, 1.0, 0.0));
  float n110 = carveHash(i + vec3(1.0, 1.0, 0.0));
  float n001 = carveHash(i + vec3(0.0, 0.0, 1.0));
  float n101 = carveHash(i + vec3(1.0, 0.0, 1.0));
  float n011 = carveHash(i + vec3(0.0, 1.0, 1.0));
  float n111 = carveHash(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z
  );
}

float carveFbm(vec3 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += amp * carveNoise(p);
    p *= 2.03;
    amp *= 0.5;
  }
  return sum;
}
`;

const GRAIN_GLSL = `
float carveRingCoord(vec3 p) {
  float r = length(vec2(p.y - uGrainLogCentre.x, p.z - uGrainLogCentre.y));
  r += carveFbm(p * vec3(0.035, 0.055, 0.055)) * uGrainWarp;
  r += carveFbm(p * vec3(0.011, 0.02, 0.02)) * uGrainWarp * 2.2;
  return r;
}

vec3 carveWoodAlbedo(vec3 p, out float roughOut) {
  float band = 0.5 + 0.5 * sin(carveRingCoord(p) * uGrainRingFreq * 6.2831853);
  band = pow(clamp(band, 0.0, 1.0), uGrainSharp);
  vec3 col = mix(uGrainEarly, uGrainLate, band);
  col *= 0.90 + 0.20 * carveFbm(vec3(p.x * 0.22, p.y * 3.6, p.z * 3.6));
  float pore = carveFbm(vec3(p.x * 0.75, p.y * 8.5, p.z * 8.5));
  float pores = smoothstep(0.70, 0.86, pore) * uGrainPore * (0.35 + 0.65 * band);
  col *= 1.0 - pores * 0.55;
  roughOut = clamp(0.42 + 0.30 * band + pores * 0.5, 0.12, 0.95);
  return col;
}
`;

// A groove barely 3 mm wide is read almost entirely from how it shades itself.
// Both marches walk the depth field in millimetres, so their step sizes are
// physical and do not need rescaling when the grid resolution changes.
const OCCLUSION_GLSL = `
float carveShadow(vec3 p, vec3 l) {
  if (l.z <= 0.02) return 1.0;
  float sh = 1.0;
  float t = 0.08;
  for (int i = 0; i < 24; i++) {
    vec3 q = p + l * t;
    float gap = q.z + carveDepthAt(q.xy);
    if (gap < 0.0) return 0.0;
    sh = min(sh, 9.0 * gap / t);
    t += 0.16;
  }
  return clamp(sh, 0.0, 1.0);
}

float carveAo(vec3 p) {
  float occ = 0.0;
  for (int d = 0; d < 6; d++) {
    float a = (float(d) + 0.5) * 1.0471975512;
    vec2 dir = vec2(cos(a), sin(a));
    float best = 0.0;
    for (int s = 1; s <= 5; s++) {
      float r = float(s) * 0.30;
      float surf = -carveDepthAt(p.xy + dir * r);
      best = max(best, (surf - p.z) / r);
    }
    occ += best / sqrt(1.0 + best * best);
  }
  return clamp(1.0 - occ / 6.0, 0.0, 1.0);
}
`;

/** Helper functions for the fragment stage, in dependency order. */
export const WOOD_FUNCTIONS_GLSL = SAMPLING_GLSL + NOISE_GLSL + GRAIN_GLSL + OCCLUSION_GLSL;

// Declared without a wrapping block so `carveRough`, `carveAoValue` and
// `carveShadowValue` stay in scope for the later chunk injections — every
// three.js chunk is inlined into the same main().
export const WOOD_ALBEDO_BODY_GLSL = `
  float carveCutDepth = max(0.0, -vCarveLocal.z);
  float carveRough;
  vec3 carveAlbedo = carveWoodAlbedo(vCarveLocal, carveRough);
  float carveCut = smoothstep(0.02, 0.45, carveCutDepth);
  carveAlbedo = mix(carveAlbedo * 0.88, carveAlbedo * uGrainFresh, carveCut);
  carveRough = mix(carveRough * 0.72, min(0.95, carveRough * 1.25), carveCut);
  vec3 carveSurfacePoint = vec3(vCarveLocal.xy, -carveCutDepth);
  float carveAoValue = mix(1.0, carveAo(carveSurfacePoint), uCarveAoAmount);
  float carveShadowValue =
    mix(1.0, carveShadow(carveSurfacePoint, uCarveLightDir), uCarveShadowAmount);
  diffuseColor.rgb = carveAlbedo;
`;

// steppedSurfaceMesh authors a vertical wall per cell, which is right for an
// end mill's pocket wall and wrong for a V-groove: at cell resolution the
// flanks read as a visible staircase. Shading from the DEPTH FIELD's gradient
// instead recovers the true flank angle, at the cost of rounding a genuine
// vertical wall over roughly one cell. `normal` is in view space here, so the
// local gradient goes through normalMatrix.
export const WOOD_NORMAL_BODY_GLSL = `
  float carveStep = max(uCarveCellMm, 1e-4);
  float carveDx =
    carveDepthAt(vCarveLocal.xy + vec2(carveStep, 0.0)) -
    carveDepthAt(vCarveLocal.xy - vec2(carveStep, 0.0));
  float carveDy =
    carveDepthAt(vCarveLocal.xy + vec2(0.0, carveStep)) -
    carveDepthAt(vCarveLocal.xy - vec2(0.0, carveStep));
  vec3 carveLocalNormal =
    normalize(vec3(carveDx / (2.0 * carveStep), carveDy / (2.0 * carveStep), 1.0));
  normal = normalize(normalMatrix * carveLocalNormal);
`;

/** Applied after `roughnessmap_fragment`, which declares `roughnessFactor`. */
export const WOOD_ROUGHNESS_BODY_GLSL = `
  roughnessFactor = carveRough;
`;

// Applied after lights_fragment_end rather than through aomap_fragment: the
// direct terms need the marched shadow, which no built-in chunk supplies.
export const WOOD_LIGHTING_BODY_GLSL = `
  reflectedLight.directDiffuse *= carveShadowValue;
  reflectedLight.directSpecular *= carveShadowValue;
  reflectedLight.indirectDiffuse *= carveAoValue;
  reflectedLight.indirectSpecular *= carveAoValue;
`;

/** The three.js chunks the material replaces, so a version bump fails loudly. */
export const WOOD_REQUIRED_CHUNKS = [
  '#include <begin_vertex>',
  '#include <map_fragment>',
  '#include <normal_fragment_begin>',
  '#include <roughnessmap_fragment>',
  '#include <lights_fragment_end>',
] as const;
