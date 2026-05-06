/**
 * T2-104: versioned user-data migration framework. Pre-T2-104 each
 * loader had ad-hoc compatibility code; schema evolution accumulated
 * cruft.
 *
 * Run: npx tsx tests/user-data-migration.test.ts
 */
import {
  ALL_DATA_DOMAINS,
  detectUserDataVersion,
  UserDataMigrationRegistry,
  migrateUserData,
  userDataNeedsMigration,
  describeUserDataMigration,
  MissingDomainMigrationError,
  FutureUserDataVersionError,
  type DataDomain,
} from '../src/storage/UserDataMigration';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-104 user-data migration framework ===\n');

void (async () => {

// 1. ALL_DATA_DOMAINS lists 10 domains
{
  assert(ALL_DATA_DOMAINS.length === 10, `10 domains`);
  for (const d of [
    'device_profile', 'material_preset', 'license_cache',
    'autosave', 'job_log', 'settings',
    'replay', 'correlation_state', 'history', 'other',
  ]) {
    assert(ALL_DATA_DOMAINS.includes(d as DataDomain), `'${d}' present`);
  }
}

// 2. detectUserDataVersion: missing → 1
{
  assert(detectUserDataVersion({}) === 1, `missing version → 1`);
  assert(detectUserDataVersion({ version: undefined }) === 1, `undefined → 1`);
}

// 3. detectUserDataVersion: explicit number
{
  assert(detectUserDataVersion({ version: 3 }) === 3, `explicit 3`);
}

// 4. detectUserDataVersion: invalid type → 1
{
  assert(detectUserDataVersion({ version: 'two' }) === 1, `string → 1`);
  assert(detectUserDataVersion({ version: 1.5 }) === 1, `non-int → 1`);
  assert(detectUserDataVersion({ version: -1 }) === 1, `negative → 1`);
  assert(detectUserDataVersion(null) === 1, `null → 1`);
}

// 5. Registry: register first step at v1 OK
{
  const reg = new UserDataMigrationRegistry();
  reg.register({
    domain: 'device_profile', fromVersion: 1, toVersion: 2,
    apply: (r) => r,
  });
  assert(reg.size() === 1, `size=1`);
  assert(reg.stepsFor('device_profile').length === 1, `1 step`);
}

// 6. Registry: first step must start at v1
{
  const reg = new UserDataMigrationRegistry();
  let threw = false;
  try {
    reg.register({
      domain: 'device_profile', fromVersion: 2, toVersion: 3,
      apply: (r) => r,
    });
  } catch { threw = true; }
  assert(threw, `first step != v1 throws`);
}

// 7. Registry: contiguous chain enforced
{
  const reg = new UserDataMigrationRegistry();
  reg.register({ domain: 'device_profile', fromVersion: 1, toVersion: 2, apply: (r) => r });
  let threw = false;
  try {
    reg.register({ domain: 'device_profile', fromVersion: 3, toVersion: 4, apply: (r) => r });
  } catch { threw = true; }
  assert(threw, `non-contiguous step throws`);
}

// 8. Registry: monotonic toVersion enforced
{
  const reg = new UserDataMigrationRegistry();
  let threw = false;
  try {
    reg.register({
      domain: 'device_profile', fromVersion: 2, toVersion: 1,
      apply: (r) => r,
    });
  } catch { threw = true; }
  assert(threw, `toVersion <= fromVersion throws`);
}

// 9. Registry: chain across domains is independent
{
  const reg = new UserDataMigrationRegistry();
  reg.register({ domain: 'device_profile', fromVersion: 1, toVersion: 2, apply: (r) => r });
  reg.register({ domain: 'material_preset', fromVersion: 1, toVersion: 2, apply: (r) => r });
  assert(reg.size() === 2, `2 steps total`);
  assert(reg.domainsWithSteps().length === 2, `2 domains`);
}

// 10. isChainComplete: complete vs incomplete
{
  const reg = new UserDataMigrationRegistry();
  reg.register({ domain: 'device_profile', fromVersion: 1, toVersion: 2, apply: (r) => r });
  reg.register({ domain: 'device_profile', fromVersion: 2, toVersion: 3, apply: (r) => r });
  assert(reg.isChainComplete('device_profile', 3), `1→3 complete`);
  assert(!reg.isChainComplete('device_profile', 4), `1→4 incomplete`);
  assert(reg.isChainComplete('material_preset', 1), `v1 → no steps needed`);
}

// 11. migrateUserData: same version → 0 steps
{
  const reg = new UserDataMigrationRegistry();
  const r = migrateUserData<{ version: number; foo: string }>({
    domain: 'device_profile',
    raw: { version: 2, foo: 'a' },
    currentVersion: 2,
    registry: reg,
  });
  assert(r.stepsApplied.length === 0, `0 steps`);
  assert(r.fromVersion === 2 && r.toVersion === 2, `from=to=2`);
  assert(r.result.foo === 'a', `payload preserved`);
}

// 12. migrateUserData: full chain walks each step
{
  const reg = new UserDataMigrationRegistry();
  reg.register({
    domain: 'device_profile', fromVersion: 1, toVersion: 2,
    apply: (r) => ({ ...(r as object), step1: true, version: 2 }),
  });
  reg.register({
    domain: 'device_profile', fromVersion: 2, toVersion: 3,
    apply: (r) => ({ ...(r as object), step2: true, version: 3 }),
  });
  const r = migrateUserData<{ original?: boolean; step1?: boolean; step2?: boolean }>({
    domain: 'device_profile',
    raw: { version: 1, original: true },
    currentVersion: 3,
    registry: reg,
  });
  assert(r.stepsApplied.length === 2, `2 steps`);
  assert(r.result.original === true && r.result.step1 === true && r.result.step2 === true,
    `each step's transform preserved`);
}

// 13. migrateUserData: missing version (=1) auto-detected
{
  const reg = new UserDataMigrationRegistry();
  reg.register({
    domain: 'autosave', fromVersion: 1, toVersion: 2,
    apply: (r) => ({ ...(r as object), upgraded: true, version: 2 }),
  });
  const r = migrateUserData<{ upgraded: boolean }>({
    domain: 'autosave',
    raw: { foo: 'bar' },  // no version field
    currentVersion: 2,
    registry: reg,
  });
  assert(r.fromVersion === 1, `treated as v1`);
  assert(r.result.upgraded === true, `step applied`);
}

// 14. migrateUserData: missing step throws MissingDomainMigrationError
{
  const reg = new UserDataMigrationRegistry();
  // skip v2->v3
  reg.register({
    domain: 'job_log', fromVersion: 1, toVersion: 2,
    apply: (r) => ({ ...(r as object), version: 2 }),
  });
  let caught: unknown = null;
  try {
    migrateUserData({
      domain: 'job_log',
      raw: { version: 1 },
      currentVersion: 3,
      registry: reg,
    });
  } catch (e) { caught = e; }
  assert(caught instanceof MissingDomainMigrationError,
    `MissingDomainMigrationError`);
}

// 15. migrateUserData: future version throws FutureUserDataVersionError
{
  const reg = new UserDataMigrationRegistry();
  let caught: unknown = null;
  try {
    migrateUserData({
      domain: 'settings',
      raw: { version: 99 },
      currentVersion: 5,
      registry: reg,
    });
  } catch (e) { caught = e; }
  assert(caught instanceof FutureUserDataVersionError,
    `future version → FutureUserDataVersionError`);
}

// 16. userDataNeedsMigration: older + same
{
  assert(userDataNeedsMigration({ raw: { version: 1 }, currentVersion: 3 }), `v1 → 3 needs`);
  assert(!userDataNeedsMigration({ raw: { version: 3 }, currentVersion: 3 }), `same → not needed`);
  assert(!userDataNeedsMigration({ raw: { version: 5 }, currentVersion: 3 }),
    `v5 already > target → not needed (caller handles future-version separately)`);
}

// 17. describeUserDataMigration: clean
{
  const reg = new UserDataMigrationRegistry();
  const r = migrateUserData({
    domain: 'license_cache', raw: { version: 2 },
    currentVersion: 2, registry: reg,
  });
  const msg = describeUserDataMigration(r);
  assert(msg.includes('license_cache'), `domain named`);
  assert(msg.includes('v2'), `current version named`);
  assert(msg.includes('no migration'), `clean message`);
}

// 18. describeUserDataMigration: migrated
{
  const reg = new UserDataMigrationRegistry();
  reg.register({ domain: 'autosave', fromVersion: 1, toVersion: 2, apply: (r) => ({ ...(r as object), version: 2 }) });
  reg.register({ domain: 'autosave', fromVersion: 2, toVersion: 3, apply: (r) => ({ ...(r as object), version: 3 }) });
  const r = migrateUserData({
    domain: 'autosave', raw: { version: 1 },
    currentVersion: 3, registry: reg,
  });
  const msg = describeUserDataMigration(r);
  assert(msg.includes('v1') && msg.includes('v3'), `from→to`);
  assert(msg.includes('2 step'), `step count`);
}

// 19. THE audit's headline: Registry STARTS empty (framework, not migrations)
{
  const reg = new UserDataMigrationRegistry();
  assert(reg.size() === 0, `framework ships with 0 user-data migrations`);
}

// 20. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/storage/UserDataMigration.ts'), 'utf-8');
  assert(/T2-104/.test(src), 'T2-104 marker');
  for (const id of [
    'DataDomain', 'ALL_DATA_DOMAINS',
    'DomainMigrationStep', 'UserDataMigrationResult',
    'MissingDomainMigrationError', 'FutureUserDataVersionError',
    'detectUserDataVersion',
    'UserDataMigrationRegistry', 'migrateUserData',
    'userDataNeedsMigration', 'describeUserDataMigration',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
  for (const d of ['device_profile', 'material_preset', 'license_cache',
                   'autosave', 'job_log', 'settings', 'replay',
                   'correlation_state', 'history', 'other']) {
    assert(src.includes(`'${d}'`), `domain '${d}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
