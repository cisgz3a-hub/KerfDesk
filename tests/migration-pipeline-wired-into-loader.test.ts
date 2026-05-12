/**
 * T1-119: regression test that the MigrationPipeline framework is
 * actually exercised by the production scene loader. Pre-T1-119 the
 * runner in `src/io/migrations/MigrationPipeline.ts` was framework-
 * only and no production load path imported it — the audit's Phase
 * 2 #5 finding called this out as a "foundation exists but product
 * does not use it" bug. This test pins the wiring + the empty-
 * registry passthrough behavior + the version-normalization fallback
 * for unmappable file versions. Future schema bumps that register a
 * step in `projectMigrations.ts` are expected to land their own
 * fixture-based migration tests.
 *
 * Run: npx tsx tests/migration-pipeline-wired-into-loader.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deserializeScene } from '../src/io/SceneSerializer';
import {
  CURRENT_PROJECT_VERSION,
  type MigrationStep,
  type ProjectFileVersion,
} from '../src/io/migrations/MigrationPipeline';
import {
  _resetProjectMigrationRegistryForTest,
  getProjectMigrationRegistry,
  migrateSceneEnvelope,
  normalizeProjectVersion,
} from '../src/io/migrations/projectMigrations';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function silenceConsoleWarn<T>(body: () => T): { value: T; warnings: string[] } {
  const original = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };
  try {
    return { value: body(), warnings };
  } finally {
    console.warn = original;
  }
}

function freshScene(version: string): string {
  return JSON.stringify({
    format: 'laserforge',
    version,
    appVersion: 'test',
    scene: {
      id: 's1',
      version: 1,
      canvas: { width: 200, height: 200 },
      objects: [],
      layers: [
        {
          id: 'l1',
          name: 'L1',
          color: '#ff0000',
          visible: true,
          locked: false,
          output: true,
          settings: {},
        },
      ],
      activeLayerId: 'l1',
      metadata: { name: 't' },
    },
    checksumAlgorithm: 'sha-256-base64-no-pad',
    checksum: 'unused-for-deserializeScene',
  });
}

console.log('\n=== T1-119 MigrationPipeline wired into SceneSerializer ===\n');

// -------- normalizeProjectVersion: canonical mapping table --------
{
  assert(normalizeProjectVersion('1.2').canonical === '1.2',
    "exact '1.2' passes through");
  assert(normalizeProjectVersion('1.1').canonical === '1.1',
    "exact '1.1' passes through");
  assert(normalizeProjectVersion('1.0').canonical === '1.0',
    "exact '1.0' passes through");
  assert(normalizeProjectVersion('0.1.0').canonical === '0.1.0',
    "exact '0.1.0' (legacy) passes through");
  assert(normalizeProjectVersion('1.0.0').canonical === '1.0',
    "'1.0.0' normalizes to '1.0'");
  assert(normalizeProjectVersion('1.1.5').canonical === '1.1',
    "'1.1.5' normalizes to '1.1'");
  assert(normalizeProjectVersion('1').canonical === '1.0',
    "major-only '1' normalizes to '1.0'");
  assert(normalizeProjectVersion(null).canonical === '0.1.0',
    'missing version → legacy 0.1.0');
  assert(normalizeProjectVersion('').canonical === '0.1.0',
    'empty version → legacy 0.1.0');
  assert(normalizeProjectVersion('1.5').canonical === null,
    "future minor '1.5' is unmappable");
  assert(normalizeProjectVersion('bogus').canonical === null,
    'totally bogus version is unmappable');
  // raw is preserved for diagnostics.
  assert(normalizeProjectVersion('1.0.0').raw === '1.0.0',
    'normalize preserves raw input');
}

// -------- empty registry: current-version envelope passes through --------
{
  _resetProjectMigrationRegistryForTest();
  const envelope = { format: 'laserforge', version: CURRENT_PROJECT_VERSION, scene: {} };
  const { warnings, result } = migrateSceneEnvelope(envelope);
  assert(result === null, 'current-version file does not invoke runMigrations');
  assert(warnings.length === 0, 'current-version migration produces no warnings');
}

// -------- default registry: older known version walks no-op chain to current --------
// T1-119 ships with no-op steps for 0.1.0 → 1.0 → 1.1 → 1.2 because every
// minor bump is backward-compatible per the version contract. Schema-
// breaking migrations register a real `migrate` fn when they ship.
{
  _resetProjectMigrationRegistryForTest();
  const envelope = { format: 'laserforge', version: '1.0', scene: { id: 's' } };
  const { envelope: out, result } = migrateSceneEnvelope(envelope);
  assert(result != null, '1.0 envelope walks the migration chain');
  assert(result?.migrationsApplied.includes('1.0->1.1') === true,
    'chain includes 1.0 → 1.1 step');
  assert(result?.migrationsApplied.includes('1.1->1.2') === true,
    'chain includes 1.1 → 1.2 step');
  assert(out.version === '1.2', 'final envelope version is current after no-op chain');
}

{
  _resetProjectMigrationRegistryForTest();
  const envelope = { format: 'laserforge', version: '0.1.0', scene: { id: 's' } };
  const { result } = migrateSceneEnvelope(envelope);
  assert(result?.migrationsApplied.length === 3,
    `legacy 0.1.0 walks 3 no-op steps (got ${result?.migrationsApplied.length ?? 0})`);
}

// -------- MigrationRegistry register() rejects duplicates --------
// Defense-in-depth: the runner can't be tricked into walking two
// different migrate fns for the same edge.
{
  _resetProjectMigrationRegistryForTest();
  const reg = getProjectMigrationRegistry();
  const dup: MigrationStep = {
    from: '1.0',
    to: '1.1',
    notes: 'duplicate test step',
    migrate: (raw) => raw,
  };
  let threw = false;
  try { reg.register(dup); } catch { threw = true; }
  assert(threw, 'registry refuses to register a duplicate edge');
}

// -------- unmappable version: skip pipeline + warn (preserves pre-T1-119 forgiving behavior) --------
{
  _resetProjectMigrationRegistryForTest();
  const envelope = { format: 'laserforge', version: '1.5', scene: {} };
  const { envelope: out, warnings, result } = migrateSceneEnvelope(envelope);
  assert(result === null, 'unmappable version skips runMigrations');
  assert(warnings.length === 1 && warnings[0].includes('not in the migration registry'),
    'unmappable version emits a clear warning');
  assert(out === (envelope as unknown), 'unmappable version returns envelope unchanged');
}

// -------- end-to-end via deserializeScene: current-version file loads cleanly --------
{
  _resetProjectMigrationRegistryForTest();
  const json = freshScene(CURRENT_PROJECT_VERSION);
  const { value: scene, warnings } = silenceConsoleWarn(() => deserializeScene(json));
  assert(scene.id === 's1', 'current-version file deserializes correctly');
  assert(warnings.length === 0,
    `no migration warnings for current-version file (got ${warnings.length})`);
}

// -------- end-to-end via deserializeScene: future-minor logs warning, still loads --------
{
  _resetProjectMigrationRegistryForTest();
  const json = freshScene('1.5');
  const { value: scene, warnings } = silenceConsoleWarn(() => deserializeScene(json));
  assert(scene.id === 's1',
    'future-minor file still loads through the forgiving fallback');
  assert(warnings.some((w) => w.includes('not in the migration registry')),
    'future-minor file emits the migration-not-applicable warning');
}

// -------- source-pin: SceneSerializer imports + calls migrateSceneEnvelope --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(
    resolve(here, '../src/io/SceneSerializer.ts'),
    'utf-8',
  );
  assert(/from '\.\/migrations\/projectMigrations'/.test(src),
    "SceneSerializer.ts imports from './migrations/projectMigrations'");
  assert(/migrateSceneEnvelope\(envelope\)/.test(src),
    'parseSceneEnvelope calls migrateSceneEnvelope(envelope)');
  assert(/T1-119/.test(src),
    'SceneSerializer carries T1-119 marker for the wiring change');
}

// -------- source-pin: getProjectMigrationRegistry exists --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(
    resolve(here, '../src/io/migrations/projectMigrations.ts'),
    'utf-8',
  );
  assert(/export function getProjectMigrationRegistry/.test(src),
    'projectMigrations.ts exports getProjectMigrationRegistry');
  assert(/export function migrateSceneEnvelope/.test(src),
    'projectMigrations.ts exports migrateSceneEnvelope');
  assert(/export function normalizeProjectVersion/.test(src),
    'projectMigrations.ts exports normalizeProjectVersion');
  assert(/CURRENT_PROJECT_VERSION/.test(src),
    'projectMigrations.ts uses CURRENT_PROJECT_VERSION as the migration target');
}

// -------- type-only: ProjectFileVersion is exported for future migration steps --------
{
  const v: ProjectFileVersion = '1.2';
  assert(v === '1.2', 'ProjectFileVersion type literal is usable from consumer code');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
