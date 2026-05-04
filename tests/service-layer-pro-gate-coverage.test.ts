/**
 * Static audit: Pro feature service-layer entry points must call the
 * entitlement API for the right feature key. Accepts any of the three
 * functions exported by `src/entitlements/index.ts`:
 * `requireFeature` (deprecated alias kept for unmigrated callers),
 * `canUseFeature` (boolean check — flag-builders), or
 * `assertFeature` (throws EntitlementError — service-entry enforcement).
 * Per-gate patterns name the feature key; the form-agnostic group
 * lets the T1-78 caller migration progress without churn here.
 *
 * Run: npx tsx tests/service-layer-pro-gate-coverage.test.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');

const ENT_FN = '(?:requireFeature|canUseFeature|assertFeature)';
const featurePattern = (key: string): RegExp =>
  new RegExp(`${ENT_FN}\\('${key}'\\)`);

const REQUIRED_GATES: Array<{
  file: string;
  feature: string;
  patterns: RegExp[];
}> = [
  {
    file: 'src/core/job/JobCompiler.ts',
    feature: 'compiler settings: tabs/overcut/lead_in/cross_hatch/power_scale/cut_start_point',
    patterns: [
      featurePattern('tabs'),
      featurePattern('overcut'),
      featurePattern('lead_in'),
      featurePattern('cross_hatch'),
      featurePattern('power_scale'),
      featurePattern('cut_start_point'),
    ],
  },
  {
    file: 'src/core/nesting/Nester.ts',
    feature: 'nesting',
    patterns: [featurePattern('nesting')],
  },
  {
    file: 'src/geometry/BooleanOps.ts',
    feature: 'boolean_ops',
    patterns: [featurePattern('boolean_ops')],
  },
  {
    file: 'src/ui/hooks/useSceneOperations.ts',
    feature: 'text_to_path',
    patterns: [featurePattern('text_to_path')],
  },
  {
    file: 'src/ui/hooks/useGeneratorHandlers.ts',
    feature: 'variable_text',
    patterns: [featurePattern('variable_text')],
  },
  {
    file: 'src/ui/hooks/useKerfHandlers.ts',
    feature: 'kerf_wizard',
    patterns: [featurePattern('kerf_wizard')],
  },
  {
    file: 'src/ui/hooks/useMaterialTestHandlers.ts',
    feature: 'material_test',
    patterns: [featurePattern('material_test')],
  },
  // T1-88: the MachineService.ts / job_replay gate was removed. Replay
  // capture is now always-on (a diagnostic tool, not a Pro feature).
  // When a viewer/export UI is added, its own Pro gate (e.g.
  // job_replay_viewer) can be re-listed here.
];

const ENT_FN_ANY = new RegExp(ENT_FN);

const ALLOWLISTED_EXCEPTIONS = [
  'src/core/scene/Layer.ts (type/default definitions only)',
  'src/core/scene/SceneObject.ts (type/default definitions only)',
  'src/core/job/Job.ts (type definitions only)',
  'src/core/job/ticketHashing.ts (hashes scene input, not feature execution)',
  'src/core/materials/MaterialLibrary.ts (preset persistence/application; compiler is execution gate)',
  'src/geometry/TextToPath.ts (shared text outline primitive; compile-time text must remain free)',
  'src/ui/components/* (visual UI gates/prompts; not service-layer execution)',
];

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

console.log('\n=== service-layer Pro gate coverage ===\n');
for (const gate of REQUIRED_GATES) {
  const full = path.join(projectRoot, ...gate.file.split('/'));
  const source = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : '';
  assert(source.length > 0, `${gate.file} exists`);
  assert(
    ENT_FN_ANY.test(source),
    `${gate.file} imports/uses an entitlement function for ${gate.feature}`,
  );
  for (const pattern of gate.patterns) {
    assert(pattern.test(source), `${gate.file} has ${pattern.source}`);
  }
}

console.log('\nScanned service-layer gate files:');
for (const gate of REQUIRED_GATES) {
  console.log(`  - ${gate.file}: ${gate.feature}`);
}
console.log('\nAllowlisted exceptions:');
for (const ex of ALLOWLISTED_EXCEPTIONS) {
  console.log(`  - ${ex}`);
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
