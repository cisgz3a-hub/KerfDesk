/**
 * T2-38: CapabilityValue<T> with source/confidence/verifiedAt.
 * Pre-T2-38 a value of `1000` could mean any of: verified $30=1000,
 * profile-set, fallback-default, or stale profile — no way to tell.
 * Audit 3C Finding 3.2 + Required Priority 1.
 *
 * Run: npx tsx tests/capability-value-resolution.test.ts
 */
import {
  verifiedFromFirmware,
  manualFromProfile,
  fallbackDefault,
  unknownValue,
  resolveCapabilityValue,
  meetsConfidence,
  valueOrNull,
  valueOrThrow,
  confidenceLabel,
  describeCapabilityValue,
} from '../src/controllers/CapabilityValue';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-38 CapabilityValue resolution ===\n');

void (async () => {

// 1. verifiedFromFirmware
{
  const v = verifiedFromFirmware(1000, 12345);
  assert(v.value === 1000 && v.source === 'firmware'
      && v.confidence === 'verified' && v.verifiedAt === 12345,
    `verifiedFromFirmware shape`);
}

// 2. manualFromProfile
{
  const v = manualFromProfile(800);
  assert(v.value === 800 && v.source === 'profile'
      && v.confidence === 'manual' && v.verifiedAt === undefined,
    `manualFromProfile shape (no verifiedAt)`);
}

// 3. fallbackDefault
{
  const v = fallbackDefault(1000);
  assert(v.value === 1000 && v.source === 'default'
      && v.confidence === 'fallback',
    `fallbackDefault shape`);
}

// 4. unknownValue
{
  const v = unknownValue<number>();
  assert(v.value === null && v.source === 'unknown' && v.confidence === 'unknown',
    `unknownValue: null + unknown/unknown`);
}

// 5. Resolve: firmware wins over profile + default
{
  const v = resolveCapabilityValue({
    firmware: 1000, profile: 500, defaultValue: 100, now: 9000,
  });
  assert(v.value === 1000 && v.confidence === 'verified',
    `firmware wins (got value=${v.value} confidence=${v.confidence})`);
  assert(v.verifiedAt === 9000, `verifiedAt stamped`);
}

// 6. Resolve: profile wins when firmware null
{
  const v = resolveCapabilityValue({
    firmware: null, profile: 500, defaultValue: 100, now: 9000,
  });
  assert(v.value === 500 && v.confidence === 'manual',
    `profile wins when firmware null`);
}

// 7. Resolve: profile wins when firmware undefined
{
  const v = resolveCapabilityValue({
    profile: 500, defaultValue: 100, now: 9000,
  });
  assert(v.value === 500 && v.confidence === 'manual',
    `profile wins when firmware undefined`);
}

// 8. Resolve: default wins when firmware + profile null
{
  const v = resolveCapabilityValue({
    firmware: null, profile: null, defaultValue: 100, now: 9000,
  });
  assert(v.value === 100 && v.confidence === 'fallback',
    `default wins`);
}

// 9. Resolve: unknown when no source has a value
{
  const v = resolveCapabilityValue<number>({ now: 9000 });
  assert(v.value === null && v.confidence === 'unknown',
    `no source: unknown`);
}

// 10. Resolve: zero is a real value, not "missing"
{
  const v = resolveCapabilityValue({ firmware: 0, profile: 500, defaultValue: 100, now: 9000 });
  assert(v.value === 0 && v.confidence === 'verified',
    `firmware=0 is honoured (not treated as missing)`);
}

// 11. Resolve: false is a real value (boolean fields)
{
  const v = resolveCapabilityValue({ firmware: false, profile: true, defaultValue: false, now: 9000 });
  assert(v.value === false && v.confidence === 'verified',
    `firmware=false honoured`);
}

// 12. meetsConfidence: rank-based comparison
{
  const verified = verifiedFromFirmware(1, 0);
  const manual = manualFromProfile(1);
  const fallback = fallbackDefault(1);
  const unknown = unknownValue<number>();
  // verified ≥ verified
  assert(meetsConfidence(verified, 'verified'), `verified ≥ verified`);
  // verified ≥ manual ≥ fallback ≥ unknown
  assert(meetsConfidence(verified, 'manual'), `verified ≥ manual`);
  assert(meetsConfidence(manual, 'manual'), `manual ≥ manual`);
  assert(!meetsConfidence(manual, 'verified'), `manual < verified`);
  assert(meetsConfidence(fallback, 'fallback'), `fallback ≥ fallback`);
  assert(!meetsConfidence(fallback, 'manual'), `fallback < manual`);
  assert(meetsConfidence(unknown, 'unknown'), `unknown ≥ unknown`);
  assert(!meetsConfidence(unknown, 'fallback'), `unknown < fallback`);
}

// 13. valueOrNull
{
  assert(valueOrNull(verifiedFromFirmware(1000, 0)) === 1000,
    `valueOrNull returns value`);
  assert(valueOrNull(unknownValue<number>()) === null,
    `valueOrNull returns null when missing`);
}

// 14. valueOrThrow: returns value when present
{
  assert(valueOrThrow(verifiedFromFirmware(1000, 0), 'maxSpindle') === 1000,
    `valueOrThrow returns value`);
}

// 15. valueOrThrow: throws when null with field name in message
{
  let caught: unknown = null;
  try { valueOrThrow(unknownValue<number>(), 'maxSpindle'); } catch (e) { caught = e; }
  assert(caught instanceof Error && /maxSpindle/.test(caught.message),
    `valueOrThrow throws naming the field`);
}

// 16. confidenceLabel: every confidence has a non-empty label
{
  for (const c of ['verified', 'manual', 'fallback', 'unknown'] as const) {
    const l = confidenceLabel(c);
    assert(l.length > 0, `confidenceLabel('${c}') non-empty`);
  }
}

// 17. describeCapabilityValue: includes value + source + confidence
{
  const d = describeCapabilityValue(verifiedFromFirmware(1000, Date.parse('2026-05-06T00:00:00Z')));
  assert(/1000/.test(d) && /firmware/.test(d) && /verified/.test(d) && /2026-05-06/.test(d),
    `describe includes value + source + confidence + ISO timestamp (got '${d}')`);
}

// 18. describeCapabilityValue: handles null
{
  const d = describeCapabilityValue(unknownValue<number>());
  assert(d.includes('<unknown>') && d.includes('unknown/unknown'),
    `null value: '<unknown>' placeholder`);
}

// 19. End-to-end resolution: scenarios from the spec
{
  // Connected with $30 known → resolveMaxSpindle returns firmware/verified
  const liveConnected = resolveCapabilityValue({ firmware: 1000, profile: 800, defaultValue: 1000, now: 100 });
  assert(liveConnected.confidence === 'verified',
    `connected + firmware known → verified`);

  // Disconnected with profile → profile/manual
  const disconnected = resolveCapabilityValue({ firmware: undefined, profile: 800, defaultValue: 1000, now: 100 });
  assert(disconnected.confidence === 'manual',
    `disconnected with profile → manual`);

  // No profile, no controller → default/fallback
  const blank = resolveCapabilityValue({ firmware: undefined, profile: undefined, defaultValue: 1000, now: 100 });
  assert(blank.confidence === 'fallback',
    `no profile, no controller → fallback`);
}

// 20. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/controllers/CapabilityValue.ts'), 'utf-8');
  assert(/T2-38/.test(src), 'T2-38 marker in CapabilityValue.ts');
  for (const id of [
    'CapabilityValue', 'CapabilitySource', 'CapabilityConfidence',
    'verifiedFromFirmware', 'manualFromProfile', 'fallbackDefault',
    'unknownValue', 'resolveCapabilityValue', 'meetsConfidence',
    'valueOrNull', 'valueOrThrow', 'confidenceLabel', 'describeCapabilityValue',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
