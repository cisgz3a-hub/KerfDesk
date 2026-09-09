import type { Vec2 } from '../scene';

const FLOAT_BYTES = 8;
const SIGN_BIT = 63n;
const FRACTION_BITS = 52n;
const EXPONENT_MASK = 0x7ffn;
const FRACTION_MASK = (1n << FRACTION_BITS) - 1n;

/** Exact incidence of finite binary64 coordinates, with no proximity radius. */
export function exactSegmentContact(point: Vec2, start: Vec2, end: Vec2): boolean {
  if (![point.x, point.y, start.x, start.y, end.x, end.y].every(Number.isFinite)) return false;
  if (
    point.x < Math.min(start.x, end.x) ||
    point.x > Math.max(start.x, end.x) ||
    point.y < Math.min(start.y, end.y) ||
    point.y > Math.max(start.y, end.y)
  )
    return false;
  if (start.x === end.x || start.y === end.y) return true;
  if (point.x === start.x && point.y === start.y) return true;
  if (point.x === end.x && point.y === end.y) return true;
  const view = new DataView(new ArrayBuffer(FLOAT_BYTES));
  const ax = binaryInteger(start.x, view),
    ay = binaryInteger(start.y, view);
  const bx = binaryInteger(end.x, view),
    by = binaryInteger(end.y, view);
  const px = binaryInteger(point.x, view),
    py = binaryInteger(point.y, view);
  return (px - ax) * (by - ay) === (py - ay) * (bx - ax);
}

// Every finite binary64 number is an integer multiple of 2^-1074. Normal
// mantissas gain the implicit leading bit and shift by encoded exponent - 1;
// subnormals already use that common unit. Products have bounded bit length.
function binaryInteger(value: number, view: DataView): bigint {
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const exponent = (bits >> FRACTION_BITS) & EXPONENT_MASK;
  const fraction = bits & FRACTION_MASK;
  const magnitude =
    exponent === 0n ? fraction : ((1n << FRACTION_BITS) | fraction) << (exponent - 1n);
  return bits >> SIGN_BIT ? -magnitude : magnitude;
}
