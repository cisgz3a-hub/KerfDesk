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

// Fat IDs pack the unchanged CPU Float32 policy using only uint arithmetic.
// This retains subnormal payloads on backends that flush float arithmetic.
export const PICK_SOURCE_AXIS_GLSL = /* glsl */ `
uint kerfdeskPickOrder( uint word ) {
  if ( ( word & 0x7fffffffu ) == 0u ) return 0x80000000u;
  return ( word & 0x80000000u ) != 0u ? ~word : word ^ 0x80000000u;
}
bool kerfdeskPickForward( uvec3 first, uvec3 last ) {
  uvec3 a = uvec3( kerfdeskPickOrder( first.x ), kerfdeskPickOrder( first.y ), kerfdeskPickOrder( first.z ) );
  uvec3 b = uvec3( kerfdeskPickOrder( last.x ), kerfdeskPickOrder( last.y ), kerfdeskPickOrder( last.z ) );
  return a.x < b.x || ( a.x == b.x && ( a.y < b.y || ( a.y == b.y && a.z < b.z ) ) );
}
bool kerfdeskPickNeedsHalf( uint first, uint last ) {
  uint a = first & 0x7fffffffu, b = last & 0x7fffffffu;
  return a != 0u && b != 0u && ( ( first ^ last ) & 0x80000000u ) != 0u
    && max( a, b ) > 0x7effffffu;
}
uint kerfdeskPickRoundShift( uint value, uint distance ) {
  if ( distance == 0u ) return value;
  if ( distance > 32u ) return 0u;
  if ( distance == 32u ) return value > 0x80000000u ? 1u : 0u;
  uint result = value >> distance;
  uint remainder = value & ( ( 1u << distance ) - 1u );
  uint halfway = 1u << ( distance - 1u );
  if ( remainder > halfway || ( remainder == halfway && ( result & 1u ) != 0u ) ) result += 1u;
  return result;
}
uint kerfdeskPickHalf( uint word ) {
  uint magnitude = word & 0x7fffffffu;
  uint halfBits = magnitude >= 0x01000000u ? magnitude - 0x00800000u
    : kerfdeskPickRoundShift( magnitude, 1u );
  return ( word & 0x80000000u ) | halfBits;
}
uint kerfdeskPickShiftJam( uint value, uint distance ) {
  if ( distance == 0u ) return value;
  if ( distance >= 32u ) return value == 0u ? 0u : 1u;
  return ( value >> distance ) | ( ( value << ( 32u - distance ) ) != 0u ? 1u : 0u );
}
uint kerfdeskPickSignificand( uint magnitude ) {
  return ( magnitude & 0x007fffffu ) | ( magnitude >= 0x00800000u ? 0x00800000u : 0u );
}
uint kerfdeskPickRoundPack( uint sign, int exponent, uint significand ) {
  uint rounded = kerfdeskPickRoundShift( significand, 3u );
  if ( rounded >= 0x01000000u ) { rounded >>= 1u; exponent += 1; }
  if ( exponent >= 255 ) return sign | 0x7f800000u;
  if ( rounded == 0u ) return 0u;
  uint magnitude = rounded < 0x00800000u ? rounded
    : ( uint( exponent ) << 23u ) | ( rounded & 0x007fffffu );
  return sign | magnitude;
}
uint kerfdeskPickSubtract( uint end, uint start ) {
  uint a = end, b = start ^ 0x80000000u;
  uint am = a & 0x7fffffffu, bm = b & 0x7fffffffu;
  if ( am == 0u ) return bm == 0u ? 0u : b;
  if ( bm == 0u ) return a;
  bool add = ( ( a ^ b ) & 0x80000000u ) == 0u;
  uint large = am >= bm ? a : b, small = am >= bm ? b : a;
  uint lm = large & 0x7fffffffu, sm = small & 0x7fffffffu;
  int exponent = max( 1, int( lm >> 23u ) );
  int smallExponent = max( 1, int( sm >> 23u ) );
  uint largeSig = kerfdeskPickSignificand( lm ) << 3u;
  uint smallSig = kerfdeskPickShiftJam( kerfdeskPickSignificand( sm ) << 3u,
    uint( exponent - smallExponent ) );
  uint result = add ? largeSig + smallSig : largeSig - smallSig;
  if ( result == 0u ) return 0u;
  if ( add && result >= 0x08000000u ) {
    result = kerfdeskPickShiftJam( result, 1u ); exponent += 1;
  }
  for ( int index = 0; index < 26; index += 1 ) {
    if ( result >= 0x04000000u || exponent <= 1 ) break;
    result <<= 1u; exponent -= 1;
  }
  return kerfdeskPickRoundPack( large & 0x80000000u, exponent, result );
}
int kerfdeskPickFloorExponent( uint magnitude ) {
  int exponent = int( magnitude >> 23u );
  if ( exponent != 0 ) return exponent - 127;
  int result = -126;
  for ( int index = 0; index < 23; index += 1 ) {
    if ( magnitude >= 0x00800000u ) break;
    magnitude <<= 1u; result -= 1;
  }
  return result;
}
uint kerfdeskPickNormalise( uint word, int maximumExponent ) {
  uint magnitude = word & 0x7fffffffu;
  if ( magnitude == 0u ) return 0u;
  int exponent = int( magnitude >> 23u );
  uint significand = kerfdeskPickSignificand( magnitude );
  if ( exponent == 0 ) {
    exponent = 1;
    for ( int index = 0; index < 23; index += 1 ) {
      if ( significand >= 0x00800000u ) break;
      significand <<= 1u; exponent -= 1;
    }
  }
  exponent -= maximumExponent;
  uint packedBits = exponent >= 1
    ? ( uint( exponent ) << 23u ) | ( significand & 0x007fffffu )
    : kerfdeskPickRoundShift( significand, uint( 1 - exponent ) );
  return packedBits == 0u ? 0u : ( word & 0x80000000u ) | packedBits;
}
vec3 kerfdeskPickFullSourceAxis( vec3 first, vec3 last ) {
  uvec3 firstBits = floatBitsToUint( first ), lastBits = floatBitsToUint( last );
  if ( any( greaterThanEqual( firstBits & uvec3( 0x7fffffffu ), uvec3( 0x7f800000u ) ) )
    || any( greaterThanEqual( lastBits & uvec3( 0x7fffffffu ), uvec3( 0x7f800000u ) ) ) ) return vec3( 0.0 );
  bool forward = kerfdeskPickForward( firstBits, lastBits );
  uvec3 start = forward ? firstBits : lastBits, end = forward ? lastBits : firstBits;
  if ( kerfdeskPickNeedsHalf( start.x, end.x )
    || kerfdeskPickNeedsHalf( start.y, end.y ) || kerfdeskPickNeedsHalf( start.z, end.z ) ) {
    start = uvec3( kerfdeskPickHalf( start.x ), kerfdeskPickHalf( start.y ), kerfdeskPickHalf( start.z ) );
    end = uvec3( kerfdeskPickHalf( end.x ), kerfdeskPickHalf( end.y ), kerfdeskPickHalf( end.z ) );
  }
  uvec3 delta = uvec3( kerfdeskPickSubtract( end.x, start.x ),
    kerfdeskPickSubtract( end.y, start.y ), kerfdeskPickSubtract( end.z, start.z ) );
  uint maximum = max( max( delta.x & 0x7fffffffu, delta.y & 0x7fffffffu ), delta.z & 0x7fffffffu );
  if ( maximum == 0u || maximum >= 0x7f800000u ) return vec3( 0.0 );
  int exponent = kerfdeskPickFloorExponent( maximum );
  return uintBitsToFloat( uvec3( kerfdeskPickNormalise( delta.x, exponent ),
    kerfdeskPickNormalise( delta.y, exponent ), kerfdeskPickNormalise( delta.z, exponent ) ) );
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
