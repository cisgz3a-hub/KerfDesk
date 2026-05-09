/**
 * T3-62: Ruida safety design stub before implementation.
 *
 * Run: npx tsx tests/ruida-safety-design-doc.test.ts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const designPath = path.join(repoRoot, 'docs/controllers/ruida-safety-design.md');

console.log('\n=== T3-62 Ruida safety design document ===\n');

const exists = fs.existsSync(designPath);
assert(exists, 'docs/controllers/ruida-safety-design.md exists');

const doc = exists ? fs.readFileSync(designPath, 'utf-8') : '';

if (exists) {
  for (const heading of [
    '# Ruida Safety Design',
    '## Scope',
    '## Ruida Differences From GRBL',
    '## ControllerSafetyCapabilities',
    '## ControllerSafetyOps',
    '## JobExecutionSession Mapping',
    '## SafetyActionResult Outcomes',
    '## Research Questions',
    '## Non-Goals',
  ]) {
    assert(doc.includes(heading), `heading present: ${heading}`);
  }

  for (const phrase of [
    'binary protocol',
    'file-upload',
    'continues after host disconnect',
    'native job-state commands',
    'device-reported percentage',
    'disconnectStopsJob: false',
    "executionModel: 'uploadedFile'",
    "laserOffMethod: 'native'",
    "emergencyStopMethod: 'native-stop'",
    'ControllerSafetyOps',
    'ControllerSafetyCapabilities',
    'JobExecutionSession',
    'SafetyActionResult',
    'hardware required',
    'design only',
  ]) {
    assert(doc.includes(phrase), `required phrase present: ${phrase}`);
  }

  assert(!/send\s+M5 S0/i.test(doc), 'design does not instruct Ruida laser-off via M5 S0');
  assert(!/send\s+0x18/i.test(doc), 'design does not instruct Ruida emergency stop via GRBL soft reset');
}

const controllersDir = path.join(repoRoot, 'src/controllers');
const productionSources = fs.readdirSync(controllersDir, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile() && /ruida/i.test(entry.name))
  .map(entry => entry.name);
assert(productionSources.length === 0, 'no production Ruida controller implementation ships with the design stub');

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
