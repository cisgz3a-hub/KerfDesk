/**
 * T1-43: Output reasserts G90/G91 after customStartGcode.
 *
 * Run: npx tsx tests/customstart-mode-reassertion.test.ts
 */
import { type Job } from '../src/core/job/Job';
import { GrblOutputStrategy } from '../src/core/output/GrblStrategy';
import { type Output } from '../src/core/output/Output';
import { type Plan } from '../src/core/plan/Plan';

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

function makeMinimalJobAndPlan(): { job: Job; plan: Plan } {
  const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
  const job = {
    id: 'test-job',
    name: 'test',
    operations: [],
    bounds,
    metadata: { objectCount: 0, layerCount: 0 },
  } as unknown as Job;
  const plan = {
    id: 'test-plan',
    jobId: job.id,
    createdAt: '2024-01-01T00:00:00.000Z',
    operations: [],
    stats: {
      totalDistanceMm: 0,
      rapidDistanceMm: 0,
      cutDistanceMm: 0,
      estimatedTimeSeconds: 0,
      moveCount: 0,
      operationCount: 0,
      passCount: 0,
    },
    bounds,
  } as unknown as Plan;
  return { job, plan };
}

function gen(opts: Parameters<GrblOutputStrategy['generate']>[2]): Output {
  const strategy = new GrblOutputStrategy();
  const { job, plan } = makeMinimalJobAndPlan();
  const frozenClock = (): string => '2024-01-01T00:00:00.000Z';
  return strategy.generate(plan, job, { ...opts, clock: frozenClock });
}

console.log('\n=== T1-43 customStart mode reassertion ===\n');

{
  const out = gen({
    startMode: 'absolute',
    customStartGcode: 'M8 ; user-supplied',
    maxSpindle: 1000,
  });
  const headerLines = out.text!.split('\n');
  const lastReassertIdx = headerLines.findIndex(l =>
    l.includes('reassert absolute mode after customStartGcode (T1-43)'),
  );
  assert(lastReassertIdx > -1, 'absolute + customStart: reassert marker present');
  const customStartIdx = headerLines.findIndex(l => l.includes('user-supplied'));
  assert(customStartIdx > -1 && customStartIdx < lastReassertIdx, 'custom-start line precedes reassert');
}

{
  const out = gen({
    startMode: 'absolute',
    customStartGcode: 'M8 ; user wrote custom start',
    maxSpindle: 1000,
  });
  const headerLines = out.text!.split('\n');
  const reassertIdx = headerLines.findIndex(l =>
    l.includes('reassert absolute mode after customStartGcode (T1-43)'),
  );
  const userCustomIdx = headerLines.findIndex(l => l.includes('user wrote custom start'));
  assert(reassertIdx > -1, 'absolute + customStart: reassert emitted');
  assert(userCustomIdx > -1, 'user customStart line retained');
  assert(userCustomIdx < reassertIdx, 'reassert follows user customStart');
  assert(/^G90\b/.test(headerLines[reassertIdx]!.trim()), 'reassert is G90');
}

{
  const out = gen({
    startMode: 'current',
    customStartGcode: 'M8 ; user wrote custom start',
    maxSpindle: 1000,
  });
  const headerLines = out.text!.split('\n');
  const reassertIdx = headerLines.findIndex(l =>
    l.includes('reassert relative mode after customStartGcode (T1-43)'),
  );
  const userCustomIdx = headerLines.findIndex(l => l.includes('user wrote custom start'));
  assert(reassertIdx > -1, 'current + customStart: reassert emitted');
  assert(userCustomIdx < reassertIdx, 'reassert follows user customStart');
  assert(/^G91\b/.test(headerLines[reassertIdx]!.trim()), 'reassert is G91');
}

{
  const out = gen({
    startMode: 'absolute',
    customStartGcode: '',
    maxSpindle: 1000,
  });
  assert(
    !out.text!.includes('reassert absolute mode after customStartGcode (T1-43)'),
    'empty customStart: no reassert',
  );
}

{
  const out = gen({
    startMode: 'absolute',
    customStartGcode: '   \n   \n  ',
    maxSpindle: 1000,
  });
  assert(
    !out.text!.includes('reassert absolute mode after customStartGcode (T1-43)'),
    'whitespace-only customStart: no reassert',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
