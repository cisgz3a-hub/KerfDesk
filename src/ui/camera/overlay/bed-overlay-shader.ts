// The camera-over-bed overlay as a fragment shader (ADR-440). Every workspace
// pixel asks the camera model which camera pixel sees the bed point under it,
// at the material's surface height, and samples the live frame there. Running
// the full model per pixel is what lets the overlay undo lens distortion and
// parallax exactly; the CSS matrix3d it replaces could only apply one
// homography, which no fisheye lens obeys.
//
// Pure: GLSL source, uniform packing and a CPU mirror of the fragment maths.
// The mirror exists so tests can hold the shader to the camera model itself
// (projectWorldPoint) rather than to a restatement of it.

import { bedPoint, type CameraPose, type LensModel } from '../../../core/camera/model/camera-model';
import type { FisheyeDistortion } from '../../../core/camera/fisheye';
import type { Mat3 } from '../../../core/camera/homography';
import { rodriguesToMatrix } from '../../../core/camera/rodrigues';
import type { ViewTransform } from '../../workspace/view-transform';

type Pair = readonly [number, number];
type Triple = readonly [number, number, number];
type Quad = readonly [number, number, number, number];
/** A 3x3 matrix in GLSL's column-major order: element (row i, column j) is at [j*3 + i]. */
type ColumnMajorMat3 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/**
 * Everything the fragment shader reads, keyed by its GLSL uniform name. Values
 * stay float64 here so the CPU mirror is exact; WebGL narrows them on upload.
 */
export type BedOverlayUniforms = {
  /** Overlay backing store (device px): width, height. The shader flips y with the height. */
  readonly uCanvasSize: Pair;
  /** Device px per CSS px. */
  readonly uPixelRatio: number;
  /** Workspace view (CSS px): canvasPx = offset + mm * scale. */
  readonly uViewScale: number;
  readonly uViewOffset: Pair;
  /** Bed rectangle in mm: the overlay draws only inside [0, w] x [0, h]. */
  readonly uBedSize: Pair;
  /** World z of the surface being viewed (z points into the bed, so -height). */
  readonly uSurfaceZ: number;
  /** World-to-camera rotation, column-major (see ColumnMajorMat3). */
  readonly uRotation: ColumnMajorMat3;
  /** World-to-camera translation, mm. */
  readonly uTranslation: Triple;
  /** Pinhole intrinsics in pixels of the uploaded frame. */
  readonly uFocal: Pair;
  readonly uPrincipal: Pair;
  /** Kannala-Brandt k1..k4. */
  readonly uDistortion: Quad;
  /** Pixel size of the frame the intrinsics are expressed in. */
  readonly uFrameSize: Pair;
  /** 0..1; the output is premultiplied by it. */
  readonly uOpacity: number;
};

export type BedOverlayUniformKind = 'float' | 'vec2' | 'vec3' | 'vec4' | 'mat3';

/** GLSL type of each packed uniform, so the renderer can upload them generically. */
export const BED_OVERLAY_UNIFORM_KINDS = {
  uCanvasSize: 'vec2',
  uPixelRatio: 'float',
  uViewScale: 'float',
  uViewOffset: 'vec2',
  uBedSize: 'vec2',
  uSurfaceZ: 'float',
  uRotation: 'mat3',
  uTranslation: 'vec3',
  uFocal: 'vec2',
  uPrincipal: 'vec2',
  uDistortion: 'vec4',
  uFrameSize: 'vec2',
  uOpacity: 'float',
} as const satisfies Record<keyof BedOverlayUniforms, BedOverlayUniformKind>;

/** The frame texture's sampler; the renderer binds it to unit 0. */
export const BED_OVERLAY_FRAME_SAMPLER = 'uFrame';

// One triangle whose corners sit at (-1,-1), (3,-1), (-1,3) covers the whole
// clip square, so there is no vertex buffer and no diagonal seam.
export const BED_OVERLAY_VERTEX_SHADER = `#version 300 es
precision highp float;

void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

// Output is PREMULTIPLIED alpha (rgb * opacity, opacity), matching the WebGL
// canvas default premultipliedAlpha: true, so the page compositor blends it over
// the workspace with no extra pass. Camera frames are opaque, so the texture's
// own alpha is ignored. Constants and discards match camera-model.ts and
// fisheye.ts; bedOverlaySampleCoord below mirrors this line for line.
export const BED_OVERLAY_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D uFrame;
uniform vec2 uCanvasSize;
uniform float uPixelRatio;
uniform float uViewScale;
uniform vec2 uViewOffset;
uniform vec2 uBedSize;
uniform float uSurfaceZ;
uniform mat3 uRotation;
uniform vec3 uTranslation;
uniform vec2 uFocal;
uniform vec2 uPrincipal;
uniform vec4 uDistortion;
uniform vec2 uFrameSize;
uniform float uOpacity;

out vec4 outColor;

const float MIN_DEPTH = 1e-6;
const float RADIUS_EPSILON = 1e-9;

bool inside(vec2 p, vec2 size) {
  return p.x >= 0.0 && p.x <= size.x && p.y >= 0.0 && p.y <= size.y;
}

float fisheyeScale(float r, vec4 k) {
  if (r < RADIUS_EPSILON) return 1.0;
  float theta = atan(r);
  float t2 = theta * theta;
  float t4 = t2 * t2;
  float t6 = t4 * t2;
  float t8 = t4 * t4;
  return theta * (1.0 + k.x * t2 + k.y * t4 + k.z * t6 + k.w * t8) / r;
}

void main() {
  vec2 css = vec2(gl_FragCoord.x, uCanvasSize.y - gl_FragCoord.y) / uPixelRatio;
  vec2 bed = (css - uViewOffset) / uViewScale;
  if (!inside(bed, uBedSize)) discard;
  vec3 cam = uRotation * vec3(bed, uSurfaceZ) + uTranslation;
  if (!(cam.z > MIN_DEPTH)) discard;
  vec2 ab = cam.xy / cam.z;
  float s = fisheyeScale(length(ab), uDistortion);
  vec2 pixel = uFocal * (ab * s) + uPrincipal;
  vec2 uv = (pixel + 0.5) / uFrameSize;
  if (!inside(uv, vec2(1.0))) discard;
  outColor = vec4(texture(uFrame, uv).rgb * uOpacity, uOpacity);
}
`;

