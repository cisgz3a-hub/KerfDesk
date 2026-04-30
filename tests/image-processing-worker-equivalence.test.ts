/**
 * T1-17 pass 4a: worker image processing math equivalence.
 *
 * Pass 4a adds two new exports to imagePrepClient.ts:
 *   - processImage(...) — async, off-thread when possible
 *   - processImageMainThread(...) — sync fallback with identical math
 *
 * Both must produce byte-for-byte identical output to the existing
 * src/core/image/ImageProcessing.ts functions, applied in the same
 * canonical order (brightness → contrast → gamma → invert → threshold).
 *
 * If this test ever fails after a refactor, the visible symptom in the
 * app would be: g-code emitted by raster jobs would differ slightly
 * from what the user saw in the dither preview, OR the new pre-batched
 * path would produce different output than the legacy inline path.
 * Both are unacceptable — once Fix #4 (Pass 4b) lands, JobCompiler
 * trusts that these two paths agree.
 *
 * jsdom is needed because `processImageMainThread` exists in
 * imagePrepClient.ts which top-level imports DOM-touching code.
 *
 * Run: npx tsx tests/image-processing-worker-equivalence.test.ts
 */
import { JSDOM } from 'jsdom';
import { processImageMainThread } from '../src/workers/imagePrepClient';
import {
  adjustBrightness,
  adjustContrast,
  adjustGamma,
  invertImage,
  thresholdToOneBit,
} from '../src/core/image/ImageProcessing';

const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'http://localhost' });
Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true });
Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });

let passed = 0;
let failed = 0;

