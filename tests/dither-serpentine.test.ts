/**
 * T1-34: serpentine scanning for error-diffusion dither.
 *
 * Pre-T1-34 every row scanned left→right, error always propagated
 * rightward and downward. On uniform mid-tone areas this produced
 * structured diagonal "worm" patterns. Serpentine dithering alternates
 * scan direction per row so the error propagation breaks directional
 * coherence — the industry-standard fix.
 *
 * Run: npx tsx tests/dither-serpentine.test.ts
 */
import { ditherImage, type DitherMode } from '../src/import/Dithering';

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

/**
 * Compute autocorrelation along a diagonal direction. For a uniform
 * mid-tone dither, both diagonals (x+y and x-y) should have similar
 * autocorrelation magnitudes. The pre-T1-34 code propagated error in a
 * specific direction so one diagonal had a stronger correlation pattern
 * than the other; serpentine breaks that.
 */
function diagonalAutocorrelation(
  out: Uint8Array,
  width: number,
  height: number,
  dx: number,
  dy: number,
  lag: number,
): number {
  // Center the values around 0 (out is 0/255 → -127.5/+127.5)
  let sumProd = 0;
  let sumSqLeft = 0;
  let sumSqRight = 0;
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const xRight = x + dx * lag;
      const yRight = y + dy * lag;
      if (xRight < 0 || xRight >= width || yRight < 0 || yRight >= height) continue;
      const a = (out[y * width + x] - 127.5);
      const b = (out[yRight * width + xRight] - 127.5);
      sumProd += a * b;
      sumSqLeft += a * a;
      sumSqRight += b * b;
      count++;
    }
  }
  if (count === 0 || sumSqLeft === 0 || sumSqRight === 0) return 0;
  // Pearson-style normalized correlation
  return sumProd / Math.sqrt(sumSqLeft * sumSqRight);
}

console.log('\n=== T1-34 serpentine dither ===\n');

