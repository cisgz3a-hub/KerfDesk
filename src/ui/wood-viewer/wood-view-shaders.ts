// wood-view-shaders — the standalone V-carve preview's GLSL, ported verbatim
// (ADR-285). This is raw WebGL2, NOT three.js: the renderer owns its whole
// scene, which is what makes the result identical to the reference page rather
// than an approximation of it layered onto another scene's lighting.
//
// Kept in its own module because ESLint's max-lines counts every non-blank line
// inside a template literal.
//
// PURE: string constants only.

/** Procedural 3-D wood. Grain belongs to the LOG, so grooves cut through it. */
const WOOD_GLSL = `
uniform vec3 uEarly; uniform vec3 uLate; uniform float uRingFreq;
uniform float uRingSharp; uniform float uGrainWarp; uniform float uPore;
uniform float uLogY; uniform float uLogZ;
float h31(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123); }
float vnoise(vec3 p){
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float n000 = h31(i + vec3(0.0,0.0,0.0)); float n100 = h31(i + vec3(1.0,0.0,0.0));
  float n010 = h31(i + vec3(0.0,1.0,0.0)); float n110 = h31(i + vec3(1.0,1.0,0.0));
  float n001 = h31(i + vec3(0.0,0.0,1.0)); float n101 = h31(i + vec3(1.0,0.0,1.0));
  float n011 = h31(i + vec3(0.0,1.0,1.0)); float n111 = h31(i + vec3(1.0,1.0,1.0));
  return mix(mix(mix(n000,n100,f.x), mix(n010,n110,f.x), f.y),
             mix(mix(n001,n101,f.x), mix(n011,n111,f.x), f.y), f.z);
}
float fbm(vec3 p){
  float s = 0.0; float a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}
float ringCoord(vec3 p){
  float r = length(vec2(p.y - uLogY, p.z - uLogZ));
  r += fbm(p * vec3(0.035, 0.055, 0.055)) * uGrainWarp;
  r += fbm(p * vec3(0.011, 0.02, 0.02)) * uGrainWarp * 2.2;
  return r;
}
vec3 woodAlbedo(vec3 p, out float rough){
  float rc = ringCoord(p);
  float band = 0.5 + 0.5 * sin(rc * uRingFreq * 6.2831853);
  band = pow(clamp(band, 0.0, 1.0), uRingSharp);
  float fiber = fbm(vec3(p.x * 0.22, p.y * 3.6, p.z * 3.6));
  vec3 col = mix(uEarly, uLate, band);
  col *= 0.90 + 0.20 * fiber;
  float pore = fbm(vec3(p.x * 0.75, p.y * 8.5, p.z * 8.5));
  float pores = smoothstep(0.70, 0.86, pore) * uPore * (0.35 + 0.65 * band);
  col *= 1.0 - pores * 0.55;
  rough = clamp(0.42 + 0.30 * band + pores * 0.5, 0.12, 0.95);
  return col;
}
`;

const COMMON_UNIFORMS = `
uniform vec2 uBoard; uniform float uMaxDepth; uniform float uThick;
uniform vec3 uEye; uniform vec3 uLightDir; uniform float uPaint; uniform vec3 uPaintCol;
uniform float uFresh;
`;

