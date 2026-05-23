/**
 * T2-69: atomic autosave record. Pre-T2-69 the autosave write was two
 * sequential `storage.set` calls (JSON to one key, ISO timestamp to
 * another); a crash between them left the JSON current but the
 * timestamp stale, and concurrent readers in another tab could
 * observe a partial state. Now both fields plus a checksum + scene
 * metadata live in a single record under one key, written in one
 * `storage.set`.
 *
 * Run: npx tsx tests/atomic-autosave-record.test.ts
 */
import {
  writeAutosaveAsync,
  readAutosave,
  clearAutosave,
  resetAutosaveForTest,
  autosaveRecordChecksumValid,
  type AutosaveRecord,
} from '../src/app/autosavePersistence';
import { setStorageForTest } from '../src/core/storage/storage';
import { InMemoryStorageAdapter } from '../src/core/storage/InMemoryStorageAdapter';

const RECORD_KEY = 'laserforge_autosave_record';
const CURRENT_SLOT_KEY = 'laserforge_autosave_current';
const PREVIOUS_SLOT_KEY = 'laserforge_autosave_previous';
const LEGACY_JSON_KEY = 'laserforge_autosave';
const LEGACY_TIME_KEY = 'laserforge_autosave_time';

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

console.log('\n=== T2-69 atomic autosave record ===\n');

