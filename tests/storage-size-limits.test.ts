/**
 * T2-127: per-namespace storage size limits. Pre-T2-127
 * `electron/storage.ts:44-49` accepted any string value with no
 * size limit. Audit 5D DoS vector 6 + Required Priority 13.
 *
 * Run: npx tsx tests/storage-size-limits.test.ts
 */
import {
  NAMESPACE_LIMITS,
  StorageLimitError,
  byteLengthUtf8,
  checkValueSize,
  checkNamespaceTotal,
  checkSaveAllowed,
  storageLimitUserMessage,
  type StorageNamespace,
} from '../src/storage/StorageSizeLimits';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-127 Storage size limits ===\n');

const KB = 1024;
const MB = 1024 * 1024;

void (async () => {

// 1. NAMESPACE_LIMITS pin: audit-recommended values
{
  assert(NAMESPACE_LIMITS.profiles.maxValueBytes === 100 * KB,
    `profiles maxValue=100KB`);
  assert(NAMESPACE_LIMITS.profiles.maxTotalBytes === 5 * MB,
    `profiles maxTotal=5MB`);
  assert(NAMESPACE_LIMITS.materials.maxValueBytes === 100 * KB,
    `materials maxValue=100KB`);
  assert(NAMESPACE_LIMITS.autosave.maxValueBytes === 50 * MB,
    `autosave maxValue=50MB (large for project files with images)`);
  assert(NAMESPACE_LIMITS.jobLogs.maxValueBytes === 5 * MB,
    `jobLogs maxValue=5MB`);
  assert(NAMESPACE_LIMITS.jobLogs.maxTotalBytes === 100 * MB,
    `jobLogs maxTotal=100MB`);
  assert(NAMESPACE_LIMITS.settings.maxValueBytes === 50 * KB,
    `settings maxValue=50KB`);
  assert(NAMESPACE_LIMITS.licenseCache.maxValueBytes === 10 * KB,
    `licenseCache maxValue=10KB`);
}

// 2. byteLengthUtf8: ASCII = 1 byte each
{
  assert(byteLengthUtf8('hello') === 5, `'hello' = 5 bytes`);
  assert(byteLengthUtf8('') === 0, `'' = 0 bytes`);
}

// 3. byteLengthUtf8: 2-byte chars
{
  assert(byteLengthUtf8('é') === 2, `'é' = 2 bytes`);
  assert(byteLengthUtf8('ñ') === 2, `'ñ' = 2 bytes`);
}

// 4. byteLengthUtf8: 3-byte chars
{
  assert(byteLengthUtf8('中') === 3, `'中' = 3 bytes`);
}

// 5. byteLengthUtf8: emoji surrogate pairs = 4 bytes
{
  assert(byteLengthUtf8('🚀') === 4, `'🚀' = 4 bytes (surrogate pair)`);
}

// 6. byteLengthUtf8: lone surrogate falls back to 3
{
  // High surrogate without a paired low surrogate
  assert(byteLengthUtf8('\uD800') === 3, `lone surrogate = 3 bytes (replacement)`);
}

// 7. checkValueSize: under limit passes
{
  const value = 'x'.repeat(50 * KB);
  let threw = false;
  try { checkValueSize('profiles', value); } catch { threw = true; }
  assert(!threw, `50KB profiles value: passes (limit 100KB)`);
}

// 8. checkValueSize: at exact limit passes
{
  const value = 'x'.repeat(100 * KB);
  let threw = false;
  try { checkValueSize('profiles', value); } catch { threw = true; }
  assert(!threw, `100KB profiles at limit: passes`);
}

// 9. checkValueSize: over limit throws
{
  const value = 'x'.repeat(100 * KB + 1);
  let caught: unknown = null;
  try { checkValueSize('profiles', value); } catch (e) { caught = e; }
  assert(caught instanceof StorageLimitError,
    `100KB+1 profiles: throws StorageLimitError`);
  if (caught instanceof StorageLimitError) {
    assert(caught.kind === 'value-too-large', `kind='value-too-large'`);
    assert(caught.namespace === 'profiles', `namespace carried`);
    assert(caught.observed === 100 * KB + 1, `observed bytes carried`);
    assert(caught.limit === 100 * KB, `limit carried`);
  }
}

// 10. checkValueSize: per-namespace different limits
{
  // 200 KB OK for autosave (50 MB limit)
  const big = 'x'.repeat(200 * KB);
  let threw = false;
  try { checkValueSize('autosave', big); } catch { threw = true; }
  assert(!threw, `200KB autosave: passes (huge limit)`);
  // But same value rejected for licenseCache (10 KB limit)
  let caught: unknown = null;
  try { checkValueSize('licenseCache', big); } catch (e) { caught = e; }
  assert(caught instanceof StorageLimitError,
    `200KB licenseCache: rejected`);
}

// 11. checkNamespaceTotal: under total passes
{
  let threw = false;
  try {
    checkNamespaceTotal({
      namespace: 'profiles',
      currentBytes: 4 * MB,
      incomingBytes: 500 * KB,
    });
  } catch { threw = true; }
  assert(!threw, `4MB + 500KB < 5MB total: passes`);
}

// 12. checkNamespaceTotal: at exact total passes
{
  let threw = false;
  try {
    checkNamespaceTotal({
      namespace: 'profiles',
      currentBytes: 4 * MB,
      incomingBytes: 1 * MB,
    });
  } catch { threw = true; }
  assert(!threw, `4MB + 1MB = 5MB exact: passes`);
}

// 13. checkNamespaceTotal: would-exceed throws 'namespace-full'
{
  let caught: unknown = null;
  try {
    checkNamespaceTotal({
      namespace: 'profiles',
      currentBytes: 4 * MB + 600 * KB,
      incomingBytes: 500 * KB,
    });
  } catch (e) { caught = e; }
  assert(caught instanceof StorageLimitError,
    `would exceed 5MB: throws`);
  if (caught instanceof StorageLimitError) {
    assert(caught.kind === 'namespace-full', `kind='namespace-full'`);
  }
}

// 14. checkSaveAllowed: combined check passes
{
  let threw = false;
  try {
    checkSaveAllowed({
      namespace: 'profiles',
      value: 'x'.repeat(50 * KB),
      currentBytes: 1 * MB,
    });
  } catch { threw = true; }
  assert(!threw, `50KB profile + 1MB current: passes`);
}

// 15. checkSaveAllowed: value-too-large fires before namespace-full
{
  // Provide a value that's both too big AND would push past total
  const tooBig = 'x'.repeat(200 * KB);
  let caught: unknown = null;
  try {
    checkSaveAllowed({
      namespace: 'profiles',
      value: tooBig,
      currentBytes: 5 * MB,
    });
  } catch (e) { caught = e; }
  assert(caught instanceof StorageLimitError,
    `both fail: throws`);
  if (caught instanceof StorageLimitError) {
    assert(caught.kind === 'value-too-large',
      `value-too-large reported first (per-value check runs before total)`);
  }
}

// 16. checkSaveAllowed: namespace-full when value fits but total doesn't
{
  const value = 'x'.repeat(50 * KB);
  let caught: unknown = null;
  try {
    checkSaveAllowed({
      namespace: 'profiles',
      value,
      currentBytes: 5 * MB,
    });
  } catch (e) { caught = e; }
  assert(caught instanceof StorageLimitError,
    `value-fits but total full: throws`);
  if (caught instanceof StorageLimitError) {
    assert(caught.kind === 'namespace-full',
      `kind='namespace-full' when value fits`);
  }
}

// 17. THE audit's headline cases
{
  // 200KB device profile → rejected
  let caught1: unknown = null;
  try { checkValueSize('profiles', 'x'.repeat(200 * KB)); } catch (e) { caught1 = e; }
  assert(caught1 instanceof StorageLimitError, `200KB profile rejected`);

  // 80KB device profile → succeeds
  let threw = false;
  try { checkValueSize('profiles', 'x'.repeat(80 * KB)); } catch { threw = true; }
  assert(!threw, `80KB profile passes`);

  // Total > 5MB → next save rejected
  let caught2: unknown = null;
  try {
    checkSaveAllowed({
      namespace: 'profiles',
      value: 'x'.repeat(50 * KB),
      currentBytes: 5 * MB,
    });
  } catch (e) { caught2 = e; }
  assert(caught2 instanceof StorageLimitError,
    `total > 5MB: next save rejected`);
}

// 18. storageLimitUserMessage per kind
{
  const v = new StorageLimitError({
    kind: 'value-too-large', namespace: 'profiles',
    observed: 200 * KB, limit: 100 * KB,
    message: 'x',
  });
  const msg = storageLimitUserMessage(v);
  assert(msg.includes('200 KB') && msg.includes('100 KB'),
    `value-too-large message names both sizes (got '${msg}')`);

  const f = new StorageLimitError({
    kind: 'namespace-full', namespace: 'jobLogs',
    observed: 110 * MB, limit: 100 * MB,
    message: 'x',
  });
  const fMsg = storageLimitUserMessage(f);
  assert(fMsg.includes('110.0 MB') && fMsg.includes('100 MB')
      && fMsg.toLowerCase().includes('full'),
    `namespace-full message: '${fMsg}'`);
}

// 19. Every namespace has both limits defined
{
  const namespaces: StorageNamespace[] = [
    'profiles', 'materials', 'autosave', 'jobLogs', 'replays',
    'settings', 'licenseCache', 'history', 'correlationState', 'other',
  ];
  for (const ns of namespaces) {
    const l = NAMESPACE_LIMITS[ns];
    assert(l.maxValueBytes > 0 && l.maxTotalBytes > 0,
      `${ns}: positive limits (${l.maxValueBytes} / ${l.maxTotalBytes})`);
    assert(l.maxValueBytes <= l.maxTotalBytes,
      `${ns}: maxValue ≤ maxTotal`);
  }
}

// 20. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/storage/StorageSizeLimits.ts'), 'utf-8');
  assert(/T2-127/.test(src), 'T2-127 marker in StorageSizeLimits.ts');
  for (const id of [
    'StorageNamespace', 'NamespaceLimit', 'NAMESPACE_LIMITS',
    'StorageLimitErrorKind', 'StorageLimitError',
    'byteLengthUtf8', 'checkValueSize', 'checkNamespaceTotal',
    'checkSaveAllowed', 'storageLimitUserMessage',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
