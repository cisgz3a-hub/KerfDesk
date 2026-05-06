/**
 * T2-116: storage health reporting. Pre-T2-116 there was no surface
 * answering "how full is storage?" — autosave silently failed when
 * full. Audit 5C Required Priority 13.
 *
 * Run: npx tsx tests/storage-health.test.ts
 */
import {
  classifyKey,
  emptyDomainBreakdown,
  emptyStorageHealth,
  estimateValueBytes,
  buildStorageHealth,
  isStorageWarning,
  describeStorageHealth,
  STORAGE_WARNING_THRESHOLD_PERCENT,
} from '../src/diagnostics/StorageHealth';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-116 Storage health ===\n');

void (async () => {

// 1. classifyKey: autosave prefixes
{
  for (const key of ['laserforge_autosave', 'laserforge_autosave_record', 'laserforge_autosave_time']) {
    assert(classifyKey(key) === 'autosave', `'${key}' → autosave`);
  }
}

// 2. classifyKey: jobLogs (both prefixes)
{
  assert(classifyKey('laserforge_job_log_x') === 'jobLogs', `laserforge_job_log_x → jobLogs`);
  assert(classifyKey('joblog_y') === 'jobLogs', `joblog_y → jobLogs`);
}

// 3. classifyKey: replays
{
  assert(classifyKey('laserforge_replay_a') === 'replays', `replay → replays`);
  assert(classifyKey('replay_b') === 'replays', `replay_b → replays`);
}

// 4. classifyKey: device profiles
{
  assert(classifyKey('laserforge_device_profile_x') === 'deviceProfiles',
    `device profile classified`);
  assert(classifyKey('deviceProfile_a') === 'deviceProfiles',
    `deviceProfile_ classified`);
}

// 5. classifyKey: materials
{
  assert(classifyKey('laserforge_material_a') === 'materials',
    `material → materials`);
  assert(classifyKey('materialPreset_b') === 'materials',
    `materialPreset_ → materials`);
}

// 6. classifyKey: licenseCache (including legacy 'laserforge_pro')
{
  assert(classifyKey('laserforge_license') === 'licenseCache', `license → licenseCache`);
  assert(classifyKey('laserforge_license_cache') === 'licenseCache', `license_cache → licenseCache`);
  assert(classifyKey('laserforge_pro') === 'licenseCache',
    `legacy 'laserforge_pro' → licenseCache`);
}

// 7. classifyKey: history
{
  assert(classifyKey('laserforge_history') === 'history', `history`);
}

// 8. classifyKey: correlationState (T2-117)
{
  assert(classifyKey('laserforge_correlation_state') === 'correlationState',
    `correlation state`);
}

// 9. classifyKey: settings + window prefs
{
  assert(classifyKey('laserforge_settings_x') === 'settings', `settings`);
  assert(classifyKey('laserforge_window_size') === 'settings',
    `window prefs → settings`);
}

// 10. classifyKey: unknown → other
{
  assert(classifyKey('random_key') === 'other', `unknown → other`);
  assert(classifyKey('') === 'other', `empty → other`);
}

// 11. emptyDomainBreakdown: every domain at 0
{
  const b = emptyDomainBreakdown();
  for (const k of Object.keys(b)) {
    assert(b[k as keyof typeof b] === 0, `${k}: 0`);
  }
}

// 12. emptyStorageHealth: zero state
{
  const h = emptyStorageHealth();
  assert(h.totalBytes === 0, `totalBytes=0`);
  assert(h.lastSaveFailures.length === 0, `no failures`);
  assert(h.prunedRecords.length === 0, `no prunes`);
  assert(h.quota === undefined, `no quota`);
}

// 13. estimateValueBytes: string + null + object
{
  assert(estimateValueBytes('hello') === 10, `'hello' → 10 (5 * 2)`);
  assert(estimateValueBytes(null) === 0, `null → 0`);
  assert(estimateValueBytes(undefined) === 0, `undefined → 0`);
  assert(estimateValueBytes({ a: 1 }) === 14, `{a:1} → 14 ('{"a":1}' * 2)`);
}

// 14. buildStorageHealth: classifies and sums per domain
{
  const h = buildStorageHealth({
    entries: [
      ['laserforge_autosave', 'a'.repeat(100)],
      ['joblog_x', 'b'.repeat(200)],
      ['joblog_y', 'b'.repeat(50)],
      ['laserforge_settings_x', 'c'.repeat(10)],
    ],
  });
  assert(h.byDomain.autosave === 200, `autosave 100 chars → 200 bytes`);
  assert(h.byDomain.jobLogs === 500, `jobLogs 250 chars → 500 bytes`);
  assert(h.byDomain.settings === 20, `settings 10 chars → 20 bytes`);
  assert(h.totalBytes === 720, `total = 720`);
}

// 15. buildStorageHealth: empty entries → zero
{
  const h = buildStorageHealth({ entries: [] });
  assert(h.totalBytes === 0, `0 entries → 0 bytes`);
}

// 16. buildStorageHealth: quota fields populated when supplied
{
  const h = buildStorageHealth({
    entries: [['laserforge_autosave', 'x'.repeat(1024)]],
    quotaBytesUsed: 50 * 1024 * 1024,
    quotaBytesAvailable: 100 * 1024 * 1024,
  });
  assert(h.quota?.bytesUsed === 50 * 1024 * 1024, `quota.bytesUsed`);
  assert(h.quota?.bytesAvailable === 100 * 1024 * 1024, `quota.bytesAvailable`);
  assert(h.quota?.percentUsed === 50, `percentUsed=50`);
}

// 17. buildStorageHealth: percent rounding to 2 decimals
{
  const h = buildStorageHealth({
    entries: [],
    quotaBytesUsed: 333,
    quotaBytesAvailable: 1000,
  });
  assert(h.quota?.percentUsed === 33.3, `333/1000 = 33.3% (got ${h.quota?.percentUsed})`);
}

// 18. buildStorageHealth: zero/missing quota leaves quota undefined
{
  const h1 = buildStorageHealth({ entries: [] });
  assert(h1.quota === undefined, `no quota args → undefined`);
  const h2 = buildStorageHealth({
    entries: [], quotaBytesUsed: 100, quotaBytesAvailable: 0,
  });
  assert(h2.quota === undefined, `available=0 → quota undefined`);
}

// 19. lastSaveFailures + prunedRecords carried through
{
  const failures = [
    { timestamp: '2026-05-06T00:00:00.000Z', domain: 'autosave' as const, error: 'quota exceeded' },
  ];
  const pruned = [
    { timestamp: '2026-05-06T00:00:00.000Z', domain: 'jobLogs' as const, reason: 'quota' as const, count: 5 },
  ];
  const h = buildStorageHealth({
    entries: [], lastSaveFailures: failures, prunedRecords: pruned,
  });
  assert(h.lastSaveFailures.length === 1, `failures carried`);
  assert(h.prunedRecords.length === 1, `prunes carried`);
}

// 20. STORAGE_WARNING_THRESHOLD_PERCENT = 80
{
  assert(STORAGE_WARNING_THRESHOLD_PERCENT === 80,
    `threshold = 80%`);
}

// 21. isStorageWarning: false at < threshold
{
  const h = buildStorageHealth({
    entries: [], quotaBytesUsed: 50, quotaBytesAvailable: 100,
  });
  assert(!isStorageWarning(h), `50% not warning`);
}

// 22. isStorageWarning: true at threshold
{
  const h = buildStorageHealth({
    entries: [], quotaBytesUsed: 80, quotaBytesAvailable: 100,
  });
  assert(isStorageWarning(h), `80% IS warning (threshold)`);
}

// 23. isStorageWarning: true on recent save failure even without quota
{
  const recent = new Date(Date.now() - 60 * 1000).toISOString();   // 1min ago
  const h = buildStorageHealth({
    entries: [],
    lastSaveFailures: [{ timestamp: recent, domain: 'autosave', error: 'q' }],
  });
  assert(isStorageWarning(h),
    `recent save failure without quota → warning`);
}

// 24. isStorageWarning: false on old save failure
{
  const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();  // 1h ago
  const h = buildStorageHealth({
    entries: [],
    lastSaveFailures: [{ timestamp: old, domain: 'autosave', error: 'q' }],
  });
  assert(!isStorageWarning(h),
    `old save failure (>5 min) → no warning`);
}

// 25. describeStorageHealth: with quota
{
  const h = buildStorageHealth({
    entries: [], quotaBytesUsed: 47 * 1024 * 1024,
    quotaBytesAvailable: 50 * 1024 * 1024,
  });
  const desc = describeStorageHealth(h);
  assert(desc.includes('47.0 MB') && desc.includes('50 MB') && desc.includes('94'),
    `with quota: '47.0 MB / 50 MB available (94%)' (got '${desc}')`);
}

// 26. describeStorageHealth: without quota → just total
{
  const h = buildStorageHealth({
    entries: [['laserforge_autosave', 'x'.repeat(500_000)]],
  });
  const desc = describeStorageHealth(h);
  assert(/\d+\.\d MB stored/.test(desc),
    `without quota: 'X.X MB stored' (got '${desc}')`);
}

// 27. End-to-end: realistic load
{
  const oneKb = 'x'.repeat(512);
  const entries: Array<[string, unknown]> = [];
  for (let i = 0; i < 20; i++) entries.push([`joblog_${i}`, oneKb]);
  for (let i = 0; i < 5; i++) entries.push([`laserforge_replay_${i}`, oneKb]);
  entries.push(['laserforge_autosave_record', oneKb]);
  const h = buildStorageHealth({
    entries,
    quotaBytesUsed: 50 * 1024 * 1024,
    quotaBytesAvailable: 100 * 1024 * 1024,
  });
  assert(h.byDomain.jobLogs > h.byDomain.replays, `jobLogs > replays`);
  assert(h.byDomain.autosave > 0, `autosave > 0`);
  assert(h.totalBytes === entries.length * 1024,
    `total = entries.length × 1024`);
}

// 28. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/diagnostics/StorageHealth.ts'), 'utf-8');
  assert(/T2-116/.test(src), 'T2-116 marker in StorageHealth.ts');
  for (const id of [
    'StorageDomain', 'DomainBreakdown', 'QuotaInfo',
    'SaveFailure', 'PrunedRecord', 'StorageHealth',
    'classifyKey', 'emptyDomainBreakdown', 'emptyStorageHealth',
    'estimateValueBytes', 'buildStorageHealth',
    'isStorageWarning', 'describeStorageHealth',
    'STORAGE_WARNING_THRESHOLD_PERCENT',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
