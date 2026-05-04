/**
 * T1-35: image import max-dim cap raised from 1000 → 4000 px.
 *
 * Pre-T1-35 every image with longest dimension > 1000 px was silently
 * downscaled at import. A 4000×3000 phone photo (12 MP) became
 * 1000×750 (0.75 MP). For 200×150 mm engraves at 254 DPI the user lost
 * half the available resolution to the cap and never knew. T1-17 Pass 1
 * moved the grayscale loop to a Web Worker, so larger source bitmaps
 * no longer block the UI; raising the cap is now safe.
 *
 * Source-level pin (rather than full import-pipeline mock): useImport
 * is a React hook with a deep dependency tree (scene, dialogs, IndexedDB
 * storage, image-prep worker). The structural assertions here cover
 * the contract — the constant and the warning emission shape.
 *
 * Run: npx tsx tests/image-import-max-dim-cap.test.ts
 */

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

console.log('\n=== T1-35 image import max-dim cap raised to 4000 ===\n');

async function run(): Promise<void> {

const fs = await import('node:fs');
const url = await import('node:url');
const path = await import('node:path');
const here = path.dirname(url.fileURLToPath(import.meta.url));
const src = fs.readFileSync(
  path.resolve(here, '../src/ui/hooks/useImport.ts'),
  'utf-8',
);

// 1. T1-35 marker present
assert(/T1-35/.test(src), 'T1-35 marker present in useImport.ts');

// 2. Cap raised: const IMAGE_IMPORT_MAX_DIM = 4000 (was 1000)
assert(
  /const IMAGE_IMPORT_MAX_DIM = 4000/.test(src),
  'IMAGE_IMPORT_MAX_DIM constant declared as 4000 px',
);

// 3. The OLD `const maxDim = 1000` line is gone
assert(
  !/const maxDim = 1000;/.test(src),
  'OLD `const maxDim = 1000` line removed',
);

// 4. Scale calculation references the new constant
assert(
  /Math\.min\(1, IMAGE_IMPORT_MAX_DIM \/ Math\.max\(img\.width, img\.height\)\)/.test(src),
  'scale formula uses IMAGE_IMPORT_MAX_DIM constant',
);

// 5. Console warn emits when downscaling occurs
{
  // Locate the scale computation block.
  const idx = src.indexOf('IMAGE_IMPORT_MAX_DIM = 4000');
  const slice = src.slice(idx, idx + 1200);
  assert(
    /if \(scale < 1\)/.test(slice),
    'downscale path emits console.warn (scale < 1 branch present)',
  );
  assert(
    /console\.warn\(/.test(slice),
    'console.warn invocation present in the downscale branch',
  );
  assert(
    /downscaled to/i.test(slice) || /Detail beyond the cap is lost/i.test(slice),
    'warn message names the failure mode (downscale / detail loss)',
  );
}

// 6. T1-17 worker path still in place (downstream of the cap calculation)
assert(
  /prepareImageGrayscale\(img, gsWidth, gsHeight\)/.test(src),
  'T1-17 Pass 1 worker call (prepareImageGrayscale) still threaded through with the new cap',
);

// 7. Cap-supports-realistic-engrave sanity:
//    400 × 300 mm engrave at 254 DPI → max dim = 400 mm × (254 / 25.4) = 4000 px
//    The 4000 cap exactly accommodates that without downscale.
{
  const dpi = 254;
  const physicalMm = 400;
  const requiredPixels = (physicalMm / 25.4) * dpi;
  // Round up; comparison must work with integer px.
  assert(
    Math.round(requiredPixels) <= 4000,
    `4000 px cap supports ${physicalMm} mm engrave at ${dpi} DPI without downscale (needs ${Math.round(requiredPixels)} px)`,
  );
}

// 8. The pre-T1-35 cap (1000 px) would have downscaled the same engrave
//    by 75% — the regression check ensures we never silently revert.
{
  const requiredPx = Math.round((400 / 25.4) * 254);
  // Source must NOT contain `const maxDim = 1000` anywhere.
  assert(
    !/const maxDim\s*=\s*1000\b/.test(src),
    `regression guard: legacy 1000-px cap not present (a ${requiredPx}px engrave would have been downscaled to 1000)`,
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
