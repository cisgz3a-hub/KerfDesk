/**
 * T3-7: backward-compatible project fixture corpus.
 *
 * Run: npx tsx tests/backward-compat-project-fixtures.test.ts
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deserializeScene } from '../src/io/SceneSerializer';
import { compileJob } from '../src/core/job/JobCompiler';
import { optimizePlan } from '../src/core/plan/PlanOptimizer';
import { getOutputStrategy } from '../src/core/output/Output';
import '../src/core/output/GrblStrategy';

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

console.log('\n=== T3-7 backward-compat project fixtures ===\n');

const ROOT = process.cwd();
const FIXTURE_DIR = resolve(ROOT, 'tests/fixtures/projects');

assert(existsSync(FIXTURE_DIR), 'tests/fixtures/projects exists');

const files = existsSync(FIXTURE_DIR)
  ? readdirSync(FIXTURE_DIR).filter(f => f.endsWith('.lfproj')).sort()
  : [];

assert(files.length >= 3, `at least 3 .lfproj fixtures are checked in (got ${files.length})`);

const strategy = getOutputStrategy('grbl');
assert(strategy != null, 'GRBL output strategy is registered');

for (const file of files) {
  const json = readFileSync(join(FIXTURE_DIR, file), 'utf-8');
  const envelope = JSON.parse(json) as { format?: unknown; version?: unknown; scene?: { metadata?: { name?: string } } };

  assert(envelope.format === 'laserforge', `${file}: laserforge envelope`);
  assert(String(envelope.version ?? '').startsWith('1.'), `${file}: major version 1 fixture`);

  let scene;
  try {
    scene = deserializeScene(json);
    assert(true, `${file}: deserializes`);
  } catch (err) {
    assert(false, `${file}: deserializes (${err instanceof Error ? err.message : String(err)})`);
    continue;
  }

  assert(scene.objects.length > 0, `${file}: has at least one object`);
  assert(scene.layers.some(l => l.output !== false), `${file}: has an output-enabled layer`);

  const job = compileJob(scene);
  assert(job.operations.length > 0, `${file}: compiles to at least one operation`);

  const plan = optimizePlan(job);
  assert(plan.operations.length > 0, `${file}: optimizes to at least one planned operation`);

  const output = strategy!.generate(plan, job, {
    startMode: 'absolute',
    maxSpindle: 1000,
    clock: () => '2026-05-07T00:00:00.000Z',
  });

  assert(output.text != null && output.text.length > 0, `${file}: emits G-code text`);
  assert(output.lineCount > 0, `${file}: emits at least one G-code line`);
  assert(typeof output.text === 'string' && output.text.includes('M5'), `${file}: emitted G-code contains laser-off command`);
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
