// The ID pass needs a full-source axis even when the least-slope plane is edge-on.
// Fat IDs derive it from shared endpoints; native IDs store the same Float32 steps.
import type * as ThreeNamespace from 'three';

export const PICK_SOURCE_AXIS_ATTRIBUTE = 'kerfdeskPickSourceAxis';
const HALF_FLOAT32_MAX = 1.7014117331926443e38;
const MIN_NORMAL = 2 ** -126;
const SUBNORMAL_UPSCALE = 2 ** 24;

/** Canonical stored endpoints give exact retraces identical packed direction bits. */
export function writePickSourceAxis(
  target: Float32Array,
  offset: number,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): void {
  target.fill(0, offset, offset + 3);
  if (!finiteEndpoints(x0, y0, z0, x1, y1, z1)) return;
  const first = sourceForward(x0, y0, z0, x1, y1, z1);
  const factor = needsHalf(x0, x1) || needsHalf(y0, y1) || needsHalf(z0, z1) ? 0.5 : 1;
  let dx = roundedDifference(x0, x1, first, factor);
  let dy = roundedDifference(y0, y1, first, factor);
  let dz = roundedDifference(z0, z1, first, factor);
  let maximum = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
  if (!Number.isFinite(maximum) || maximum === 0) return;
  if (maximum < MIN_NORMAL) {
    dx = Math.fround(dx * SUBNORMAL_UPSCALE);
    dy = Math.fround(dy * SUBNORMAL_UPSCALE);
    dz = Math.fround(dz * SUBNORMAL_UPSCALE);
    maximum = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
  }
  const scale = 2 ** Math.floor(Math.log2(maximum));
  target[offset] = packedDirection(dx / scale);
  target[offset + 1] = packedDirection(dy / scale);
  target[offset + 2] = packedDirection(dz / scale);
}

function sourceForward(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): boolean {
  return x0 < x1 || (x0 === x1 && (y0 < y1 || (y0 === y1 && z0 < z1)));
}

function needsHalf(first: number, last: number): boolean {
  const opposed = (first < 0 && last > 0) || (first > 0 && last < 0);
  return opposed && Math.max(Math.abs(first), Math.abs(last)) > HALF_FLOAT32_MAX;
}

function roundedDifference(first: number, last: number, forward: boolean, factor: number): number {
  const start = Math.fround((forward ? first : last) * factor);
  const end = Math.fround((forward ? last : first) * factor);
  return Math.fround(end - start);
}

function packedDirection(value: number): number {
  const packed = Math.fround(value);
  return packed === 0 ? 0 : packed;
}

function finiteEndpoints(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): boolean {
  return (
    Number.isFinite(x0) &&
    Number.isFinite(y0) &&
    Number.isFinite(z0) &&
    Number.isFinite(x1) &&
    Number.isFinite(y1) &&
    Number.isFinite(z1)
  );
}

// Mirror the native writer's explicit Float32 operations. The half guard must
// pair opposite signs and a large magnitude in the SAME component: a large
// common X coordinate must not destroy a tiny, unrelated Y-only source axis.
export const PICK_SOURCE_AXIS_GLSL = /* glsl */ `
bool kerfdeskPickNeedsHalf( float first, float last ) {
  bool opposed = ( first < 0.0 && last > 0.0 ) || ( first > 0.0 && last < 0.0 );
  return opposed && max( abs( first ), abs( last ) ) > ${HALF_FLOAT32_MAX};
}
vec3 kerfdeskPickFullSourceAxis( vec3 first, vec3 last ) {
  if ( any( isnan( first ) ) || any( isinf( first ) )
    || any( isnan( last ) ) || any( isinf( last ) ) ) return vec3( 0.0 );
  bool forward = first.x < last.x || ( first.x == last.x
    && ( first.y < last.y || ( first.y == last.y && first.z < last.z ) ) );
  vec3 start = forward ? first : last;
  vec3 end = forward ? last : first;
  if ( kerfdeskPickNeedsHalf( start.x, end.x )
    || kerfdeskPickNeedsHalf( start.y, end.y )
    || kerfdeskPickNeedsHalf( start.z, end.z ) ) {
    start *= 0.5;
    end *= 0.5;
  }
  vec3 delta = end - start;
  float maximum = max( max( abs( delta.x ), abs( delta.y ) ), abs( delta.z ) );
  if ( isnan( maximum ) || isinf( maximum ) || maximum == 0.0 ) return vec3( 0.0 );
  if ( maximum < ${MIN_NORMAL} ) {
    delta *= ${SUBNORMAL_UPSCALE}.0;
    maximum = max( max( abs( delta.x ), abs( delta.y ) ), abs( delta.z ) );
  }
  float scale = uintBitsToFloat( floatBitsToUint( maximum ) & 0x7f800000u );
  vec3 direction = delta / scale;
  return vec3( direction.x == 0.0 ? 0.0 : direction.x,
    direction.y == 0.0 ? 0.0 : direction.y, direction.z == 0.0 ? 0.0 : direction.z );
}
`;

/** Lazy native ID geometry only: 24 bytes/pair, no positions copy or per-frame scan. */
export function addPickSourceAxes(
  three: typeof ThreeNamespace,
  geometry: ThreeNamespace.BufferGeometry,
): ThreeNamespace.BufferAttribute {
  const existing = geometry.getAttribute(PICK_SOURCE_AXIS_ATTRIBUTE);
  if (existing !== undefined) return existing as ThreeNamespace.BufferAttribute;
  const position = geometry.getAttribute('position');
  const axes = new Float32Array(position.count * 3);
  for (let index = 0; index + 1 < position.count; index += 2) {
    writePickSourceAxis(
      axes,
      index * 3,
      position.getX(index),
      position.getY(index),
      position.getZ(index),
      position.getX(index + 1),
      position.getY(index + 1),
      position.getZ(index + 1),
    );
    axes.copyWithin((index + 1) * 3, index * 3, index * 3 + 3);
  }
  const attribute = new three.BufferAttribute(axes, 3);
  geometry.setAttribute(PICK_SOURCE_AXIS_ATTRIBUTE, attribute);
  return attribute;
}