export type BedOverlayUniformArgs = {
  /** Lens already expressed at the uploaded frame's pixel size (see scaleLens). */
  readonly lens: LensModel;
  readonly pose: CameraPose;
  readonly surfaceHeightMm: number;
  readonly view: ViewTransform;
  /** Overlay canvas backing store, device px (CSS size x devicePixelRatio). */
  readonly canvasWidthPx: number;
  readonly canvasHeightPx: number;
  readonly devicePixelRatio: number;
  readonly bedWidthMm: number;
  readonly bedHeightMm: number;
  readonly opacity: number;
};

export function bedOverlayUniforms(args: BedOverlayUniformArgs): BedOverlayUniforms {
  const { lens, pose, view } = args;
  const k = lens.intrinsics;
  return {
    uCanvasSize: [backingPx(args.canvasWidthPx), backingPx(args.canvasHeightPx)],
    uPixelRatio: positiveOr(args.devicePixelRatio, 1),
    uViewScale: view.scale,
    uViewOffset: [view.offsetX, view.offsetY],
    uBedSize: [args.bedWidthMm, args.bedHeightMm],
    // Taken from the model rather than restated, so the height sign has one owner.
    uSurfaceZ: bedPoint(0, 0, args.surfaceHeightMm).z,
    uRotation: columnMajor(rodriguesToMatrix(pose.rvec)),
    uTranslation: [pose.tvec[0], pose.tvec[1], pose.tvec[2]],
    uFocal: [k.fx, k.fy],
    uPrincipal: [k.cx, k.cy],
    uDistortion: [...lens.distortion],
    uFrameSize: [lens.imageWidth, lens.imageHeight],
    uOpacity: clampUnit(args.opacity),
  };
}

export type BedOverlayTexCoord = { readonly u: number; readonly v: number };

const MIN_DEPTH = 1e-6;
const RADIUS_EPSILON = 1e-9;

/**
 * CPU mirror of BED_OVERLAY_FRAGMENT_SHADER: the texture coordinate the shader
 * samples for the fragment at gl_FragCoord (fragX, fragY) (device px, origin
 * bottom-left, pixel centres at +0.5), or null where the shader discards.
 */
export function bedOverlaySampleCoord(
  u: BedOverlayUniforms,
  fragX: number,
  fragY: number,
): BedOverlayTexCoord | null {
  const cssX = fragX / u.uPixelRatio;
  const cssY = (u.uCanvasSize[1] - fragY) / u.uPixelRatio;
  const bedX = (cssX - u.uViewOffset[0]) / u.uViewScale;
  const bedY = (cssY - u.uViewOffset[1]) / u.uViewScale;
  if (!inside(bedX, bedY, u.uBedSize[0], u.uBedSize[1])) return null;
  // GLSL mat3 * vec3 over column-major storage.
  const m = u.uRotation;
  const t = u.uTranslation;
  const z = u.uSurfaceZ;
  const camX = m[0] * bedX + m[3] * bedY + m[6] * z + t[0];
  const camY = m[1] * bedX + m[4] * bedY + m[7] * z + t[1];
  const camZ = m[2] * bedX + m[5] * bedY + m[8] * z + t[2];
  if (!(camZ > MIN_DEPTH)) return null;
  const a = camX / camZ;
  const b = camY / camZ;
  const s = fisheyeScale(Math.hypot(a, b), u.uDistortion);
  const pixelX = u.uFocal[0] * (a * s) + u.uPrincipal[0];
  const pixelY = u.uFocal[1] * (b * s) + u.uPrincipal[1];
  const texU = (pixelX + 0.5) / u.uFrameSize[0];
  const texV = (pixelY + 0.5) / u.uFrameSize[1];
  if (!inside(texU, texV, 1, 1)) return null;
  return { u: texU, v: texV };
}

// Written so NaN fails the test, as the shader's comparisons do.
function inside(x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && x <= width && y >= 0 && y <= height;
}

function fisheyeScale(r: number, k: FisheyeDistortion): number {
  if (r < RADIUS_EPSILON) return 1;
  const theta = Math.atan(r);
  const t2 = theta * theta;
  const t4 = t2 * t2;
  const t6 = t4 * t2;
  const t8 = t4 * t4;
  return (theta * (1 + k[0] * t2 + k[1] * t4 + k[2] * t6 + k[3] * t8)) / r;
}

// rodriguesToMatrix is row-major; GLSL reads a mat3 uniform column by column
// and the renderer uploads with transpose = false, so reorder once here.
function columnMajor(r: Mat3): ColumnMajorMat3 {
  return [r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]];
}

// The y flip must use the height the backing store really has, and backing
// stores are whole pixels, so round here where the renderer and mirror both see it.
function backingPx(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1;
}

function positiveOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// NaN hides the overlay rather than drawing it at an undefined strength.
function clampUnit(value: number): number {
  if (!(value > 0)) return 0;
  return value < 1 ? value : 1;
}
