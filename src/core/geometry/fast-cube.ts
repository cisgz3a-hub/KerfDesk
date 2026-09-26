// x ** 3 for x in [0, 1], bit for bit, without the builtin pow call. V8
// computes `x ** 3` with its fdlibm-style pow: nearly rounded (a replay of 4e6
// cubes put it at most 0.0036 ulp past the correctly rounded value), so it
// can differ from `x * x * x` (it does for about a quarter of all x). This
// forms the cube exactly as a double-double (Dekker's product, twice), and
// rounds it: when the exact cube sits more than 2^-57 of itself (at least
// 1/32 ulp) from a rounding boundary, every nearly rounded pow returns that
// same double; nearer a boundary, or outside [2^-300, 1], it defers to
// `x ** 3` itself. A replay of 2e7 cubes matched `x ** 3` in every bit, and
// the unit test pins that. About 2-3x faster in the cubic fit's arm solve
// (ADR-440 speed amendment).

const SPLIT = 134217729; // 2^27 + 1: Veltkamp's splitter for doubles
const BOUNDARY_BAND = 2 ** -57;
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
  return above === q + (rest - band) ? above : x ** 3;
}