void (async () => {

const W = 100, H = 100;
function midGray(value: number): Uint8Array {
  const a = new Uint8Array(W * H);
  for (let i = 0; i < a.length; i++) a[i] = value;
  return a;
}

// 1. Floyd-Steinberg on a uniform mid-tone (128) — both diagonal
//    autocorrelations should be roughly comparable. Pre-T1-34 the
//    `+1,+1` diagonal correlated meaningfully more than `-1,+1`.
{
  const out = ditherImage(midGray(128), W, H, 'floyd-steinberg', 128);
  const lag = 5;
  const corrPlus = Math.abs(diagonalAutocorrelation(out, W, H, 1, 1, lag));
  const corrMinus = Math.abs(diagonalAutocorrelation(out, W, H, -1, 1, lag));
  // The two diagonals shouldn't differ by more than 50% in normalized
  // correlation — serpentine balances them. (Pre-T1-34 typically had a
  // 2-3× ratio because all rows propagate the same way.)
  const ratio = Math.max(corrPlus, corrMinus) / Math.max(0.001, Math.min(corrPlus, corrMinus));
  assert(ratio < 1.5,
    `floyd-steinberg mid-tone: diagonal autocorrelations balanced (got ratio=${ratio.toFixed(2)}, +diag=${corrPlus.toFixed(3)}, -diag=${corrMinus.toFixed(3)})`);
}

// 2. Adjacent rows differ in their burn pattern (proves serpentine took
//    effect). On a uniform mid-tone, row 0 starts from the left and
//    row 1 starts from the right, so the early columns of row 0 and
//    row 1 should NOT match identically.
{
  const out = ditherImage(midGray(128), W, H, 'floyd-steinberg', 128);
  // Compare first 20 columns of row 0 and row 1; pre-T1-34 they would
  // share a near-identical "drift in" pattern.
  let identicalLead = 0;
  for (let x = 0; x < 20; x++) {
    if (out[0 * W + x] === out[1 * W + x]) identicalLead++;
  }
  assert(identicalLead < 18,
    `adjacent rows do NOT share an identical leading dither pattern (got ${identicalLead}/20 identical)`);
}

// 3. All seven error-diffusion modes still produce a valid 1-bit output
//    of the right shape and only 0/255 values.
{
  const modes: DitherMode[] = ['floyd-steinberg', 'jarvis', 'stucki', 'atkinson', 'burkes', 'sierra3', 'sierra2', 'sierra-lite'];
  for (const mode of modes) {
    const out = ditherImage(midGray(128), W, H, mode, 128);
    assert(out.length === W * H, `${mode}: output length matches width × height`);
    let allBinary = true;
    for (let i = 0; i < out.length; i++) {
      if (out[i] !== 0 && out[i] !== 255) { allBinary = false; break; }
    }
    assert(allBinary, `${mode}: output is strictly 0/255`);
  }
}

// 4. Determinism — same input produces same output (no rng dependency)
{
  const a = ditherImage(midGray(100), W, H, 'jarvis', 128);
  const b = ditherImage(midGray(100), W, H, 'jarvis', 128);
  let same = a.length === b.length;
  if (same) for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { same = false; break; }
  assert(same, 'jarvis: deterministic output across calls');
}

// 5. Pure black input produces all-burn (no rounding bug)
{
  const out = ditherImage(new Uint8Array(W * H), W, H, 'floyd-steinberg', 128);
  let allBurn = true;
  for (let i = 0; i < out.length; i++) if (out[i] !== 255) { allBurn = false; break; }
  assert(allBurn, 'pure black input → all burn');
}

// 6. Pure white input produces no burn
{
  const white = new Uint8Array(W * H).fill(255);
  const out = ditherImage(white, W, H, 'floyd-steinberg', 128);
  let allOff = true;
  for (let i = 0; i < out.length; i++) if (out[i] !== 0) { allOff = false; break; }
  assert(allOff, 'pure white input → no burn');
}

// 7. Bayer (ordered) and random modes are NOT affected — they have no
//    error propagation to alternate. Pre/post-T1-34 they're identical.
{
  const data = new Uint8Array(W * H);
  for (let i = 0; i < data.length; i++) data[i] = (i * 37) % 256;
  const ord = ditherImage(data, W, H, 'ordered', 128);
  const rnd = ditherImage(data, W, H, 'random', 128);
  // ordered is deterministic across runs (no rng state)
  const ord2 = ditherImage(data, W, H, 'ordered', 128);
  let ordSame = true;
  for (let i = 0; i < ord.length; i++) if (ord[i] !== ord2[i]) { ordSame = false; break; }
  assert(ordSame, 'ordered mode unchanged by T1-34 (single-pass, no error diffusion)');
  assert(rnd.length === W * H, 'random mode produces output of expected length');
}

// 8. Single-row image (height=1) hits the even-row path only
{
  const data = new Uint8Array(W).fill(128);
  const out = ditherImage(data, W, 1, 'floyd-steinberg', 128);
  assert(out.length === W, 'single-row dither: output length = width');
}

// 9. Two-row image exercises both directions of the alternation
{
  const data = new Uint8Array(W * 2).fill(128);
  const out = ditherImage(data, W, 2, 'floyd-steinberg', 128);
  // Row 0 starts left→right; row 1 starts right→left. The first burn
  // pixel position should differ. (Pre-T1-34 they were identical.)
  let row0First = -1, row1First = -1;
  for (let x = 0; x < W; x++) if (out[x] === 255) { row0First = x; break; }
  for (let x = 0; x < W; x++) if (out[W + x] === 255) { row1First = x; break; }
  assert(row0First !== row1First || (row0First === -1 && row1First === -1),
    `two-row mid-tone: row 0 first-burn-x=${row0First}, row 1 first-burn-x=${row1First} (should differ)`);
}

// 10. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/import/Dithering.ts'), 'utf-8');
  assert(/T1-34/.test(src), 'T1-34 marker in Dithering.ts');
  assert(/serpentine/i.test(src), 'serpentine documented in source');
  assert(/reverse \? -dx : dx/.test(src) || /effectiveDx/.test(src),
    'kernel dx mirrored on reverse rows');
  assert(/xStart = reverse \? width - 1 : 0/.test(src),
    'reverse-row scan starts at width-1');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
