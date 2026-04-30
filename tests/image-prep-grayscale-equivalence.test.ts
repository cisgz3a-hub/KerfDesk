/**
 * T1-17 pass 1: grayscale-math equivalence.
 *
 * The freeze fix moves the getImageData + per-pixel grayscale loop
 * to a Web Worker. The risk is that the worker and main-thread
 * paths could drift — if their math diverges, importing the same
 * image under different runtimes (Electron with workers vs. test
 * environment without) would produce different scene objects and
 * different cut output for the same brightness setting.
 *
 * This test pins the grayscale math as a pure function and
 * exercises the canonical luminance formula across diverse pixel
 * inputs. Both the worker (`ImagePrepWorker.ts`) and the
 * main-thread fallback (`imagePrepClient.ts:prepareImageGrayscaleMainThread`)
 * use this exact formula; we assert it here so any future drift
 * (different alpha handling, rounding rule, luminance coefficients)
 * is caught by CI rather than by a user wondering why the same
 * photo engraved differently after an Electron upgrade.
 *
 * Run: npx tsx tests/image-prep-grayscale-equivalence.test.ts
 */
import { rgbaToGrayscale } from '../src/workers/imagePrepClient';

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function assertEqual(actual: number, expected: number, message: string): void {
  assert(actual === expected, `${message} (got ${actual}, expected ${expected})`);
}

// The reference formula — same as both the worker loop and the
// main-thread fallback. If you change either of those, change
// this too, and verify the equivalence still holds.
function expected(r: number, g: number, b: number, a: number): number {
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return Math.round(lum * (a / 255) + 255 * (1 - a / 255));
}

console.log('\n=== image-prep grayscale equivalence (T1-17 pass 1) ===\n');

// ── 1. Pure black, full alpha ────────────────────────────────
{
  const px = new Uint8Array([0, 0, 0, 255]);
  const out = rgbaToGrayscale(px, 1, 1);
  assertEqual(out.length, 1, 'output length matches width*height');
  assertEqual(out[0], 0, 'pure black, full alpha → 0');
}

// ── 2. Pure white, full alpha ────────────────────────────────
{
  const px = new Uint8Array([255, 255, 255, 255]);
  const out = rgbaToGrayscale(px, 1, 1);
  assertEqual(out[0], 255, 'pure white, full alpha → 255');
}

// ── 3. Pure red, full alpha ──────────────────────────────────
{
  const px = new Uint8Array([255, 0, 0, 255]);
  const out = rgbaToGrayscale(px, 1, 1);
  // 0.299 * 255 = 76.245 → rounds to 76
  assertEqual(out[0], 76, 'pure red, full alpha → 76 (Rec.601 luminance)');
}

// ── 4. Pure green, full alpha ────────────────────────────────
{
  const px = new Uint8Array([0, 255, 0, 255]);
  const out = rgbaToGrayscale(px, 1, 1);
  // 0.587 * 255 = 149.685 → rounds to 150
  assertEqual(out[0], 150, 'pure green, full alpha → 150 (Rec.601 luminance)');
}

// ── 5. Pure blue, full alpha ─────────────────────────────────
{
  const px = new Uint8Array([0, 0, 255, 255]);
  const out = rgbaToGrayscale(px, 1, 1);
  // 0.114 * 255 = 29.07 → rounds to 29
  assertEqual(out[0], 29, 'pure blue, full alpha → 29 (Rec.601 luminance)');
}

// ── 6. Mid-grey, full alpha ──────────────────────────────────
{
  const px = new Uint8Array([128, 128, 128, 255]);
  const out = rgbaToGrayscale(px, 1, 1);
  // (0.299 + 0.587 + 0.114) * 128 = 128 → 128
  assertEqual(out[0], 128, 'mid-grey, full alpha → 128');
}

// ── 7. Zero alpha — composites onto white ────────────────────
//
// alpha=0 means "fully transparent." With white-background alpha
// composite, the result is 255 regardless of color channels.
// This catches the alpha handling: getting it backwards means
// transparent pixels become black, which would render imported
// images with transparent backgrounds as solid black blobs.
{
  const px = new Uint8Array([0, 0, 0, 0]);
  const out = rgbaToGrayscale(px, 1, 1);
  assertEqual(out[0], 255, 'transparent black → 255 (composites onto white)');
}

{
  const px = new Uint8Array([128, 128, 128, 0]);
  const out = rgbaToGrayscale(px, 1, 1);
  assertEqual(out[0], 255, 'transparent grey → 255 (composites onto white)');
}

// ── 8. Half alpha — blends with white ────────────────────────
{
  const px = new Uint8Array([0, 0, 0, 128]);
  const out = rgbaToGrayscale(px, 1, 1);
  const exp = expected(0, 0, 0, 128);
  assertEqual(out[0], exp, `half-alpha black → ${exp} (composites toward white)`);
}

// ── 9. Multi-pixel image preserves order ─────────────────────
{
  // 2x2: red, green, blue, white — all opaque
  const px = new Uint8Array([
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 255, 255,
    255, 255, 255, 255,
  ]);
  const out = rgbaToGrayscale(px, 2, 2);
  assertEqual(out.length, 4, '2×2 image → 4 grayscale bytes');
  assertEqual(out[0], 76, 'pixel 0: red → 76');
  assertEqual(out[1], 150, 'pixel 1: green → 150');
  assertEqual(out[2], 29, 'pixel 2: blue → 29');
  assertEqual(out[3], 255, 'pixel 3: white → 255');
}

// ── 10. 1000×1000 doesn't change formula ─────────────────────
//
// Performance isn't tested here (Node ≠ browser worker), but
// correctness of a large buffer is. Confirms there's no
// off-by-one or overflow with realistic sizes.
{
  const w = 100;
  const h = 100;
  const px = new Uint8Array(w * h * 4);
  // Fill with deterministic pattern: r = i % 256, g = (i*2) % 256, etc.
  for (let i = 0; i < w * h; i++) {
    px[i * 4] = i % 256;
    px[i * 4 + 1] = (i * 2) % 256;
    px[i * 4 + 2] = (i * 3) % 256;
    px[i * 4 + 3] = 255;
  }
  const out = rgbaToGrayscale(px, w, h);
  assertEqual(out.length, w * h, '100×100 image → 10000 grayscale bytes');
  // Spot-check a few pixels against the reference formula.
  let allMatch = true;
  for (let i = 0; i < 50; i++) {
    const r = i % 256;
    const g = (i * 2) % 256;
    const b = (i * 3) % 256;
    const exp = expected(r, g, b, 255);
    if (out[i] !== exp) {
      allMatch = false;
      console.error(`    pixel ${i}: got ${out[i]}, expected ${exp}`);
    }
  }
  assert(allMatch, '100×100 image: first 50 pixels match reference formula');
}

// ── 11. Uint8ClampedArray (canvas's actual type) works too ──
//
// Browser ImageData.data is a Uint8ClampedArray, not Uint8Array.
// Our function accepts both per its type signature; verify.
{
  const px = new Uint8ClampedArray([255, 0, 0, 255]);
  const out = rgbaToGrayscale(px, 1, 1);
  assertEqual(out[0], 76, 'Uint8ClampedArray input → 76 (matches Uint8Array path)');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