const TONEMAP_GLSL = `
vec3 tonemap(vec3 x){
  x = max(vec3(0.0), x);
  vec3 a = x * (2.51 * x + 0.03); vec3 b = x * (2.43 * x + 0.59) + 0.14;
  return pow(clamp(a / b, 0.0, 1.0), vec3(1.0 / 2.2));
}
vec3 shade(vec3 albedo, float rough, vec3 n, vec3 wp, float shadow, float ao){
  vec3 v = normalize(uEye - wp);
  vec3 l = uLightDir;
  vec3 h = normalize(l + v);
  float ndl = max(dot(n, l), 0.0);
  float ndh = max(dot(n, h), 0.0);
  float a = rough * rough;
  float d = a * a / (3.14159265 * pow(ndh * ndh * (a * a - 1.0) + 1.0, 2.0) + 1e-5);
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(h, v), 0.0), 5.0);
  vec3 spec = vec3(d * fres * 0.10);
  vec3 key = vec3(1.0, 0.945, 0.87) * 1.28 * ndl * shadow;
  vec3 fillL = vec3(0.62, 0.70, 0.86) * 0.26 * max(dot(n, normalize(vec3(-0.4, -0.5, 0.6))), 0.0);
  vec3 amb = vec3(0.40, 0.42, 0.47) * 0.55 * ao * (0.55 + 0.45 * n.z);
  return albedo * (key + fillL + amb) + spec * shadow * ao;
}
`;

/** Displaced-grid vertex stage for the machined surface. */
export const SURFACE_VERTEX_GLSL = [
  '#version 300 es',
  'precision highp float; precision highp sampler2D;',
  'in vec2 aUv;',
  'uniform sampler2D uHeight;',
  'uniform mat4 uViewProj;',
  'uniform vec2 uBoard; uniform float uMaxDepth;',
  'out vec2 vUv; out vec3 vWorld;',
  'void main(){',
  '  vUv = aUv;',
  '  float d = textureLod(uHeight, aUv, 0.0).r;',
  // The removal grid's row axis points DOWN the canvas, so v is mirrored into
  // world Y; without it the board renders upside down and the text reads
  // backwards. uvOf() in the fragment stage inverts the same way.
  '  vec3 w = vec3((aUv.x - 0.5) * uBoard.x, (0.5 - aUv.y) * uBoard.y, -d);',
  '  vWorld = w;',
  '  gl_Position = uViewProj * vec4(w, 1.0);',
  '}',
].join('\n');

/** Machined surface: grain, marched shadow, horizon occlusion, optional fill. */
export const SURFACE_FRAGMENT_GLSL = [
  '#version 300 es',
  'precision highp float; precision highp sampler2D;',
  'in vec2 vUv; in vec3 vWorld;',
  'uniform sampler2D uHeight;',
  'uniform vec2 uTexel;',
  COMMON_UNIFORMS,
  WOOD_GLSL,
  TONEMAP_GLSL,
  'out vec4 frag;',
  'float depthAt(vec2 uv){ return texture(uHeight, clamp(uv, vec2(0.0), vec2(1.0))).r; }',
  'vec2 uvOf(vec2 xy){ return vec2(xy.x / uBoard.x + 0.5, 0.5 - xy.y / uBoard.y); }',
  'float shadowMarch(vec3 p, vec3 l){',
  '  if (l.z <= 0.02) return 0.0;',
  '  float sh = 1.0; float t = 0.06;',
  '  for (int i = 0; i < 40; i++){',
  '    vec3 q = p + l * t;',
  '    vec2 uv = uvOf(q.xy);',
  '    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;',
  '    float surf = -depthAt(uv);',
  '    float gap = q.z - surf;',
  '    if (gap < 0.0) return 0.0;',
  '    sh = min(sh, 9.0 * gap / t);',
  '    t += 0.115;',
  '  }',
  '  return clamp(sh, 0.0, 1.0);',
  '}',
  'float horizonAo(vec3 p){',
  '  float occ = 0.0;',
  '  for (int d = 0; d < 8; d++){',
  '    float a = (float(d) + 0.5) * 0.7853981634;',
  '    vec2 dir = vec2(cos(a), sin(a));',
  '    float best = 0.0;',
  '    for (int s = 1; s <= 6; s++){',
  '      float r = float(s) * 0.26;',
  '      float surf = -depthAt(uvOf(p.xy + dir * r));',
  '      best = max(best, (surf - p.z) / r);',
  '    }',
  '    occ += best / sqrt(1.0 + best * best);',
  '  }',
  '  return clamp(1.0 - occ / 8.0, 0.0, 1.0);',
  '}',
  'void main(){',
  '  float dC = depthAt(vUv);',
  '  float dL = depthAt(vUv - vec2(uTexel.x, 0.0));',
  '  float dR = depthAt(vUv + vec2(uTexel.x, 0.0));',
  '  float dD = depthAt(vUv - vec2(0.0, uTexel.y));',
  '  float dU = depthAt(vUv + vec2(0.0, uTexel.y));',
  '  float mmx = 2.0 * uTexel.x * uBoard.x;',
  '  float mmy = 2.0 * uTexel.y * uBoard.y;',
  // World Y is mirrored from v (see the vertex stage), so the Y gradient must
  // be negated too. Leaving it positive lit every groove wall as though it
  // faced the opposite way.
  '  vec3 n = normalize(vec3((dR - dL) / mmx, -(dU - dD) / mmy, 1.0));',
  '  vec3 p = vec3(vWorld.xy, -dC);',
  '  float rough;',
  '  vec3 albedo = woodAlbedo(p, rough);',
  '  float cut = smoothstep(0.02, 0.45, dC);',
  '  albedo = mix(albedo * 0.88, albedo * uFresh, cut);',
  '  rough = mix(rough * 0.72, min(0.95, rough * 1.25), cut);',
  '  float ao = horizonAo(p);',
  '  float sh = shadowMarch(p, uLightDir);',
  '  vec3 col = shade(albedo, rough, n, p, sh, ao);',
  '  if (uPaint > 0.5) {',
  '    float m = smoothstep(0.06, 0.30, dC);',
  '    vec3 pc = shade(uPaintCol, 0.55, n, p, sh, ao * 0.85);',
  '    col = mix(col, pc, m);',
  '  }',
  '  frag = vec4(tonemap(col), 1.0);',
  '}',
].join('\n');

