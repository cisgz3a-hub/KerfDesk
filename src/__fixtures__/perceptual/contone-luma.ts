// Perceptual test harness — deterministic continuous-tone test field.
//
// Why this exists alongside photo-luma.ts. The committed image asset
// (arch-house-langebaan-source.png) is line art: measured luma mean 234/255,
// which works out to 6.4% ink coverage. A metric scored on a 6.4%-ink image
// flatters itself — a program that burned NOTHING would score a mean absolute
// error of only 0.064, so "passing" at 0.005 is a mere 13× margin over doing
// nothing at all. Real photo-engraving work is not that empty.
//
// This field is the adversarial complement: measured 39.6% ink coverage, the
// full tonal range, and detail at five spatial scales down to 2 px. Those are
// the two properties that actually stress an error-diffusion dither — a wide
// midtone population it must dot-pattern, and high-frequency structure that a
// coarse cell average could smear away. Against it, burning nothing scores
// 0.396, so a passing grayscale score of 0.00007 is a 5600× margin.
//
// Deterministic by construction: an integer bit-mix hash, no Math.random and
// no clock, so the fixture is byte-stable across runs and machines. (Fixtures
// are exempt from the core purity lint, but a fixture that changed run to run
// would make every threshold in the suite meaningless.)
//
// Test-only helper: lives under src/__fixtures__ (boundary- and
// coverage-exempt per eslint.config.mjs). Pure and deterministic.

const WHITE_LUMA = 255;
// Octave periods in pixels, coarse to fine. Amplitude falls with the period,
// so large forms dominate and 2 px detail only textures them — the spectral
// shape of a photograph rather than of white noise.
const OCTAVE_PERIODS_PX = [32, 16, 8, 4, 2] as const;
const COARSEST_PERIOD_PX = 32;

// Three odd 32-bit constants and shift-xor mixing: the standard integer hash
// shape. Any decent avalanche works here; what matters is that it is a pure
// function of (x, y) so the field never varies between runs.
function hash2(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Bilinear value noise with a smoothstep fade, so octaves blend without the
// grid-aligned creases nearest-neighbour interpolation would leave behind.
function valueNoise(x: number, y: number, periodPx: number): number {
  const u = x / periodPx;
  const v = y / periodPx;
  const gx = Math.floor(u);
  const gy = Math.floor(v);
  const fx = smoothstep(u - gx);
  const fy = smoothstep(v - gy);
  const top = lerp(hash2(gx, gy), hash2(gx + 1, gy), fx);
  const bottom = lerp(hash2(gx, gy + 1), hash2(gx + 1, gy + 1), fx);
  return lerp(top, bottom, fy);
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(WHITE_LUMA, value));
}

/** Multi-octave greyscale field. 0 = black (full burn), 255 = white. */
export function contoneLuma(width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  let amplitudeSum = 0;
  for (const periodPx of OCTAVE_PERIODS_PX) amplitudeSum += periodPx / COARSEST_PERIOD_PX;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 0;
      for (const periodPx of OCTAVE_PERIODS_PX) {
        value += valueNoise(x, y, periodPx) * (periodPx / COARSEST_PERIOD_PX);
      }
      out[y * width + x] = clampByte(Math.round((value / amplitudeSum) * WHITE_LUMA));
    }
  }
  return out;
}
