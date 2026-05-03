/**
 * T1-48: Output.createdAt and the default G-code header date are deterministic
 * when a clock is injected.
 *
 * Run: npx tsx tests/output-deterministic-with-clock-injection.test.ts
 */
import { type Job } from '../src/core/job/Job';
import { GrblOutputStrategy } from '../src/core/output/GrblStrategy';
import { type Output } from '../src/core/output/Output';
import { type Plan } from '../src/core/plan/Plan';
import { resetDeterministicCounter } from '../src/core/types';

let passed = 0;
let failed = 0;

function assertContract(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function makeMinimalJobAndPlan(): { job: Job; plan: Plan } {
  const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
  const job = {
    id: 'test-job',
    name: 'Deterministic Output',
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
  } as Plan;
  return { job, plan };
}

function generateWithDeterministicIds(clock: () => string): Output {
  (globalThis as { __LF_DETERMINISTIC_IDS__?: boolean }).__LF_DETERMINISTIC_IDS__ = true;
  resetDeterministicCounter();
  const strategy = new GrblOutputStrategy();
  const { job, plan } = makeMinimalJobAndPlan();
  return strategy.generate(plan, job, { clock, maxSpindle: 1000 });
}

console.log('\n=== T1-48 Output deterministic with clock injection ===\n');

{
  const frozen = '2024-01-01T00:00:00.000Z';
  const a = generateWithDeterministicIds(() => frozen);
  const b = generateWithDeterministicIds(() => frozen);

  assertContract(a.createdAt === frozen, 'frozen clock sets Output.createdAt');
  assertContract(
    typeof a.text === 'string' && a.text.includes(`; Date: ${frozen}`),
    'frozen clock sets default header date',
  );
  assertContract(JSON.stringify(a) === JSON.stringify(b), 'same frozen clock produces byte-identical Output objects');
}

{
  const a = generateWithDeterministicIds(() => '2024-01-01T00:00:00.000Z');
  const b = generateWithDeterministicIds(() => '2025-12-31T23:59:59.999Z');

  assertContract(a.createdAt !== b.createdAt, 'different frozen clocks produce different createdAt values');
  assertContract(b.createdAt === '2025-12-31T23:59:59.999Z', 'createdAt reflects the second injected clock');
}

{
  delete (globalThis as { __LF_DETERMINISTIC_IDS__?: boolean }).__LF_DETERMINISTIC_IDS__;
  const strategy = new GrblOutputStrategy();
  const { job, plan } = makeMinimalJobAndPlan();
  const before = Date.now();
  const output = strategy.generate(plan, job, { maxSpindle: 1000 });
  const after = Date.now();
  const parsed = Date.parse(output.createdAt);

  assertContract(!Number.isNaN(parsed), 'wall-time fallback is parseable ISO 8601');
  assertContract(
    parsed >= before - 1000 && parsed <= after + 1000,
    'wall-time fallback is within the current execution window',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

export {};