void (async () => {

// 1. Round-trip: writeAutosaveAsync → readAutosave returns the JSON +
//    timestamp. Record key is written; legacy keys are NOT.
{
  const adapter = new InMemoryStorageAdapter();
  setStorageForTest(adapter);
  resetAutosaveForTest();

  const json = JSON.stringify({ name: 'My Scene', objects: [{ id: 'a' }, { id: 'b' }], layers: [{ id: 'l1' }] });
  await writeAutosaveAsync(json);

  const recordRaw = await adapter.get(RECORD_KEY);
  assert(recordRaw != null, 'round-trip: record key written');
  const legacyJson = await adapter.get(LEGACY_JSON_KEY);
  const legacyTime = await adapter.get(LEGACY_TIME_KEY);
  assert(legacyJson == null, 'round-trip: legacy JSON key NOT written');
  assert(legacyTime == null, 'round-trip: legacy time key NOT written');

  const payload = await readAutosave();
  assert(payload != null && payload.json === json,
    'round-trip: readAutosave returns the same JSON');
  assert(payload?.record?.checksum != null && typeof payload.record.checksum === 'string',
    'round-trip: record carries a checksum');
  assert(payload?.record?.sceneName === 'My Scene',
    `round-trip: extracted sceneName from JSON (got ${payload?.record?.sceneName})`);
  assert(payload?.record?.objectCount === 2,
    `round-trip: extracted objectCount (got ${payload?.record?.objectCount})`);
  assert(payload?.record?.layerCount === 1,
    `round-trip: extracted layerCount (got ${payload?.record?.layerCount})`);
}

// 2. Old-format autosave migrates to the new record on first read.
{
  const adapter = new InMemoryStorageAdapter();
  setStorageForTest(adapter);
  resetAutosaveForTest();

  const oldJson = JSON.stringify({ objects: [], layers: [] });
  const oldTime = '2025-01-15T12:00:00.000Z';
  await adapter.set(LEGACY_JSON_KEY, oldJson);
  await adapter.set(LEGACY_TIME_KEY, oldTime);

  const payload = await readAutosave();
  assert(payload != null && payload.json === oldJson,
    'legacy migration: readAutosave returns the legacy JSON');
  assert(payload?.timestamp === oldTime,
    `legacy migration: timestamp preserved (got ${payload?.timestamp})`);
  // After migration, the new record key should be populated.
  const recordRaw = await adapter.get(RECORD_KEY);
  assert(recordRaw != null,
    'legacy migration: new record key written after first read');
  if (recordRaw) {
    const record = JSON.parse(recordRaw) as AutosaveRecord;
    assert(record.json === oldJson && record.timestamp === oldTime,
      'legacy migration: record carries forwarded JSON + timestamp');
    assert(typeof record.checksum === 'string' && record.checksum.length > 0,
      'legacy migration: record gets a fresh checksum');
  }
}

// 3. Checksum mismatch detectable.
{
  const adapter = new InMemoryStorageAdapter();
  setStorageForTest(adapter);
  resetAutosaveForTest();

  const json = '{"objects":[]}';
  await writeAutosaveAsync(json);
  const recordRaw = await adapter.get(RECORD_KEY);
  if (!recordRaw) { failed++; console.error('  ✗ checksum: record missing'); }
  else {
    const record = JSON.parse(recordRaw) as AutosaveRecord;
    // Tamper the JSON without recomputing checksum.
    const tampered: AutosaveRecord = { ...record, json: '{"objects":[{"id":"x"}]}' };
    assert(autosaveRecordChecksumValid(record),
      'checksum: pristine record validates');
    assert(!autosaveRecordChecksumValid(tampered),
      'checksum: tampered JSON detected as mismatch');
  }
}

// 4. clearAutosave removes both legacy keys AND the new record key.
{
  const adapter = new InMemoryStorageAdapter();
  setStorageForTest(adapter);
  resetAutosaveForTest();

  // Pre-seed both old and new formats to verify clear cleans everything.
  await adapter.set(LEGACY_JSON_KEY, '{"a":1}');
  await adapter.set(LEGACY_TIME_KEY, '2025-01-01T00:00:00.000Z');
  await adapter.set(RECORD_KEY, JSON.stringify({
    version: 1, json: '{"a":1}', timestamp: '2025-01-01T00:00:00.000Z', checksum: '00000000',
  }));

  clearAutosave();
  // clearAutosave is fire-and-forget; await a microtask so the storage promises settle.
  await new Promise<void>(resolve => setTimeout(resolve, 30));

  assert((await adapter.get(LEGACY_JSON_KEY)) == null, 'clear: legacy JSON key removed');
  assert((await adapter.get(LEGACY_TIME_KEY)) == null, 'clear: legacy time key removed');
  assert((await adapter.get(RECORD_KEY)) == null, 'clear: record key removed');
}

// 5. Atomicity: a single storage.set call writes the whole record.
//    Verified by spying on the adapter's set method.
{
  const sets: Array<{ key: string; value: string }> = [];
  const adapter = new InMemoryStorageAdapter();
  const origSet = adapter.set.bind(adapter);
  adapter.set = async (k: string, v: string) => {
    sets.push({ key: k, value: v });
    return origSet(k, v);
  };
  setStorageForTest(adapter);
  resetAutosaveForTest();

  await writeAutosaveAsync('{"x":1}');
  // Filter to just the autosave-related writes (not migration setup).
  const autosaveSets = sets.filter(s =>
    s.key === RECORD_KEY || s.key === LEGACY_JSON_KEY || s.key === LEGACY_TIME_KEY,
  );
  assert(autosaveSets.length === 1,
    `atomicity: exactly one autosave-related set call per persistAutosave (got ${autosaveSets.length})`);
  assert(autosaveSets[0].key === RECORD_KEY,
    `atomicity: the single set goes to the record key (got ${autosaveSets[0].key})`);
}

// 6. Consecutive writes update the record in place (each call replaces
//    the prior record; no key sprawl).
{
  const adapter = new InMemoryStorageAdapter();
  setStorageForTest(adapter);
  resetAutosaveForTest();

  await writeAutosaveAsync('{"v":"first"}');
  await writeAutosaveAsync('{"v":"second"}');
  await writeAutosaveAsync('{"v":"third"}');

  const recordRaw = await adapter.get(RECORD_KEY);
  if (!recordRaw) { failed++; console.error('  ✗ consecutive writes: record missing'); }
  else {
    const record = JSON.parse(recordRaw) as AutosaveRecord;
    assert(record.json === '{"v":"third"}',
      `consecutive writes: latest JSON wins (got ${record.json})`);
  }
}

// 7. Missing autosave returns null.
{
  const adapter = new InMemoryStorageAdapter();
  setStorageForTest(adapter);
  resetAutosaveForTest();
  const payload = await readAutosave();
  assert(payload == null, 'no autosave: readAutosave returns null');
}

// 8. Live persistence rotates current -> previous backup slot.
{
  const adapter = new InMemoryStorageAdapter();
  setStorageForTest(adapter);
  resetAutosaveForTest();

  await writeAutosaveAsync('{"v":"first"}');
  await writeAutosaveAsync('{"v":"second"}');

  const currentRaw = await adapter.get(CURRENT_SLOT_KEY);
  const previousRaw = await adapter.get(PREVIOUS_SLOT_KEY);
  assert(currentRaw != null, 'backup slots: current slot written by live autosave');
  assert(previousRaw != null, 'backup slots: previous slot rotated by live autosave');
  const current = currentRaw ? JSON.parse(currentRaw) as AutosaveRecord : null;
  const previous = previousRaw ? JSON.parse(previousRaw) as AutosaveRecord : null;
  assert(current?.json === '{"v":"second"}',
    `backup slots: current slot has latest JSON (got ${current?.json})`);
  assert(previous?.json === '{"v":"first"}',
    `backup slots: previous slot has prior JSON (got ${previous?.json})`);
}

// 9. Live read falls back to previous when current slot is corrupt.
{
  const adapter = new InMemoryStorageAdapter();
  setStorageForTest(adapter);
  resetAutosaveForTest();

  await writeAutosaveAsync('{"v":"first"}');
  await writeAutosaveAsync('{"v":"second"}');
  await adapter.set(CURRENT_SLOT_KEY, '{not json');

  const payload = await readAutosave();
  assert(payload?.json === '{"v":"first"}',
    `backup slots: corrupt current falls back to previous (got ${payload?.json})`);
}

// 10. Live read falls back to previous when current slot is missing.
{
  const adapter = new InMemoryStorageAdapter();
  setStorageForTest(adapter);
  resetAutosaveForTest();

  await writeAutosaveAsync('{"v":"first"}');
  await writeAutosaveAsync('{"v":"second"}');
  await adapter.remove(CURRENT_SLOT_KEY);

  const payload = await readAutosave();
  assert(payload?.json === '{"v":"first"}',
    `backup slots: missing current falls back to previous (got ${payload?.json})`);
}

// 11. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(
    path.resolve(here, '../src/app/autosavePersistence.ts'),
    'utf-8',
  );
  assert(/T2-69/.test(src), 'T2-69 marker in autosavePersistence.ts');
  assert(/AUTOSAVE_RECORD_KEY/.test(src),
    'AUTOSAVE_RECORD_KEY constant declared');
  assert(/migrateAutosaveToRecordKey/.test(src),
    'one-shot legacy migration helper declared');
  assert(/autosaveRecordChecksumValid/.test(src),
    'autosaveRecordChecksumValid helper exported');
  assert(/AUTOSAVE_RECORD_VERSION = 1/.test(src),
    'pinned record version = 1');
  assert(/runAutosaveRotation/.test(src),
    'live autosave persistence wires the backup-slot rotation');
  assert(/readWithFallback/.test(src),
    'live autosave persistence wires backup-slot fallback reads');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
