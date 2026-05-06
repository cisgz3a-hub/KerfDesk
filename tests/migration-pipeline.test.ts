/**
 * T2-73: formal migration pipeline. Pre-T2-73 the version stayed
 * "0.1.0" hardcoded; ad-hoc legacy patches lived inside deserialize.
 *
 * Run: npx tsx tests/migration-pipeline.test.ts
 */
import {
  CURRENT_PROJECT_VERSION,
  VERSION_ORDER,
  MigrationRegistry,
  runMigrations,
  isVersionOlder,
  isKnownVersion,
  plannedMigrationKeys,
  fileNeedsMigration,
  describeMigrationResult,
  UnknownProjectVersionError,
  MissingMigrationError,
  FutureVersionError,
  type MigrationStep,
  type ProjectFileVersion,
} from '../src/io/migrations/MigrationPipeline';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-73 migration pipeline framework ===\n');

void (async () => {

// 1. CURRENT_PROJECT_VERSION matches the latest in VERSION_ORDER
{
  const last = VERSION_ORDER[VERSION_ORDER.length - 1];
  assert(CURRENT_PROJECT_VERSION === last, `current=last(VERSION_ORDER)`);
}

// 2. VERSION_ORDER strictly monotonic (lexically known good order)
{
  assert(VERSION_ORDER.length === 4, `4 versions tracked`);
  assert(VERSION_ORDER[0] === '0.1.0', `first=0.1.0`);
  assert(VERSION_ORDER[VERSION_ORDER.length - 1] === '1.2', `last=1.2`);
}

// 3. isKnownVersion: known + unknown
{
  assert(isKnownVersion('1.0'), `'1.0' known`);
  assert(!isKnownVersion('99.0'), `'99.0' unknown`);
  assert(!isKnownVersion(undefined), `undefined unknown`);
  assert(!isKnownVersion(123), `number unknown`);
}

// 4. isVersionOlder: 0.1.0 < 1.0 < 1.1 < 1.2
{
  assert(isVersionOlder('0.1.0', '1.0'), `0.1.0 < 1.0`);
  assert(isVersionOlder('1.0', '1.1'), `1.0 < 1.1`);
  assert(isVersionOlder('1.1', '1.2'), `1.1 < 1.2`);
  assert(!isVersionOlder('1.2', '1.1'), `not 1.2 < 1.1`);
  assert(!isVersionOlder('1.0', '1.0'), `not equal-as-older`);
}

// 5. plannedMigrationKeys: 0.1.0 → 1.2 produces 3 steps
{
  const keys = plannedMigrationKeys({ from: '0.1.0', to: '1.2' });
  assert(keys.length === 3, `3 steps`);
  assert(keys[0] === '0.1.0->1.0', `step 1`);
  assert(keys[1] === '1.0->1.1', `step 2`);
  assert(keys[2] === '1.1->1.2', `step 3`);
}

// 6. plannedMigrationKeys: same → same → []
{
  assert(plannedMigrationKeys({ from: '1.2', to: '1.2' }).length === 0, `same → 0`);
}

// 7. plannedMigrationKeys: down-migration not supported (returns [])
{
  assert(plannedMigrationKeys({ from: '1.2', to: '1.0' }).length === 0, `down → 0`);
}

// 8. MigrationRegistry: register + get
{
  const reg = new MigrationRegistry();
  const step: MigrationStep = {
    from: '0.1.0', to: '1.0',
    migrate: (raw) => raw,
    notes: 'no-op',
  };
  reg.register(step);
  assert(reg.get('0.1.0', '1.0')?.notes === 'no-op', `step retrievable`);
  assert(reg.size() === 1, `size=1`);
}

// 9. MigrationRegistry: duplicate register throws
{
  const reg = new MigrationRegistry();
  const step: MigrationStep = { from: '1.0', to: '1.1', migrate: (r) => r, notes: 'a' };
  reg.register(step);
  let threw = false;
  try { reg.register(step); } catch { threw = true; }
  assert(threw, `duplicate registration throws`);
}

// 10. runMigrations: same version → 0 steps applied + final = input
{
  const reg = new MigrationRegistry();
  const r = runMigrations({
    envelope: { version: '1.2', payload: { x: 1 } },
    target: '1.2',
    registry: reg,
  });
  assert(r.migrationsApplied.length === 0, `0 steps`);
  assert(r.fromVersion === '1.2', `from=1.2`);
  assert(r.toVersion === '1.2', `to=1.2`);
  assert((r.final.payload as { x: number }).x === 1, `payload preserved`);
}

// 11. runMigrations: full chain, walks every step
{
  const reg = new MigrationRegistry();
  reg.register({ from: '0.1.0', to: '1.0', migrate: (r) => ({ ...(r as object), bumped1: true }), notes: 's1' });
  reg.register({ from: '1.0',   to: '1.1', migrate: (r) => ({ ...(r as object), bumped2: true }), notes: 's2' });
  reg.register({ from: '1.1',   to: '1.2', migrate: (r) => ({ ...(r as object), bumped3: true }), notes: 's3' });
  const r = runMigrations({
    envelope: { version: '0.1.0', payload: { original: true } },
    target: '1.2',
    registry: reg,
  });
  assert(r.migrationsApplied.length === 3, `3 steps applied`);
  const p = r.final.payload as { original?: boolean; bumped1?: boolean; bumped2?: boolean; bumped3?: boolean };
  assert(p.original === true && p.bumped1 === true && p.bumped2 === true && p.bumped3 === true,
    `each step's transform preserved`);
  assert(r.toVersion === '1.2', `to=1.2`);
}

// 12. runMigrations: missing migration throws MissingMigrationError
{
  const reg = new MigrationRegistry();
  // skip 1.0->1.1
  reg.register({ from: '0.1.0', to: '1.0', migrate: (r) => r, notes: '' });
  reg.register({ from: '1.1',   to: '1.2', migrate: (r) => r, notes: '' });
  let caught: unknown = null;
  try {
    runMigrations({
      envelope: { version: '0.1.0', payload: {} },
      target: '1.2',
      registry: reg,
    });
  } catch (e) { caught = e; }
  assert(caught instanceof MissingMigrationError, `MissingMigrationError thrown`);
}

// 13. runMigrations: unknown version throws UnknownProjectVersionError
{
  const reg = new MigrationRegistry();
  let caught: unknown = null;
  try {
    runMigrations({
      envelope: { version: 'something', payload: {} },
      target: '1.2',
      registry: reg,
    });
  } catch (e) { caught = e; }
  assert(caught instanceof UnknownProjectVersionError, `UnknownProjectVersionError`);
}

// 14. runMigrations: future version throws FutureVersionError
{
  const reg = new MigrationRegistry();
  let caught: unknown = null;
  try {
    runMigrations({
      envelope: { version: '1.2', payload: {} },
      target: '1.0',
      registry: reg,
    });
  } catch (e) { caught = e; }
  assert(caught instanceof FutureVersionError,
    `file newer than target → FutureVersionError`);
}

// 15. runMigrations: warnings collected from each step
{
  const reg = new MigrationRegistry();
  reg.register({
    from: '1.0', to: '1.1',
    migrate: (r) => r,
    warnings: ['legacy field deprecated'],
    notes: '',
  });
  reg.register({
    from: '1.1', to: '1.2',
    migrate: (r) => r,
    warnings: ['old grayscale buffer format', 'sourceText renamed'],
    notes: '',
  });
  const r = runMigrations({
    envelope: { version: '1.0', payload: {} },
    target: '1.2',
    registry: reg,
  });
  assert(r.warnings.length === 3, `3 warnings collected`);
  assert(r.warnings.includes('legacy field deprecated'), `step1 warning preserved`);
}

// 16. fileNeedsMigration: older file → true
{
  assert(fileNeedsMigration({ fileVersion: '1.0', current: '1.2' }), `older → true`);
  assert(!fileNeedsMigration({ fileVersion: '1.2', current: '1.2' }), `same → false`);
}

// 17. describeMigrationResult: clean (no migrations) message
{
  const reg = new MigrationRegistry();
  const r = runMigrations({
    envelope: { version: '1.2', payload: {} },
    target: '1.2',
    registry: reg,
  });
  const msg = describeMigrationResult(r);
  assert(msg.includes('current version'), `no-op message`);
  assert(msg.includes('1.2'), `version named`);
}

// 18. describeMigrationResult: migrated message
{
  const reg = new MigrationRegistry();
  reg.register({ from: '1.0', to: '1.1', migrate: (r) => r, notes: '' });
  reg.register({ from: '1.1', to: '1.2', migrate: (r) => r, warnings: ['w'], notes: '' });
  const r = runMigrations({
    envelope: { version: '1.0', payload: {} },
    target: '1.2',
    registry: reg,
  });
  const msg = describeMigrationResult(r);
  assert(msg.includes('1.0') && msg.includes('1.2'), `from→to in message`);
  assert(msg.includes('2 step'), `2 steps named`);
  assert(msg.includes('1 warning'), `1 warning named`);
}

// 19. THE audit's headline: registry STARTS empty (no implicit migrations)
{
  const reg = new MigrationRegistry();
  assert(reg.size() === 0,
    `framework ships with 0 migrations; future bumps register them explicitly`);
}

// 20. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/io/migrations/MigrationPipeline.ts'), 'utf-8');
  assert(/T2-73/.test(src), 'T2-73 marker');
  for (const id of [
    'ProjectFileVersion', 'CURRENT_PROJECT_VERSION', 'VERSION_ORDER',
    'MigrationStep', 'VersionedEnvelope', 'MigrationResult',
    'UnknownProjectVersionError', 'MissingMigrationError', 'FutureVersionError',
    'isVersionOlder', 'isKnownVersion', 'plannedMigrationKeys',
    'MigrationRegistry', 'runMigrations',
    'fileNeedsMigration', 'describeMigrationResult',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
  for (const v of ['0.1.0', '1.0', '1.1', '1.2']) {
    assert(src.includes(`'${v}'`), `version '${v}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