function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ✓ ${m}`);
  } else {
    failed++;
    console.error(`  ✗ ${m}`);
  }
}

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function maxAbsDiff(a: Uint8Array, b: Uint8Array): number {
  let m = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > m) m = d;
  }
  return m;
}

// Reference pipeline using the existing ImageProcessing.ts functions
// in the same order as both the worker and the new client wrapper.
function reference(
  source: Uint8Array,
  width: number,
  height: number,
  brightness: number,
  contrast: number,
  gamma: number,
  invert: boolean,
  threshold: number | null,
): Uint8Array {
  let buf: Uint8Array = new Uint8Array(source);
  if (brightness !== 0) buf = new Uint8Array(adjustBrightness(buf, brightness));
  if (contrast !== 0) buf = new Uint8Array(adjustContrast(buf, contrast));
  if (gamma !== 1) buf = new Uint8Array(adjustGamma(buf, gamma));
  if (invert) buf = new Uint8Array(invertImage(buf));
  if (threshold !== null) buf = new Uint8Array(thresholdToOneBit(buf, width, height, threshold));
  return buf;
}

// Build a deterministic "image" of width × height bytes whose values
// hit the full 0..255 range so each operation has something to bite on.
function makeRamp(width: number, height: number): Uint8Array {
  const n = width * height;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = i % 256;
  return out;
}

console.log('\n=== image processing worker equivalence (T1-17 pass 4a) ===\n');

// ── 1. No-op pipeline — output equals input ─────────────────
{
  const src = makeRamp(8, 4);
  const got = processImageMainThread(src, 8, 4, {
    brightness: 0, contrast: 0, gamma: 1, invert: false, threshold: null,
  });
  assert(arraysEqual(got, src), 'all-no-op pipeline returns identical bytes');
}

// ── 2. Brightness only ──────────────────────────────────────
{
  const src = makeRamp(16, 16);
  const expected = reference(src, 16, 16, 50, 0, 1, false, null);
  const got = processImageMainThread(src, 16, 16, {
    brightness: 50, contrast: 0, gamma: 1, invert: false, threshold: null,
  });
  assert(arraysEqual(got, expected), `brightness=+50 matches reference (max diff = ${maxAbsDiff(got, expected)})`);
}

// ── 3. Contrast only ────────────────────────────────────────
{
  const src = makeRamp(16, 16);
  const expected = reference(src, 16, 16, 0, -75, 1, false, null);
  const got = processImageMainThread(src, 16, 16, {
    brightness: 0, contrast: -75, gamma: 1, invert: false, threshold: null,
  });
  assert(arraysEqual(got, expected), `contrast=-75 matches reference (max diff = ${maxAbsDiff(got, expected)})`);
}

// ── 4. Gamma only ───────────────────────────────────────────
{
  const src = makeRamp(16, 16);
  const expected = reference(src, 16, 16, 0, 0, 2.2, false, null);
  const got = processImageMainThread(src, 16, 16, {
    brightness: 0, contrast: 0, gamma: 2.2, invert: false, threshold: null,
  });
  assert(arraysEqual(got, expected), `gamma=2.2 matches reference (max diff = ${maxAbsDiff(got, expected)})`);
}

// ── 5. Invert only ──────────────────────────────────────────
{
  const src = makeRamp(8, 8);
  const expected = reference(src, 8, 8, 0, 0, 1, true, null);
  const got = processImageMainThread(src, 8, 8, {
    brightness: 0, contrast: 0, gamma: 1, invert: true, threshold: null,
  });
  assert(arraysEqual(got, expected), 'invert matches reference');
}

// ── 6. Threshold only ───────────────────────────────────────
{
  const src = makeRamp(16, 16);
  const expected = reference(src, 16, 16, 0, 0, 1, false, 128);
  const got = processImageMainThread(src, 16, 16, {
    brightness: 0, contrast: 0, gamma: 1, invert: false, threshold: 128,
  });
  assert(arraysEqual(got, expected), 'threshold=128 matches reference');
}

// ── 7. Composite: brightness + contrast + gamma + invert ────
{
  const src = makeRamp(32, 32);
  const expected = reference(src, 32, 32, 25, -30, 1.5, true, null);
  const got = processImageMainThread(src, 32, 32, {
    brightness: 25, contrast: -30, gamma: 1.5, invert: true, threshold: null,
  });
  assert(arraysEqual(got, expected), `composite (b/c/g/inv) matches reference (max diff = ${maxAbsDiff(got, expected)})`);
}

// ── 8. Composite + threshold (full pipeline) ────────────────
{
  const src = makeRamp(32, 32);
  const expected = reference(src, 32, 32, 10, 50, 0.8, false, 100);
  const got = processImageMainThread(src, 32, 32, {
    brightness: 10, contrast: 50, gamma: 0.8, invert: false, threshold: 100,
  });
  assert(arraysEqual(got, expected), `full pipeline matches reference (max diff = ${maxAbsDiff(got, expected)})`);
}

// ── 9. Source not mutated ───────────────────────────────────
{
  const src = makeRamp(8, 8);
  const before = new Uint8Array(src);
  processImageMainThread(src, 8, 8, {
    brightness: 50, contrast: 50, gamma: 0.5, invert: true, threshold: 100,
  });
  assert(arraysEqual(src, before), 'processImageMainThread does not mutate source buffer');
}

// ── 10. Order matters: contrast-then-brightness ≠ brightness-then-contrast ──
//
// This pins the canonical order. If a future refactor swaps the two,
// this test catches it before silently shipping different output.
{
  const src = makeRamp(16, 16);
  const bThenC = reference(src, 16, 16, 50, 50, 1, false, null);
  // Run reference but swap order manually:
  let alt = new Uint8Array(src);
  alt = new Uint8Array(adjustContrast(alt, 50));
  alt = new Uint8Array(adjustBrightness(alt, 50));
  assert(!arraysEqual(bThenC, alt), 'brightness-then-contrast differs from contrast-then-brightness (order is a real contract)');
}

// ── 11. Edge: empty source ──────────────────────────────────
{
  const src = new Uint8Array(0);
  const got = processImageMainThread(src, 0, 0, {
    brightness: 50, contrast: 50, gamma: 0.5, invert: true, threshold: 128,
  });
  assert(got.length === 0, 'empty source → empty output (no crashes)');
}

// ── 12. Gamma clamp: 0.05 clamps to 0.1, 10 clamps to 5 ─────
{
  const src = makeRamp(16, 16);
  const lowClamped = processImageMainThread(src, 16, 16, {
    brightness: 0, contrast: 0, gamma: 0.05, invert: false, threshold: null,
  });
  const lowExpected = reference(src, 16, 16, 0, 0, 0.05, false, null);

  const highClamped = processImageMainThread(src, 16, 16, {
    brightness: 0, contrast: 0, gamma: 10, invert: false, threshold: null,
  });
  const highExpected = reference(src, 16, 16, 0, 0, 10, false, null);
  assert(
    arraysEqual(lowClamped, lowExpected) && arraysEqual(highClamped, highExpected),
    'gamma clamps to 0.1..5 (matches reference clamp behavior)',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
