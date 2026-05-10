/**
 * T1-129: regression test for the pure `buildStartReadiness` helper
 * extracted from ConnectionPanelMain. First slice of the audit's
 * Sprint 7 product-shell decomposition (also Sprint 4 #1 — split
 * GRBL UI from ConnectionPanelMain).
 *
 * Pre-T1-129 the readiness derivation was a 142-line IIFE inline in
 * the panel; the logic was already pure but couldn't be tested
 * without mounting ConnectionPanelMain with ~50 fixture props.
 *
 * This test pins:
 *   - All 11 readiness gates render in canonical order with correct
 *     status / headline / action text.
 *   - Per-gate fail headlines reflect the relevant input slice.
 *   - The frame-control failHeadline switches based on the failure
 *     mode (no controller / no machine state / laser unknown / laser
 *     on / active operation / recovery pending / error code / non-
 *     idle status / generic fallback).
 *   - The connection-trust gate's failAction defaults sensibly when
 *     the trust hint is null.
 *   - When `isRunning`, ready=true regardless of gates (matches the
 *     pre-T1-129 short-circuit).
 *   - The first failing gate is reported as `blockingGate`.
 *   - Source-pin: ConnectionPanelMain delegates to the helper.
 *
 * Run: npx tsx tests/build-start-readiness.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildStartReadiness,
  type BuildStartReadinessInput,
} from '../src/ui/components/connection/buildStartReadiness';

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

const trustedTrust = {
  kind: 'usb-serial' as const,
  tier: 'trusted' as const,
  label: 'USB Serial',
  hint: null,
};

const wifiTrust = {
  kind: 'wifi' as const,
  tier: 'untrusted' as const,
  label: 'WiFi (telemetry only)',
  hint: 'WiFi is not authenticated. Use USB for safety-critical operations.',
};

function happy(): BuildStartReadinessInput {
  return {
    preflight: { canStart: true, blockers: 0, warnings: 0, issues: [] } as never,
    isConnected: true,
    machineState: {
      status: 'idle',
      position: { x: 0, y: 0, z: 0 },
      feedRate: 0,
      spindleSpeed: 0,
      alarmCode: null,
      errorCode: null,
    },
    machineStatus: 'idle',
    laserOutputState: 'off',
    activeOperation: null,
    recoveryPending: false,
    gcode: 'G21\nG90\nM5 S0\n',
    gcodeStale: false,
    isSimulator: false,
    machineBlocksJobStart: false,
    canFrame: true,
    requireFrame: false,
    hasFramed: false,
    startMode: 'absolute',
    currentModeFrameAnchorValid: true,
    placementUncertain: false,
    wifiTrust: trustedTrust,
    wifiStartAllowed: true,
    isRunning: false,
    canStartJob: true,
  };
}

console.log('\n=== T1-129 buildStartReadiness ===\n');

// -------- 1. Happy path: all gates ok, ready=true --------
{
  const r = buildStartReadiness(happy());
  assert(r.ready === true, 'happy path: ready=true');
  assert(r.blockingGate === null, 'happy path: no blocking gate');
  assert(r.gates.length === 11, `11 gates rendered (got ${r.gates.length})`);
  assert(r.gates.every((g) => g.status === 'ok'),
    'happy path: every gate status ok');
}

// -------- 2. Gate id order is stable --------
{
  const expectedOrder = [
    'controllerConnected',
    'gcodeCompiled',
    'gcodeFresh',
    'preflight',
    'machineState',
    'frameControls',
    'framing',
    'currentModeAnchor',
    'laserState',
    'wcsState',
    'connectionTrust',
  ];
  const r = buildStartReadiness(happy());
  for (let i = 0; i < expectedOrder.length; i++) {
    assert(r.gates[i].id === expectedOrder[i],
      `gate ${i}: '${expectedOrder[i]}' (got '${r.gates[i].id}')`);
  }
}

// -------- 3. Disconnected → controllerConnected fails --------
{
  const r = buildStartReadiness({ ...happy(), isConnected: false });
  const g = r.gates.find((g) => g.id === 'controllerConnected');
  assert(g?.status === 'fail', 'disconnected: controllerConnected fails');
  assert(r.blockingGate?.id === 'controllerConnected',
    'disconnected: blockingGate is controllerConnected (first fail)');
}

// -------- 4. No gcode → gcodeCompiled fails; gcodeFresh stays pending --------
{
  const r = buildStartReadiness({ ...happy(), gcode: null });
  assert(
    r.gates.find((g) => g.id === 'gcodeCompiled')?.status === 'fail',
    'no gcode: gcodeCompiled fails',
  );
  assert(
    r.gates.find((g) => g.id === 'gcodeFresh')?.status === 'pending',
    'no gcode: gcodeFresh is pending (not fail)',
  );
}

// -------- 5. Stale gcode → gcodeFresh fails --------
{
  const r = buildStartReadiness({ ...happy(), gcodeStale: true });
  assert(
    r.gates.find((g) => g.id === 'gcodeFresh')?.status === 'fail',
    'gcodeStale: gcodeFresh fails',
  );
}

// -------- 6. Preflight blocks with N blockers + M warnings → headline names counts --------
{
  const r = buildStartReadiness({
    ...happy(),
    preflight: {
      canStart: false,
      blockers: 3,
      warnings: 2,
      issues: [
        { severity: 'blocker', title: 'first', code: 'X1' as never },
        { severity: 'warning', title: 'warn', code: 'W1' as never },
      ],
    } as never,
  });
  const g = r.gates.find((g) => g.id === 'preflight');
  assert(g?.status === 'fail', 'preflight blocked: gate fails');
  assert(/3 blockers and 2 warnings/.test(g?.failHeadline ?? ''),
    `headline names blocker + warning counts (got '${g?.failHeadline}')`);
  assert(g?.failDetails?.length === 2,
    `failDetails carries up to 5 items (got ${g?.failDetails?.length})`);
}

// -------- 7. Singular blocker count → singular wording --------
{
  const r = buildStartReadiness({
    ...happy(),
    preflight: { canStart: false, blockers: 1, warnings: 0, issues: [] } as never,
  });
  const g = r.gates.find((g) => g.id === 'preflight');
  assert(g?.failHeadline === '1 blocker',
    `singular blocker → '1 blocker' (got '${g?.failHeadline}')`);
}

// -------- 8. Frame-control fail headline switches by mode --------
{
  // Laser unknown
  let r = buildStartReadiness({
    ...happy(),
    canFrame: false,
    laserOutputState: 'unknown',
  });
  assert(
    r.gates.find((g) => g.id === 'frameControls')?.failHeadline ===
      'Laser-safety state unknown',
    "frameControls headline: laser unknown",
  );

  // Recovery pending
  r = buildStartReadiness({
    ...happy(),
    canFrame: false,
    recoveryPending: true,
  });
  assert(
    r.gates.find((g) => g.id === 'frameControls')?.failHeadline ===
      'Previous job recovery is pending',
    "frameControls headline: recovery pending",
  );

  // Active operation
  r = buildStartReadiness({
    ...happy(),
    canFrame: false,
    activeOperation: { kind: 'jog', startedAt: 0, sessionId: 1 },
  });
  assert(
    /Operation "jog" is still in progress/.test(
      r.gates.find((g) => g.id === 'frameControls')?.failHeadline ?? '',
    ),
    "frameControls headline: active operation names kind",
  );

  // Non-idle status
  r = buildStartReadiness({
    ...happy(),
    canFrame: false,
    machineStatus: 'alarm',
    machineState: { ...happy().machineState!, status: 'alarm', alarmCode: 1 },
  });
  assert(
    r.gates.find((g) => g.id === 'frameControls')?.failHeadline === 'Machine is "alarm"',
    "frameControls headline: non-idle status",
  );
}

// -------- 9. Framing required vs achieved --------
{
  // requireFrame + canFrame + !hasFramed → framing fails
  let r = buildStartReadiness({
    ...happy(),
    requireFrame: true,
    canFrame: true,
    hasFramed: false,
  });
  assert(
    r.gates.find((g) => g.id === 'framing')?.status === 'fail',
    'requireFrame + canFrame + !hasFramed → framing fails',
  );

  // requireFrame + !canFrame + !hasFramed → framing pending (waiting on machine)
  r = buildStartReadiness({
    ...happy(),
    requireFrame: true,
    canFrame: false,
    hasFramed: false,
  });
  assert(
    r.gates.find((g) => g.id === 'framing')?.status === 'pending',
    'requireFrame + !canFrame → framing pending',
  );

  // requireFrame + hasFramed → ok
  r = buildStartReadiness({
    ...happy(),
    requireFrame: true,
    hasFramed: true,
  });
  assert(
    r.gates.find((g) => g.id === 'framing')?.status === 'ok',
    'requireFrame + hasFramed → framing ok',
  );

  // !requireFrame → always ok
  r = buildStartReadiness({ ...happy(), requireFrame: false });
  assert(
    r.gates.find((g) => g.id === 'framing')?.status === 'ok',
    '!requireFrame → framing ok regardless',
  );
}

// -------- 10. Current-mode anchor: only relevant for startMode='current' --------
{
  // absolute mode → currentModeAnchor always ok
  let r = buildStartReadiness({
    ...happy(),
    requireFrame: true,
    startMode: 'absolute',
    hasFramed: true,
    currentModeFrameAnchorValid: false, // doesn't matter
  });
  assert(
    r.gates.find((g) => g.id === 'currentModeAnchor')?.status === 'ok',
    "startMode='absolute' → currentModeAnchor ok regardless of validity",
  );

  // current mode + invalid anchor → fails
  r = buildStartReadiness({
    ...happy(),
    requireFrame: true,
    startMode: 'current',
    hasFramed: true,
    currentModeFrameAnchorValid: false,
  });
  assert(
    r.gates.find((g) => g.id === 'currentModeAnchor')?.status === 'fail',
    "startMode='current' + invalid anchor → fails",
  );
}

// -------- 11. WiFi trust gate: trusted vs blocked --------
{
  let r = buildStartReadiness({
    ...happy(),
    wifiTrust: trustedTrust,
    wifiStartAllowed: true,
  });
  assert(
    r.gates.find((g) => g.id === 'connectionTrust')?.status === 'ok',
    'trusted USB connection → connectionTrust ok',
  );
  assert(
    r.gates.find((g) => g.id === 'connectionTrust')?.label === 'Connection trust (USB Serial)',
    'connectionTrust label includes trust label',
  );

  r = buildStartReadiness({
    ...happy(),
    wifiTrust,
    wifiStartAllowed: false,
  });
  const g = r.gates.find((g) => g.id === 'connectionTrust');
  assert(g?.status === 'fail',
    'untrusted WiFi without override → connectionTrust fails');
  assert(g?.failAction === wifiTrust.hint,
    'failAction uses the trust hint when present');
}

// -------- 12. Connection-trust failAction has fallback when hint is null --------
{
  const partialTrust = {
    kind: 'unknown' as const,
    tier: 'partial' as const,
    label: 'Unknown',
    hint: null,
  };
  const r = buildStartReadiness({
    ...happy(),
    wifiTrust: partialTrust,
    wifiStartAllowed: false,
  });
  const g = r.gates.find((g) => g.id === 'connectionTrust');
  assert(/USB|override/i.test(g?.failAction ?? ''),
    `null hint → fallback failAction (got '${g?.failAction}')`);
}

// -------- 13. isRunning short-circuits ready=true regardless of gates --------
{
  // Disconnected + no gcode + recovery pending — would normally block,
  // but isRunning means a job is in progress and the panel UI isn't
  // showing the Start button anyway.
  const r = buildStartReadiness({
    ...happy(),
    isRunning: true,
    isConnected: false,
    gcode: null,
    recoveryPending: true,
  });
  assert(r.ready === true,
    'isRunning=true → ready=true regardless of gates (matches pre-T1-129 short-circuit)');
  assert(r.blockingGate === null, 'isRunning=true → no blocking gate reported');
}

// -------- 14. blockingGate is the FIRST failing gate (canonical order) --------
{
  // Both gcodeCompiled and connectionTrust would fail; first-fail wins.
  const r = buildStartReadiness({
    ...happy(),
    canStartJob: false,
    gcode: null, // gcodeCompiled fails
    wifiTrust,   // connectionTrust would fail
    wifiStartAllowed: false,
  });
  assert(r.blockingGate?.id === 'gcodeCompiled',
    `first-fail-in-canonical-order wins (got '${r.blockingGate?.id}')`);
}

// -------- Source-level pin: ConnectionPanelMain delegates --------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const panelSrc = readFileSync(
    resolve(here, '../src/ui/components/ConnectionPanelMain.tsx'),
    'utf-8',
  );
  assert(/import \{ buildStartReadiness \}/.test(panelSrc),
    'ConnectionPanelMain imports buildStartReadiness');
  assert(/T1-129/.test(panelSrc),
    'ConnectionPanelMain carries T1-129 marker');
  assert(/buildStartReadiness\(\{/.test(panelSrc),
    'ConnectionPanelMain calls buildStartReadiness with object input');
  // The pre-T1-129 inline IIFE pattern is gone — pin one of its
  // distinctive sub-expressions to make sure it didn't get duplicated.
  assert(
    !/const blockerCount = preflight\?\.blockers \?\? 0;[\s\S]{0,5000}gates: StartReadinessGate\[\] = \[/.test(panelSrc),
    'inline 142-line readiness IIFE is gone from ConnectionPanelMain',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
