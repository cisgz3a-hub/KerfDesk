/**
 * T2-124: pre-decode image limits. Pre-T2-124 the import flow
 * decoded the file fully before checking pixel count — a 50000×50000
 * PNG of one color compresses to ~1MB but decodes to 10GB,
 * crashing the renderer. Audit 5D Critical 8 + Required Priority 8.
 *
 * Run: npx tsx tests/image-decompression-bomb.test.ts
 */
import {
  IMAGE_LIMITS,
  ImageImportLimitError,
  checkImageFileSize,
  checkImageDimensions,
  checkImageBeforeDecode,
  imageLimitErrorMessage,
} from '../src/import/image/ImageImportLimits';

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

console.log('\n=== T2-124 Image decompression-bomb protection ===\n');

void (async () => {

// 1. IMAGE_LIMITS: declared values match audit recommendations
{
  assert(IMAGE_LIMITS.MAX_FILE_BYTES === 50 * 1024 * 1024,
    `MAX_FILE_BYTES = 50 MB`);
  assert(IMAGE_LIMITS.MAX_PIXELS === 50_000_000,
    `MAX_PIXELS = 50 megapixels`);
  assert(IMAGE_LIMITS.MAX_DIMENSION === 16_384,
    `MAX_DIMENSION = 16384`);
}

// 2. checkImageFileSize: passes at limit
{
  let threw = false;
  try { checkImageFileSize(IMAGE_LIMITS.MAX_FILE_BYTES); } catch { threw = true; }
  assert(!threw, 'file size at exact limit does NOT throw');
}

// 3. checkImageFileSize: throws at limit+1
{
  let caught: unknown = null;
  try { checkImageFileSize(IMAGE_LIMITS.MAX_FILE_BYTES + 1); } catch (e) { caught = e; }
  assert(caught instanceof ImageImportLimitError,
    'over-limit throws ImageImportLimitError');
  if (caught instanceof ImageImportLimitError) {
    assert(caught.limit === 'MAX_FILE_BYTES', `limit='MAX_FILE_BYTES'`);
    assert(caught.observed === IMAGE_LIMITS.MAX_FILE_BYTES + 1,
      `observed=limit+1`);
  }
}

// 4. The audit's "5GB BMP" case
{
  let caught: unknown = null;
  try { checkImageFileSize(5 * 1024 * 1024 * 1024); } catch (e) { caught = e; }
  assert(caught instanceof ImageImportLimitError,
    `5GB file rejected at file-size stage`);
}

// 5. checkImageDimensions: small image passes
{
  let threw = false;
  try { checkImageDimensions(5000, 5000); } catch { threw = true; }
  assert(!threw, '5000×5000 (25MP) within both limits → passes');
}

// 6. checkImageDimensions: at exact pixel limit
{
  // 50M pixels exactly: ~7071×7071
  let threw = false;
  try { checkImageDimensions(7071, 7071); } catch { threw = true; }
  assert(!threw, '7071×7071 (~50M) within MAX_PIXELS → passes');
}

// 7. The audit's headline case: 50000×50000 (small file, huge pixels)
{
  let caught: unknown = null;
  try { checkImageDimensions(50000, 50000); } catch (e) { caught = e; }
  assert(caught instanceof ImageImportLimitError,
    `50000×50000 rejected (decompression bomb)`);
  if (caught instanceof ImageImportLimitError) {
    // 50000 > MAX_DIMENSION (16384), so the dimension check fires first
    assert(caught.limit === 'MAX_DIMENSION',
      `bomb caught at MAX_DIMENSION (50000 > 16384) (got ${caught.limit})`);
    assert(caught.width === 50000 && caught.height === 50000,
      `error carries width + height`);
  }
}

// 8. Per-axis MAX_DIMENSION trips before pixel area calc
{
  // 17000 × 100 — total pixels 1.7M (well under MAX_PIXELS) but
  // single dimension exceeds MAX_DIMENSION
  let caught: unknown = null;
  try { checkImageDimensions(17000, 100); } catch (e) { caught = e; }
  assert(caught instanceof ImageImportLimitError,
    `17000×100 rejected on MAX_DIMENSION`);
  if (caught instanceof ImageImportLimitError) {
    assert(caught.limit === 'MAX_DIMENSION',
      `single-axis violation: limit='MAX_DIMENSION' (got ${caught.limit})`);
    assert(caught.observed === 17000,
      `observed = the offending dimension (got ${caught.observed})`);
  }
}

// 9. Both dimensions valid but total pixels exceed MAX_PIXELS
{
  // 10000 × 6000 = 60M pixels; both dims < 16384
  let caught: unknown = null;
  try { checkImageDimensions(10000, 6000); } catch (e) { caught = e; }
  assert(caught instanceof ImageImportLimitError,
    `10000×6000 (60M) rejected on MAX_PIXELS`);
  if (caught instanceof ImageImportLimitError) {
    assert(caught.limit === 'MAX_PIXELS',
      `area violation: limit='MAX_PIXELS' (got ${caught.limit})`);
    assert(caught.observed === 60_000_000,
      `observed = total pixel count (got ${caught.observed})`);
  }
}

// 10. checkImageDimensions: NaN / negative rejected
{
  for (const [w, h] of [[NaN, 100], [100, -1], [Infinity, 100]]) {
    let caught: unknown = null;
    try { checkImageDimensions(w, h); } catch (e) { caught = e; }
    assert(caught instanceof ImageImportLimitError,
      `(${w}, ${h}) rejected as invalid`);
  }
}

// 11. checkImageBeforeDecode: passes valid input + returns metadata
{
  const r = checkImageBeforeDecode({ fileBytes: 1024 * 1024, width: 1000, height: 800 });
  assert(r.width === 1000 && r.height === 800 && r.pixels === 800_000,
    `valid input: returns dimensions + computed pixel count`);
}

// 12. checkImageBeforeDecode: file-size failure surfaces first
{
  let caught: unknown = null;
  try {
    checkImageBeforeDecode({ fileBytes: 100 * 1024 * 1024, width: 1000, height: 1000 });
  } catch (e) { caught = e; }
  assert(caught instanceof ImageImportLimitError,
    `100MB file rejected before dimension check`);
  if (caught instanceof ImageImportLimitError) {
    assert(caught.limit === 'MAX_FILE_BYTES',
      `file-size failure surfaces first (got ${caught.limit})`);
  }
}

// 13. ImageImportLimitError: instanceof + name
{
  const err = new ImageImportLimitError('MAX_PIXELS', 100_000_000, { width: 10000, height: 10000 });
  assert(err.name === 'ImageImportLimitError', `name set`);
  assert(err instanceof Error, `extends Error`);
  assert(err instanceof ImageImportLimitError, `instanceof ImageImportLimitError`);
  assert(err.width === 10000 && err.height === 10000, `extras carried`);
}

// 14. imageLimitErrorMessage: file-size formatted in MB
{
  const err = new ImageImportLimitError('MAX_FILE_BYTES', 75 * 1024 * 1024);
  const msg = imageLimitErrorMessage(err);
  assert(msg.includes('75.0 MB') && msg.includes('50 MB'),
    `file-size message: '${msg}'`);
}

// 15. imageLimitErrorMessage: pixel message includes WxH and megapixels
{
  const err = new ImageImportLimitError('MAX_PIXELS', 60_000_000, { width: 10000, height: 6000 });
  const msg = imageLimitErrorMessage(err);
  assert(msg.includes('10000×6000') && msg.includes('60.0M') && msg.includes('50 megapixels'),
    `pixel message: '${msg}'`);
}

// 16. imageLimitErrorMessage: dimension message includes the offending side
{
  const err = new ImageImportLimitError('MAX_DIMENSION', 50000, { width: 50000, height: 50000 });
  const msg = imageLimitErrorMessage(err);
  assert(msg.includes('50,000') && msg.includes('16,384'),
    `dimension message: '${msg}'`);
}

// 17. imageLimitErrorMessage: non-limit error fallback
{
  const msg = imageLimitErrorMessage(new Error('decoder failed'));
  assert(/unexpected/i.test(msg) || /Cannot import/i.test(msg),
    `non-limit error → generic fallback (got '${msg}')`);
}

// 18. imageLimitErrorMessage: undefined / null safe
{
  assert(imageLimitErrorMessage(undefined).length > 0, 'undefined → message');
  assert(imageLimitErrorMessage(null).length > 0, 'null → message');
}

// 19. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/import/image/ImageImportLimits.ts'), 'utf-8');
  assert(/T2-124/.test(src), 'T2-124 marker in ImageImportLimits.ts');
  for (const id of [
    'IMAGE_LIMITS', 'ImageImportLimitError', 'checkImageFileSize',
    'checkImageDimensions', 'checkImageBeforeDecode', 'imageLimitErrorMessage',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
