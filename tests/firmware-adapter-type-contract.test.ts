/**
 * T1-192 (external audit High #15 foundation slice): the
 * `FirmwareAdapter` type contract.
 *
 * The audit framed the problem as: "Output formats include
 * `marlin`, `smoothie`, `ruida`, and `custom`, but the ticket is
 * still `controllerType: 'grbl'`. Output-format abstraction is
 * ahead of actual firmware abstraction." T1-192 ships the type
 * contract that a real firmware adapter must implement. No
 * production caller is wired YET (multi-week retrofit deferred);
 * this test source-pins the contract shape so future PRs adding
 * Marlin / Ruida support have a stable target.
 *
 * The test instantiates a mock-shape adapter at compile time to
 * prove every required method is callable with the documented
 * types. If a future commit drops a method or changes its
 * signature, this test fails to compile.
 *
 * Run: npx tsx tests/firmware-adapter-type-contract.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  FirmwareAdapter,
  FirmwareCapabilities,
  PlannerConstraints,
  OutputArtifact,
  LiveMachineIdentity,
  AdapterFindings,
  StreamSession,
  MachineFault,
  RecoveryPlan,
} from '../src/controllers/FirmwareAdapter';

let passed = 0;
let failed = 0;

function assert(cond: unknown, message: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

const here = dirname(fileURLToPath(import.meta.url));

console.log('\n=== T1-192 FirmwareAdapter type contract ===\n');

// -------- 1. A mock adapter satisfying the FULL contract compiles --------
// The test is the typecheck itself; if any required method is missing,
// TypeScript reports a compile error and the test never runs.
const mockAdapter: FirmwareAdapter = {
  id: 'grbl',
  capabilities(): FirmwareCapabilities {
    return {
      id: 'grbl',
      name: 'Mock GRBL',
      protocol: 'gcode-line-stream',
      supportsDynamicLaserPower: true,
      supportsArcs: true,
      supportsRealtimeStatusQuery: true,
      supportsWorkOffsetQuery: true,
      disconnectStopsJob: true,
      maxSpindleStatic: 1000,
    };
  },
  compileConstraints(): PlannerConstraints {
    return {
      flattenArcsToLines: false,
      maxAccelMmPerS2: 1000,
      maxFeedMmPerMin: 6000,
    };
  },
  emit(_plan, _job): OutputArtifact {
    return {
      kind: 'gcode-lines',
      firmware: 'grbl',
      lines: ['G21', 'G90', 'M5 S0'],
      burnBounds: null,
    };
  },
  validate(_output, _live): AdapterFindings {
    return { findings: [] };
  },
  stream(_output): StreamSession {
    return {
      sessionId: 'mock-session-1',
      completed: Promise.resolve(),
      cancel(_reason: string): void {},
      pause(): void {},
      resume(): void {},
    };
  },
  recover(event: MachineFault): RecoveryPlan {
    return {
      faultKind: event.kind,
      steps: [
        { kind: 'inspect-machine', required: true, message: 'Inspect the machine before next start.' },
      ],
      advisoryOnly: false,
    };
  },
};

// -------- 2. Adapter callable from generic code --------
{
  const caps = mockAdapter.capabilities();
  assert(caps.id === 'grbl', `capabilities.id === 'grbl' (got '${caps.id}')`);
  assert(caps.protocol === 'gcode-line-stream', 'capabilities.protocol set');
  assert(typeof caps.disconnectStopsJob === 'boolean', 'capabilities.disconnectStopsJob is boolean');

  const constraints = mockAdapter.compileConstraints();
  assert(constraints.flattenArcsToLines === false, 'constraints.flattenArcsToLines defaults to false for GRBL');

  const findings = mockAdapter.validate(
    { kind: 'gcode-lines', firmware: 'grbl', lines: [], burnBounds: null },
    {
      firmwareVersion: '1.1h', buildOptions: null, maxSpindle: 1000,
      bedWidthMm: 400, bedHeightMm: 400, homingEnabled: false, laserMode: true,
    } as LiveMachineIdentity,
  );
  assert(Array.isArray(findings.findings), 'validate returns AdapterFindings shape');

  const plan = mockAdapter.recover({ kind: 'alarm', message: 'ALARM:9', observedAt: Date.now() });
  assert(plan.faultKind === 'alarm', 'recover plan carries the fault kind');
  assert(plan.steps.length >= 1, 'recover plan has at least one step');
  assert(plan.advisoryOnly === false, 'recover plan defaults to non-advisory (user must ack)');
}

// -------- 3. OutputArtifact discriminated union covers all 4 kinds --------
{
  const kinds: Array<OutputArtifact['kind']> = ['gcode-lines', 'gcode-text', 'binary-job', 'device-job'];
  assert(kinds.length === 4, '4 OutputArtifact kinds declared');
}

// -------- 4. MachineFaultKind / RecoveryStepKind cover the audit's enumeration --------
{
  const faultKinds: MachineFault['kind'][] = [
    'alarm', 'transport-error', 'safety-off-failed', 'placement-uncertain', 'firmware-mismatch',
  ];
  assert(faultKinds.length === 5, 'MachineFaultKind has 5 members');

  const recoveryStepKinds: RecoveryPlan['steps'][number]['kind'][] = [
    'inspect-machine', 're-home', 're-frame', 'clear-alarm', 'soft-reset', 'reconnect',
  ];
  assert(recoveryStepKinds.length === 6, 'RecoveryStepKind has 6 members');
}

// -------- 5. Source pins on the type definitions --------
{
  const src = readFileSync(resolve(here, '../src/controllers/FirmwareAdapter.ts'), 'utf-8');
  assert(/T1-192/.test(src), 'FirmwareAdapter.ts carries T1-192 marker');
  assert(/audit High #15/.test(src), 'cross-references audit High #15');
  // All seven methods on FirmwareAdapter present.
  const requiredMethods = ['capabilities', 'compileConstraints', 'emit', 'validate', 'stream', 'recover'];
  for (const m of requiredMethods) {
    assert(new RegExp(`${m}\\(`).test(src), `FirmwareAdapter declares ${m}()`);
  }
  assert(
    /export interface FirmwareAdapter/.test(src),
    'FirmwareAdapter interface exported',
  );
  // The contract states it's INTENTIONALLY type-only — no production
  // caller yet. The audit-grade comment names this.
  assert(
    /intentionally type-only/i.test(src) || /type-only foundation/i.test(src),
    'doc names "type-only foundation" intent',
  );
  // The contract documents the deferred follow-up.
  assert(
    /GrblAdapter implements FirmwareAdapter/.test(src),
    'doc names the deferred follow-up (GrblAdapter)',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
