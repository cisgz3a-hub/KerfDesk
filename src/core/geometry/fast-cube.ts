// x ** 3 for x in [0, 1], correctly rounded, without the builtin pow call.
// V8's pow is only nearly rounded, and how nearly depends on the V8 version:
// Node 24 stayed within 0.0036 ulp of correct rounding, Node 22 differed from
// it on about 4% of cubes. So the tracer's output no longer depends on the
// engine's pow. This forms the cube exactly as a double-double (Dekker's
// product, twice), which leaves the remainder off by at most 2^-104 of the
// cube, and rounds it. When a rounding boundary lies within 2^-100 of the
// cube (about once in 2^47 random x, or an exact tie), it rounds the exact
// integer cube instead. Outside [2^-300, 1] it defers to `x ** 3`: the arm
// solve's parameters never go there. About 2-3x faster than pow in the cubic
// fit's arm solve (ADR-482 Amendments 6 and 7).

const SPLIT = 134217729; // 2^27 + 1: Veltkamp's splitter for doubles
const BOUNDARY_BAND = 2 ** -100;
const MIN_EXACT = 2 ** -300; // the error terms stay normal above this

export function cube01(x: number): number {
  if (!(x >= MIN_EXACT && x <= 1)) return x ** 3;
  const p = x * x;
  let c = SPLIT * x;
  const xh = c - (c - x);
  const xl = x - xh;
  const pErr = xh * xh - p + 2 * xh * xl + xl * xl; // p + pErr = x * x exactly
  const q = p * x;
  c = SPLIT * p;
  const ph = c - (c - p);
  const pl = p - ph;
  const qErr = ph * xh - q + ph * xl + pl * xh + pl * xl; // q + qErr = p * x exactly
  const rest = qErr + pErr * x;
  const band = q * BOUNDARY_BAND;
  const above = q + (rest + band);
  return above === q + (rest - band) ? above : exactCube(x);
}

const BITS = new DataView(new ArrayBuffer(8));
const MANTISSA = (1n << 52n) - 1n;

// The cube of a normal x in [2^-300, 1], rounded to nearest, ties to even,
// from the exact integer cube of its 53-bit significand.
function exactCube(x: number): number {
  BITS.setFloat64(0, x);
  const raw = BITS.getBigUint64(0);
  const m = (raw & MANTISSA) | (1n << 52n);
  const e = Number(raw >> 52n) - 1075; // x = m * 2^e
  const cube = m * m * m; // 157 to 159 bits
  const shift = cube.toString(2).length - 53;
  let r = cube >> BigInt(shift);
  const rem = cube - (r << BigInt(shift));
  const half = 1n << BigInt(shift - 1);
  if (rem > half || (rem === half && (r & 1n) === 1n)) r += 1n;
  let exp = 3 * e + shift; // the cube rounds to r * 2^exp
  if (r === 1n << 53n) {
    r >>= 1n;
    exp += 1;
  }
  BITS.setBigUint64(0, (BigInt(exp + 1075) << 52n) | (r & MANTISSA));
  return BITS.getFloat64(0);
}
