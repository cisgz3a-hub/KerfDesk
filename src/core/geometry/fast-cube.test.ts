import { describe, expect, it } from 'vitest';
import { cube01 } from './fast-cube';

const view = new DataView(new ArrayBuffer(8));

// A finite positive double as m * 2^e with an integer m.
function parts(v: number): [bigint, number] {
  view.setFloat64(0, v);
  const raw = view.getBigUint64(0);
  const biased = Number(raw >> 52n);
  const fraction = raw & ((1n << 52n) - 1n);
  return biased === 0 ? [fraction, -1074] : [fraction | (1n << 52n), biased - 1075];
}

function step(v: number, by: bigint): number {
  view.setFloat64(0, v);
  view.setBigUint64(0, view.getBigUint64(0) + by);
  return view.getFloat64(0);
}

// a * 2^ea + b * 2^eb as one integer times 2^e.
function sum(a: bigint, ea: number, b: bigint, eb: number): [bigint, number] {
  const e = Math.min(ea, eb);
  return [(a << BigInt(ea - e)) + (b << BigInt(eb - e)), e];
}

// Sign of a * 2^ea - b * 2^eb.
function compare(a: bigint, ea: number, b: bigint, eb: number): number {
  const e = Math.min(ea, eb);
  const d = (a << BigInt(ea - e)) - (b << BigInt(eb - e));
  return d > 0n ? 1 : d < 0n ? -1 : 0;
}

// True when c is x^3 rounded to nearest, ties to even: the exact cube lies
// between the midpoints from c to its two neighbours, on one only if c is even.
function isRoundedCube(x: number, c: number): boolean {
  const [m, e] = parts(x);
  const [cm, ce] = parts(c);
  const [dm, de] = parts(step(c, -1n));
  const [um, ue] = parts(step(c, 1n));
  const [lo, loE] = sum(dm, de, cm, ce); // twice the lower midpoint
  const [hi, hiE] = sum(cm, ce, um, ue); // twice the upper midpoint
  const twiceCube = m * m * m;
  const twiceCubeE = 3 * e + 1;
  const even = (cm & 1n) === 0n;
  const below = compare(twiceCube, twiceCubeE, lo, loE);
  const above = compare(twiceCube, twiceCubeE, hi, hiE);
  return (below > 0 || (below === 0 && even)) && (above < 0 || (above === 0 && even));
}

describe('cube01', () => {
  it('returns the correctly rounded cube across [0, 1]', () => {
    let state = 123456789;
    const next = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
    let wrong = 0;
    for (let i = 0; i < 200_000; i += 1) {
      // Uniform, near 0, near 1, products and grid values, and each mirror.
      const r = next() + next() * 2 ** -32;
      const kind = i % 5;
      const t =
        kind === 0
          ? r
          : kind === 1
            ? r * 10 ** (-next() * 60)
            : kind === 2
              ? 1 - r * 10 ** (-next() * 12)
              : kind === 3
                ? r * next()
                : Math.round(r * 4096) / 4096;
      for (const x of [t, 1 - t]) {
        if (x > 0 && !isRoundedCube(x, cube01(x))) wrong += 1;
      }
    }
    expect(wrong).toBe(0);
  });

  it('rounds exact ties to even and cubes just off a tie correctly', () => {
    // k odd with 2^53 <= k^3 < 2^54: (k / 2^18)^3 lies exactly halfway between
    // two doubles. With 19 bits, k^3 carries four bits past the double.
    const cases: number[] = [];
    for (let k = 208_065; k < 2 ** 18; k += 262) cases.push(k / 2 ** 18);
    for (let k = 416_129; k < 2 ** 19; k += 526) cases.push(k / 2 ** 19);
    let wrong = 0;
    for (const x of cases) if (!isRoundedCube(x, cube01(x))) wrong += 1;
    expect(cases.length).toBeGreaterThan(300);
    expect(wrong).toBe(0);
    // A tie rounds to the even neighbour.
    const x = 208_065 / 2 ** 18;
    const [cm] = parts(cube01(x));
    expect(cm & 1n).toBe(0n);
  });

  it('handles the ends, tiny values and values outside [0, 1]', () => {
    expect(cube01(0.5)).toBe(0.125);
    expect(cube01(1)).toBe(1);
    for (const x of [1 - 2 ** -53, 2 ** -300, 2 ** -299 * 1.5]) {
      expect(isRoundedCube(x, cube01(x))).toBe(true);
    }
    // Below 2^-300 and outside [0, 1] it is `x ** 3` itself.
    for (const x of [0, -0, 2 ** -301, 1e-320, -0.25, 1.5, Infinity, Number.NaN]) {
      expect(Object.is(cube01(x), x ** 3)).toBe(true);
    }
  });
});
