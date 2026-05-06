/**
 * T2-70: previous autosave backup slot. Pre-T2-70 a corrupt
 * autosave overwrote the only good copy on the next 30s tick.
 *
 * Run: npx tsx tests/autosave-previous-slot.test.ts
 */
import {
  AUTOSAVE_CURRENT_KEY,
  AUTOSAVE_PREVIOUS_KEY,
  keyForSlot,
  planAutosaveRotation,
  runAutosaveRotation,
  readWithFallback,
  clearBothSlots,
  describeSlotForRecovery,
  type AutosaveSlot,
  type AutosaveSlotStorage,
} from '../src/app/AutosaveBackupSlot';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-70 autosave previous-slot ===\n');

class MemStorage implements AutosaveSlotStorage {
  data = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }
  async remove(key: string): Promise<void> {
    this.data.delete(key);
  }
}

void (async () => {

// 1. Constants
{
  assert(AUTOSAVE_CURRENT_KEY === 'laserforge_autosave_current', `current key`);
  assert(AUTOSAVE_PREVIOUS_KEY === 'laserforge_autosave_previous', `previous key`);
}

// 2. keyForSlot mapping
{
  assert(keyForSlot('current') === AUTOSAVE_CURRENT_KEY, `current → current key`);
  assert(keyForSlot('previous') === AUTOSAVE_PREVIOUS_KEY, `previous → previous key`);
}

// 3. planAutosaveRotation: empty current → 1 write (no carry)
{
  const p = planAutosaveRotation({ existingCurrent: null, newSerialisedRecord: 'A' });
  assert(p.writes.length === 1, `1 write`);
  assert(p.writes[0].key === AUTOSAVE_CURRENT_KEY, `current write only`);
  assert(!p.carriedPreviousFromCurrent, `no carry`);
}

// 4. planAutosaveRotation: existing current → 2 writes (carry first)
{
  const p = planAutosaveRotation({ existingCurrent: 'old', newSerialisedRecord: 'B' });
  assert(p.writes.length === 2, `2 writes`);
  assert(p.writes[0].key === AUTOSAVE_PREVIOUS_KEY, `previous write FIRST`);
  assert(p.writes[0].value === 'old', `previous value = old current`);
  assert(p.writes[1].key === AUTOSAVE_CURRENT_KEY, `current write second`);
  assert(p.writes[1].value === 'B', `new value`);
  assert(p.carriedPreviousFromCurrent, `carried`);
}

// 5. runAutosaveRotation: first write — no previous yet
{
  const s = new MemStorage();
  const r = await runAutosaveRotation({ storage: s, newSerialisedRecord: 'A' });
  assert(s.data.get(AUTOSAVE_CURRENT_KEY) === 'A', `current=A`);
  assert(s.data.has(AUTOSAVE_PREVIOUS_KEY) === false, `no previous yet`);
  assert(r.currentWriteSucceeded, `current write OK`);
  assert(!r.carriedPreviousFromCurrent, `no carry`);
}

// 6. runAutosaveRotation: second write rotates A → previous, B → current
{
  const s = new MemStorage();
  await runAutosaveRotation({ storage: s, newSerialisedRecord: 'A' });
  await runAutosaveRotation({ storage: s, newSerialisedRecord: 'B' });
  assert(s.data.get(AUTOSAVE_CURRENT_KEY) === 'B', `current=B`);
  assert(s.data.get(AUTOSAVE_PREVIOUS_KEY) === 'A', `previous=A`);
}

// 7. runAutosaveRotation: third write — A discarded, B → previous, C → current
{
  const s = new MemStorage();
  await runAutosaveRotation({ storage: s, newSerialisedRecord: 'A' });
  await runAutosaveRotation({ storage: s, newSerialisedRecord: 'B' });
  await runAutosaveRotation({ storage: s, newSerialisedRecord: 'C' });
  assert(s.data.get(AUTOSAVE_CURRENT_KEY) === 'C', `current=C`);
  assert(s.data.get(AUTOSAVE_PREVIOUS_KEY) === 'B', `previous=B`);
}

// 8. readWithFallback: current present + parseable → returns current
{
  const s = new MemStorage();
  await runAutosaveRotation({ storage: s, newSerialisedRecord: '{"v":1}' });
  const r = await readWithFallback({ storage: s, parse: (raw) => JSON.parse(raw) });
  assert(r.which === 'current', `which=current`);
  assert(r.record !== null, `record present`);
  assert(r.fellBackBecause === null, `no fallback`);
}

// 9. THE audit's headline: current corrupt → falls back to previous
{
  const s = new MemStorage();
  await runAutosaveRotation({ storage: s, newSerialisedRecord: '{"v":"good"}' });
  await runAutosaveRotation({ storage: s, newSerialisedRecord: '{"v":"good2"}' });
  // Tamper with current to make it unparseable:
  await s.set(AUTOSAVE_CURRENT_KEY, '{not json');
  const r = await readWithFallback({ storage: s, parse: (raw) => JSON.parse(raw) });
  assert(r.which === 'previous', `falls back to previous`);
  assert(r.fellBackBecause === 'current-unparseable', `reason=current-unparseable`);
  assert((r.record as { v: string }).v === 'good', `previous record returned`);
}

// 10. readWithFallback: current empty → falls back to previous
{
  const s = new MemStorage();
  await runAutosaveRotation({ storage: s, newSerialisedRecord: '{"v":1}' });
  await runAutosaveRotation({ storage: s, newSerialisedRecord: '{"v":2}' });
  await s.remove(AUTOSAVE_CURRENT_KEY);
  const r = await readWithFallback({ storage: s, parse: (raw) => JSON.parse(raw) });
  assert(r.which === 'previous', `previous returned`);
  assert(r.fellBackBecause === 'current-empty', `reason=current-empty`);
}

// 11. readWithFallback: both empty → null
{
  const s = new MemStorage();
  const r = await readWithFallback({ storage: s, parse: (raw) => JSON.parse(raw) });
  assert(r.record === null, `null record`);
  assert(r.which === null, `which=null`);
  assert(r.fellBackBecause === 'current-empty', `still reports empty fallback`);
}

// 12. readWithFallback: current parseable wins even with previous present
{
  const s = new MemStorage();
  await runAutosaveRotation({ storage: s, newSerialisedRecord: '{"v":"old"}' });
  await runAutosaveRotation({ storage: s, newSerialisedRecord: '{"v":"new"}' });
  const r = await readWithFallback({ storage: s, parse: (raw) => JSON.parse(raw) });
  assert(r.which === 'current', `current wins`);
  assert((r.record as { v: string }).v === 'new', `latest data`);
}

// 13. readWithFallback: both unparseable → null + reason carried
{
  const s = new MemStorage();
  await s.set(AUTOSAVE_CURRENT_KEY, 'broken1');
  await s.set(AUTOSAVE_PREVIOUS_KEY, 'broken2');
  const r = await readWithFallback({ storage: s, parse: (raw) => JSON.parse(raw) });
  assert(r.record === null, `null when both broken`);
  assert(r.fellBackBecause === 'current-unparseable', `reason=current-unparseable`);
}

// 14. clearBothSlots: removes both
{
  const s = new MemStorage();
  await s.set(AUTOSAVE_CURRENT_KEY, 'A');
  await s.set(AUTOSAVE_PREVIOUS_KEY, 'B');
  await clearBothSlots(s);
  assert(!s.data.has(AUTOSAVE_CURRENT_KEY), `current cleared`);
  assert(!s.data.has(AUTOSAVE_PREVIOUS_KEY), `previous cleared`);
}

// 15. clearBothSlots: idempotent on empty
{
  const s = new MemStorage();
  await clearBothSlots(s);
  assert(true, `no throw on empty`);
}

// 16. describeSlotForRecovery: current shape
{
  const desc = describeSlotForRecovery(
    'current',
    { timestamp: new Date('2026-05-06T14:32:00Z').getTime(), objectCount: 3, layerCount: 2 },
  );
  assert(desc.startsWith('Latest autosave:'), `Latest prefix`);
  assert(desc.includes('3 objects'), `object count`);
  assert(desc.includes('2 layers'), `layer count`);
}

// 17. describeSlotForRecovery: previous shape
{
  const desc = describeSlotForRecovery(
    'previous',
    { timestamp: 0, objectCount: 1, layerCount: 1 },
  );
  assert(desc.startsWith('Previous autosave:'), `Previous prefix`);
  assert(desc.includes('1 object,'), `singular object`);
  assert(desc.includes('1 layer'), `singular layer`);
}

// 18. describeSlotForRecovery: missing counts → no parens
{
  const desc = describeSlotForRecovery('current', { timestamp: 0 });
  assert(!desc.includes('('), `no metadata parens`);
}

// 19. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/app/AutosaveBackupSlot.ts'), 'utf-8');
  assert(/T2-70/.test(src), 'T2-70 marker');
  for (const id of [
    'AutosaveSlot', 'AUTOSAVE_CURRENT_KEY', 'AUTOSAVE_PREVIOUS_KEY',
    'keyForSlot', 'AutosaveSlotStorage', 'RotationPlan',
    'planAutosaveRotation', 'runAutosaveRotation',
    'SlotReadResult', 'readWithFallback',
    'clearBothSlots', 'describeSlotForRecovery',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
  for (const s of ['current', 'previous']) {
    assert(src.includes(`'${s}'`), `slot '${s}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
