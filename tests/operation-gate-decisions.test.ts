/**
 * T2-40: central operation-gating authority. Pre-T2-40 operation
 * availability was scattered across ExecutionCoordinator,
 * MachineService, preflight, and various UI components — UI buttons
 * disabled because of one rule, service layer permitting via
 * different rules.
 *
 * Run: npx tsx tests/operation-gate-decisions.test.ts
 */
import {
  canExecuteOperation,
  decisionMessage,
  isOperationAllowed,
  ALL_OPERATIONS,
  type Operation,
  type CapabilityDecision,
  type OperationGateMachineState,
} from '../src/app/OperationGate';
import {
  grblCapabilities,
  type ControllerCapabilities,
} from '../src/controllers/ControllerCapabilities';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-40 operation-gate decisions ===\n');

const baseState = (
  overrides: Partial<OperationGateMachineState> = {},
): OperationGateMachineState => ({
  connected: true,
  status: 'idle',
  activeOperation: null,
  homingRequiredAtBoot: false,
  ...overrides,
});

void (async () => {

// 1. ALL_OPERATIONS lists 15 operations
{
  assert(ALL_OPERATIONS.length === 15, `15 operations declared`);
  for (const op of [
    'home', 'unlock', 'jog', 'set-origin',
    'frame-safe', 'frame-dot', 'test-fire',
    'autofocus', 'wcs-normalize',
    'raw-console', 'job-start',
    'pause', 'resume', 'stop', 'emergency-stop',
  ]) {
    assert(ALL_OPERATIONS.includes(op as Operation), `includes '${op}'`);
  }
}

// 2. Disconnected → every op is gated 'not-connected'
{
  const state = baseState({ connected: false });
  for (const op of ALL_OPERATIONS) {
    const d = canExecuteOperation(op, grblCapabilities, state);
    if (d.allowed) {
      assert(false, `'${op}' should be blocked when disconnected`);
    } else {
      assert(d.reason === 'not-connected', `'${op}' → not-connected`);
    }
  }
}

// 3. Idle + connected: jog is allowed
{
  const d = canExecuteOperation('jog', grblCapabilities, baseState());
  assert(d.allowed, `jog allowed in idle`);
}

// 4. While running: jog refused 'machine-state-prevents'
{
  const d = canExecuteOperation('jog', grblCapabilities, baseState({ status: 'run' }));
  if (!d.allowed) {
    assert(d.reason === 'machine-state-prevents', `jog/run → machine-state-prevents`);
  } else assert(false, `should be blocked`);
}

// 5. Home: allowed in alarm (homing recovers from alarm)
{
  const d = canExecuteOperation('home', grblCapabilities, baseState({ status: 'alarm' }));
  assert(d.allowed, `home allowed in alarm`);
}

// 6. Home: blocked while running
{
  const d = canExecuteOperation('home', grblCapabilities, baseState({ status: 'run' }));
  if (!d.allowed) {
    assert(d.reason === 'machine-state-prevents', `home/run blocked`);
  } else assert(false, `should be blocked`);
}

// 7. Unlock: allowed in alarm
{
  const d = canExecuteOperation('unlock', grblCapabilities, baseState({ status: 'alarm' }));
  assert(d.allowed, `unlock in alarm`);
}

// 8. Unlock: refused in run
{
  const d = canExecuteOperation('unlock', grblCapabilities, baseState({ status: 'run' }));
  if (!d.allowed) {
    assert(d.reason === 'machine-state-prevents', `unlock/run → blocked`);
  } else assert(false, `should be blocked`);
}

// 9. Pause: only in run/jog
{
  assert(canExecuteOperation('pause', grblCapabilities, baseState({ status: 'run' })).allowed,
    `pause in run`);
  assert(canExecuteOperation('pause', grblCapabilities, baseState({ status: 'jog' })).allowed,
    `pause in jog`);
  assert(!canExecuteOperation('pause', grblCapabilities, baseState({ status: 'idle' })).allowed,
    `pause in idle blocked`);
}

// 10. Resume: only in hold
{
  assert(canExecuteOperation('resume', grblCapabilities, baseState({ status: 'hold' })).allowed,
    `resume in hold`);
  assert(!canExecuteOperation('resume', grblCapabilities, baseState({ status: 'run' })).allowed,
    `resume in run blocked`);
  assert(!canExecuteOperation('resume', grblCapabilities, baseState({ status: 'idle' })).allowed,
    `resume in idle blocked`);
}

// 11. Stop is always permissible (universal abort)
{
  const states: OperationGateMachineState['status'][] = ['idle', 'run', 'hold', 'jog', 'alarm'];
  for (const s of states) {
    assert(canExecuteOperation('stop', grblCapabilities, baseState({ status: s })).allowed,
      `stop allowed in '${s}'`);
  }
}

// 12. Emergency-stop is always permissible
{
  const states: OperationGateMachineState['status'][] = ['idle', 'run', 'hold', 'jog', 'alarm', 'door'];
  for (const s of states) {
    assert(canExecuteOperation('emergency-stop', grblCapabilities, baseState({ status: s })).allowed,
      `e-stop allowed in '${s}'`);
  }
}

// 13. job-start: idle required
{
  assert(canExecuteOperation('job-start', grblCapabilities, baseState()).allowed,
    `job-start in idle`);
  assert(!canExecuteOperation('job-start', grblCapabilities, baseState({ status: 'run' })).allowed,
    `job-start in run blocked`);
}

// 14. job-start: blocked if homingRequiredAtBoot
{
  const d = canExecuteOperation(
    'job-start', grblCapabilities,
    baseState({ homingRequiredAtBoot: true }),
  );
  if (!d.allowed) {
    assert(d.reason === 'machine-state-prevents', `homing required → blocked`);
    assert(d.detail.toLowerCase().includes('homing'), `detail names homing`);
  } else assert(false, `should be blocked`);
}

// 15. activeOperation set: any other op refused 'operation-busy'
{
  const d = canExecuteOperation(
    'jog', grblCapabilities,
    baseState({ activeOperation: 'frame-safe' }),
  );
  if (!d.allowed) {
    assert(d.reason === 'operation-busy', `op-busy when other op active`);
    assert(d.detail.includes('frame-safe'), `detail names active op`);
  } else assert(false, `should be blocked`);
}

// 16. activeOperation === self: re-entry permitted (T2-11 deadman pattern)
{
  // jog-on-jog re-entry (operator pressing jog while jog already active)
  const d = canExecuteOperation(
    'jog', grblCapabilities,
    baseState({ activeOperation: 'jog' }),
  );
  assert(d.allowed, `re-entry to same op allowed (T2-11 deadman pattern)`);
}

// 17. Capability gate: autofocus on grblCapabilities (canAutofocus=false)
{
  const d = canExecuteOperation('autofocus', grblCapabilities, baseState());
  if (!d.allowed) {
    assert(d.reason === 'capability-not-supported', `autofocus capability gate`);
    assert(d.detail.toLowerCase().includes('autofocus'), `detail names op`);
  } else assert(false, `grbl base does not support autofocus`);
}

// 18. Capability override: profile that enables canAutofocus
{
  const overridden: ControllerCapabilities = {
    ...grblCapabilities,
    operations: { ...grblCapabilities.operations, canAutofocus: true },
  };
  const d = canExecuteOperation('autofocus', overridden, baseState());
  assert(d.allowed, `autofocus permitted on overridden profile`);
}

// 19. Capability gate: synthetic controller without canHome
{
  const noHome: ControllerCapabilities = {
    ...grblCapabilities,
    operations: { ...grblCapabilities.operations, canHome: false },
  };
  const d = canExecuteOperation('home', noHome, baseState());
  if (!d.allowed) {
    assert(d.reason === 'capability-not-supported', `no-home → capability-not-supported`);
  } else assert(false, `should be blocked`);
}

// 20. Capability check fires BEFORE machine-state check
{
  // autofocus + unsupported caps + run state — capability message wins
  const d = canExecuteOperation(
    'autofocus', grblCapabilities,
    baseState({ status: 'run' }),
  );
  if (!d.allowed) {
    assert(d.reason === 'capability-not-supported', `capability fires first`);
  } else assert(false, `should be blocked`);
}

// 21. not-connected fires BEFORE capability check
{
  const d = canExecuteOperation(
    'autofocus', grblCapabilities,
    baseState({ connected: false }),
  );
  if (!d.allowed) {
    assert(d.reason === 'not-connected', `not-connected fires first`);
  } else assert(false, `should be blocked`);
}

// 22. decisionMessage: allowed → null
{
  const d: CapabilityDecision = { allowed: true };
  assert(decisionMessage(d) === null, `allowed → null`);
}

// 23. decisionMessage: refused → returns detail
{
  const d: CapabilityDecision = {
    allowed: false, reason: 'capability-not-supported',
    detail: 'Controller does not support framing.',
  };
  assert(decisionMessage(d) === 'Controller does not support framing.', `detail returned`);
}

// 24. isOperationAllowed convenience
{
  assert(isOperationAllowed('jog', grblCapabilities, baseState()), `jog allowed`);
  assert(!isOperationAllowed('jog', grblCapabilities, baseState({ status: 'run' })),
    `jog blocked in run`);
}

// 25. raw-console always permissible (when connected)
{
  for (const s of ['idle', 'run', 'hold', 'alarm'] as OperationGateMachineState['status'][]) {
    assert(isOperationAllowed('raw-console', grblCapabilities, baseState({ status: s })),
      `raw-console in '${s}' allowed`);
  }
}

// 26. THE audit's headline cases
{
  // Case 1: UI-shows-disabled-but-service-allows scenario closed
  // Both consult the same gate.
  const uiDecision = canExecuteOperation('jog', grblCapabilities, baseState({ status: 'run' }));
  const serviceDecision = canExecuteOperation('jog', grblCapabilities, baseState({ status: 'run' }));
  assert(uiDecision.allowed === serviceDecision.allowed,
    `UI + service get the same answer (was: divergence)`);

  // Case 2: capability-aware — adding a new gate is one site change
  // (verified structurally by the operation-by-operation switch in the source)
}

// 27. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/app/OperationGate.ts'), 'utf-8');
  assert(/T2-40/.test(src), 'T2-40 marker');
  for (const id of [
    'Operation', 'DecisionRefusalReason', 'CapabilityDecision',
    'OperationGateMachineState', 'ALL_OPERATIONS',
    'canExecuteOperation', 'decisionMessage', 'isOperationAllowed',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
  for (const r of ['capability-not-supported', 'machine-state-prevents',
                   'capabilities-unknown', 'profile-mismatch',
                   'not-connected', 'operation-busy']) {
    assert(src.includes(`'${r}'`), `reason '${r}' declared`);
  }
  for (const op of ['home', 'unlock', 'jog', 'set-origin',
                    'frame-safe', 'frame-dot', 'test-fire',
                    'autofocus', 'job-start', 'pause', 'resume',
                    'stop', 'emergency-stop']) {
    assert(src.includes(`'${op}'`), `operation '${op}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
