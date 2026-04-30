/**
 * T1-17 pass 2: dither cache key uses content hash, not length.
 *
 * Before this fix the dither preview cache used `adjustedData.length`
 * as its content-discriminator field. Length only depends on image
 * dimensions, so two different brightness/contrast/gamma settings
 * applied to the same image produced identical cache keys -> stale
 * cache hits -> user adjusts brightness, dither preview doesn't update.
 *
 * The fix replaces the length field with an FNV-1a 32-bit content hash
 * of adjustedData. Different content -> different hash -> different key
 * -> correct cache invalidation.
 *
 * Run: npx tsx tests/dither-cache-key-content-hash.test.ts
 */
import { fnv1a32, buildDitherCacheKey } from '../src/ui/renderers/SceneRenderer';

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

console.log('\n=== dither cache key content hash (T1-17 pass 2) ===\n');

// ── 1. Determinism ────────────────────────────────────────────
{
  const a = new Uint8Array([1, 2, 3, 4, 5]);
  const b = new Uint8Array([1, 2, 3, 4, 5]);
  assert(fnv1a32(a) === fnv1a32(b), 'identical content -> identical hash');
  assert(fnv1a32(a) === fnv1a32(a), 'same array hashed twice -> identical hash');
}

// ── 2. Empty array -> known FNV-1a offset basis ───────────────
{
  const empty = new Uint8Array(0);
  assert(fnv1a32(empty) === 0x811c9dc5, 'empty array -> FNV-1a offset basis (0x811c9dc5)');
}

// ── 3. Single-byte sanity (one FNV-1a step) ──────────────────
{
  const expected = Math.imul(0x811c9dc5, 0x01000193) >>> 0;
  assert(fnv1a32(new Uint8Array([0])) === expected, 'single 0x00 byte -> known FNV-1a step');
}

// ── 4. Same length, different content -> different hashes ────
{
  const a = new Uint8Array(1024);
  const b = new Uint8Array(1024);
  a.fill(100);
  b.fill(150);
  assert(a.length === b.length, 'arrays have same length (precondition)');
  assert(fnv1a32(a) !== fnv1a32(b), 'same length, different uniform fill -> different hash');
}

// ── 5. Single-byte difference is detected ────────────────────
{
  const a = new Uint8Array(10000);
  const b = new Uint8Array(10000);
  b[5000] = 1;
  assert(fnv1a32(a) !== fnv1a32(b), 'single byte difference -> different hash');
}

// ── 6. Order matters (not just byte counts) ──────────────────
{
  const a = new Uint8Array([1, 2, 3, 4]);
  const b = new Uint8Array([4, 3, 2, 1]);
  assert(fnv1a32(a) !== fnv1a32(b), 'reversed order -> different hash');
}

// ── 7. buildDitherCacheKey: same-length different content -> different keys ──
{
  const dataLow = new Uint8Array(4 * 4);
  dataLow.fill(50);
  const dataHigh = new Uint8Array(4 * 4);
  dataHigh.fill(200);
  const keyLow = buildDitherCacheKey('img.png', 4, 4, 'floyd-steinberg', dataLow);
  const keyHigh = buildDitherCacheKey('img.png', 4, 4, 'floyd-steinberg', dataHigh);
  assert(keyLow !== keyHigh, 'different adjustedData of same length -> different cache keys');
}

// ── 8. buildDitherCacheKey: identical inputs -> identical keys ──
{
  const data = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90]);
  const k1 = buildDitherCacheKey('img.png', 3, 3, 'atkinson', data);
  const k2 = buildDitherCacheKey('img.png', 3, 3, 'atkinson', data);
  assert(k1 === k2, 'identical inputs -> identical key (cache hits work)');
}

// ── 9. buildDitherCacheKey: different srcs -> different keys ──
{
  const data = new Uint8Array([1, 2, 3, 4]);
  const k1 = buildDitherCacheKey('a.png', 2, 2, 'floyd-steinberg', data);
  const k2 = buildDitherCacheKey('b.png', 2, 2, 'floyd-steinberg', data);
  assert(k1 !== k2, 'different loadSrc -> different keys (existing behavior preserved)');
}

// ── 10. buildDitherCacheKey: different dither modes -> different keys ──
{
  const data = new Uint8Array([5, 5, 5, 5]);
  const k1 = buildDitherCacheKey('img.png', 2, 2, 'floyd-steinberg', data);
  const k2 = buildDitherCacheKey('img.png', 2, 2, 'atkinson', data);
  assert(k1 !== k2, 'different ditherMode -> different keys (existing behavior preserved)');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