/** The board's sawn edges. */
export const SIDE_VERTEX_GLSL = [
  '#version 300 es',
  'precision highp float;',
  'in vec3 aPos; in vec3 aNrm;',
  'uniform mat4 uViewProj;',
  'out vec3 vWorld; out vec3 vNrm;',
  'void main(){ vWorld = aPos; vNrm = aNrm; gl_Position = uViewProj * vec4(aPos, 1.0); }',
].join('\n');

export const SIDE_FRAGMENT_GLSL = [
  '#version 300 es',
  'precision highp float;',
  'in vec3 vWorld; in vec3 vNrm;',
  COMMON_UNIFORMS,
  WOOD_GLSL,
  TONEMAP_GLSL,
  'out vec4 frag;',
  'void main(){',
  '  float rough;',
  '  vec3 albedo = woodAlbedo(vWorld, rough);',
  '  albedo *= 0.80;',
  '  vec3 col = shade(albedo, min(0.95, rough * 1.2), normalize(vNrm), vWorld, 1.0, 0.72);',
  '  frag = vec4(tonemap(col), 1.0);',
  '}',
].join('\n');

/** Full-screen gradient backdrop. */
export const BACKGROUND_VERTEX_GLSL = [
  '#version 300 es',
  'precision highp float;',
  'out vec2 vP;',
  'void main(){',
  '  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);',
  '  vP = p; gl_Position = vec4(p, 0.999999, 1.0);',
  '}',
].join('\n');

export const BACKGROUND_FRAGMENT_GLSL = [
  '#version 300 es',
  'precision highp float;',
  'in vec2 vP; uniform vec3 uTop; uniform vec3 uBot;',
  'out vec4 frag;',
  'void main(){',
  '  float t = clamp(vP.y * 0.5 + 0.5, 0.0, 1.0);',
  '  vec3 c = mix(uBot, uTop, t);',
  '  c *= 1.0 - 0.085 * dot(vP, vP);',
  '  frag = vec4(pow(max(c, 0.0), vec3(1.0 / 2.2)), 1.0);',
  '}',
].join('\n');
