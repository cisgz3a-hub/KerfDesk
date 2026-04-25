/**
 * Static audit: Pro feature service-layer entry points must import requireFeature.
 * Run: npx tsx tests/service-layer-pro-gate-coverage.test.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');

const REQUIRED_GATES: Array<{
  file: string;
  feature: string;
  patterns: RegExp[];
}> = [
  {
    file: 'src/core/job/JobCompiler.ts',
    feature: 'compiler settings: tabs/overcut/lead_in/cross_hatch/power_scale/cut_start_point',
    patterns: [/requireFeature\('tabs'\)/, /requireFeature\('overcut'\)/, /requireFeature\('lead_in'\)/, /requireFeature\('cross_hatch'\)/, /requireFeature\('power_scale'\)/, /requireFeature\('cut_start_point'\)/],
  },
  {
    file: 'src/core/nesting/Nester.ts',
    feature: 'nesting',
    patterns: [/requireFeature\('nesting'\)/],
  },
  {
    file: 'src/geometry/BooleanOps.ts',
    feature: 'boolean_ops',
    patterns: [/requireFeature\('boolean_ops'\)/],
  },
  {
    file: 'src/ui/hooks/useSceneOperations.ts',
    feature: 'text_to_path',
    patterns: [/requireFeature\('text_to_path'\)/],
  },
  {
    file: 'src/ui/hooks/useGeneratorHandlers.ts',
    feature: 'variable_text',
    patterns: [/requireFeature\('variable_text'\)/],
  },
  {
    file: 'src/ui/hooks/useKerfHandlers.ts',
    feature: 'kerf_wizard',
    patterns: [/requireFeature\('kerf_wizard'\)/],
  },
  {
    file: 'src/ui/hooks/useMaterialTestHandlers.ts',
    feature: 'material_test',
    patterns: [/requireFeature\('material_test'\)/],
  },
  {
    file: 'src/app/MachineService.ts',
    feature: 'job_replay',
    patterns: [/requireFeature\('job_replay'\)/],
  },
];

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
    /requireFeature/.test(source),
    `${gate.file} imports/uses requireFeature for ${gate.feature}`,
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
