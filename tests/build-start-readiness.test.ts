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
 *   - All 14 readiness gates render in canonical order with correct
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
    placementUncertainReason: null,
    onResetWcsToBaseline: null,
    recoveryAllowsStart: true,
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
  assert(r.gates.length === 14, `14 gates rendered (got ${r.gates.length})`);
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
    'noActiveOperation',
    'noControllerError',
    'wcsState',
    'recoveryComplete',
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

// -------- 15. T1-203: WCS-state gate surfaces the reason --------
//
// Pre-T1-203 every placement-uncertain trigger produced the same
// "No WCS consent prompt was shown on connect" message. Only the
// T1-20 no-listener race (reason === null) actually matched that
// description. T1-203 routes each reason to a cause-specific
// failHeadline + failAction so the user knows whether to clear an
// alarm, check the cable, or just reconnect.
{
  // Default: placement is fine, gate is ok.
  {
    const r = buildStartReadiness(happy());
    const g = r.gates.find((g) => g.id === 'wcsState');
    assert(g?.status === 'ok', 'placement ok → wcsState gate ok');
  }

  // reason === null (T1-20 no-listener race) keeps the legacy text.
  {
    const r = buildStartReadiness({
      ...happy(),
      placementUncertain: true,
      placementUncertainReason: null,
      canStartJob: false,
    });
    const g = r.gates.find((g) => g.id === 'wcsState');
    assert(g?.status === 'fail', 'reason=null → wcsState fails');
    assert(
      /No WCS consent prompt was shown/.test(g?.failAction ?? ''),
      'reason=null → original "no consent prompt" message preserved',
    );
  }

  // reason === 'wcs_query_error' (T1-174): GRBL returned error to $#.
  {
    const r = buildStartReadiness({
      ...happy(),
      placementUncertain: true,
      placementUncertainReason: 'wcs_query_error',
      canStartJob: false,
    });
    const g = r.gates.find((g) => g.id === 'wcsState');
    assert(
      /refused the WCS query/i.test(g?.failHeadline ?? ''),
      "wcs_query_error → headline names the refused $# query",
    );
    assert(
      /soft-reset|M999/.test(g?.failAction ?? ''),
      'wcs_query_error → recovery action mentions soft-reset / M999',
    );
  }

  // reason === 'missing_g54': $# response missing [G54:...].
  {
    const r = buildStartReadiness({
      ...happy(),
      placementUncertain: true,
      placementUncertainReason: 'missing_g54',
      canStartJob: false,
    });
    const g = r.gates.find((g) => g.id === 'wcsState');
    assert(
      /did not report a G54 offset/i.test(g?.failHeadline ?? ''),
      'missing_g54 → headline names the missing G54',
    );
    // T1-205: assert the failAction now points at the recovery button
    // (the "Use the button below" phrasing). Cable/firmware hints
    // remain implicit in the malformed-* variants where they're still
    // a possible cause, but the data-failure recoveries route through
    // the button as the primary path.
    assert(
      /button below|initialize G54/i.test(g?.failAction ?? ''),
      'missing_g54 → recovery hint points at the reset button',
    );
  }

  // reason === 'malformed_g54': $# returned unparseable G54.
  {
    const r = buildStartReadiness({
      ...happy(),
      placementUncertain: true,
      placementUncertainReason: 'malformed_g54',
      canStartJob: false,
    });
    const g = r.gates.find((g) => g.id === 'wcsState');
    assert(
      /malformed G54 offset/i.test(g?.failHeadline ?? ''),
      'malformed_g54 → headline names the malformed G54',
    );
    assert(
      /button below|cable/i.test(g?.failAction ?? ''),
      'malformed_g54 → recovery hint mentions the button or the cable',
    );
  }

  // reason === 'missing_status_mask': $$ dump had no $10.
  {
    const r = buildStartReadiness({
      ...happy(),
      placementUncertain: true,
      placementUncertainReason: 'missing_status_mask',
      canStartJob: false,
    });
    const g = r.gates.find((g) => g.id === 'wcsState');
    assert(
      /\$10 status mask/i.test(g?.failHeadline ?? ''),
      'missing_status_mask → headline names $10',
    );
    assert(
      /button below|\$10=0/i.test(g?.failAction ?? ''),
      'missing_status_mask → recovery hint points at the reset button',
    );
  }

  // reason === 'malformed_status_mask': $10= had unparseable value.
  {
    const r = buildStartReadiness({
      ...happy(),
      placementUncertain: true,
      placementUncertainReason: 'malformed_status_mask',
      canStartJob: false,
    });
    const g = r.gates.find((g) => g.id === 'wcsState');
    assert(
      /malformed \$10/i.test(g?.failHeadline ?? ''),
      'malformed_status_mask → headline names the malformed $10',
    );
    assert(
      /button below|cable/i.test(g?.failAction ?? ''),
      'malformed_status_mask → recovery hint mentions the button or the cable',
    );
  }

  // Each reason produces a DISTINCT (failHeadline, failAction) pair
  // — guards against the pre-T1-203 single-message bug regressing.
  {
    const reasons = [
      null,
      'wcs_query_error',
      'missing_g54',
      'malformed_g54',
      'missing_status_mask',
      'malformed_status_mask',
    ] as const;
    const seen = new Set<string>();
    for (const reason of reasons) {
      const r = buildStartReadiness({
        ...happy(),
        placementUncertain: true,
        placementUncertainReason: reason,
        canStartJob: false,
      });
      const g = r.gates.find((g) => g.id === 'wcsState');
      const key = `${g?.failHeadline}||${g?.failAction}`;
      seen.add(key);
    }
    assert(
      seen.size === reasons.length,
      `each of the ${reasons.length} reasons produces a distinct message pair (got ${seen.size})`,
    );
  }
}

// -------- 16. T1-205: data-failure reasons get a recovery button --------
//
// User-reported bug: hitting `missing_g54` had no recovery action
// — disconnect+reconnect didn't help because GRBL still didn't
// respond to $# with G54. The fix exposes a button that fires
// `applyWcsNormalization()` (G10 L2 P1 X0 Y0 Z0 + $10=0) so the
// user can recover from the UI without typing console commands.
//
// The button SHOULD appear for the four "data" reasons
// (missing/malformed × G54/$10) but NOT for `wcs_query_error`
// (needs alarm clear at the controller) or `null` (T1-20 listener
// race — needs reconnect cycle).
{
  const noop = () => {};
  const dataReasons = [
    'missing_g54',
    'malformed_g54',
    'missing_status_mask',
    'malformed_status_mask',
  ] as const;
  for (const reason of dataReasons) {
    const r = buildStartReadiness({
      ...happy(),
      placementUncertain: true,
      placementUncertainReason: reason,
      onResetWcsToBaseline: noop,
      canStartJob: false,
    });
    const g = r.gates.find((g) => g.id === 'wcsState');
    assert(
      g?.failActionButton !== undefined,
      `${reason}: failActionButton present`,
    );
    assert(
      g?.failActionButton?.label === 'Reset WCS to baseline (G10 L2 P1 X0 Y0 Z0)',
      `${reason}: button label names the actual G10 command`,
    );
    assert(
      g?.failActionButton?.onClick === noop,
      `${reason}: button onClick is the wired callback`,
    );
  }

  // wcs_query_error gets NO button (alarm-level recovery needed).
  {
    const r = buildStartReadiness({
      ...happy(),
      placementUncertain: true,
      placementUncertainReason: 'wcs_query_error',
      onResetWcsToBaseline: noop,
      canStartJob: false,
    });
    const g = r.gates.find((g) => g.id === 'wcsState');
    assert(
      g?.failActionButton === undefined,
      "wcs_query_error: no button (alarm-clear is controller-level)",
    );
  }

  // null reason gets NO button (T1-20 listener race — reconnect).
  {
    const r = buildStartReadiness({
      ...happy(),
      placementUncertain: true,
      placementUncertainReason: null,
      onResetWcsToBaseline: noop,
      canStartJob: false,
    });
    const g = r.gates.find((g) => g.id === 'wcsState');
    assert(
      g?.failActionButton === undefined,
      'null reason: no button (reconnect fixes the listener race)',
    );
  }

  // No callback wired → no button even when reason qualifies.
  {
    const r = buildStartReadiness({
      ...happy(),
      placementUncertain: true,
      placementUncertainReason: 'missing_g54',
      onResetWcsToBaseline: null,
      canStartJob: false,
    });
    const g = r.gates.find((g) => g.id === 'wcsState');
    assert(
      g?.failActionButton === undefined,
      'missing_g54 + no callback → no button (graceful degrade)',
    );
  }

  // Source pin: ConnectionPanelMain wires applyWcsNormalization.
  {
    const here = dirname(fileURLToPath(import.meta.url));
    const panelSrc = readFileSync(
      resolve(here, '../src/ui/components/ConnectionPanelMain.tsx'),
      'utf-8',
    );
    assert(
      /T1-205/.test(panelSrc),
      'ConnectionPanelMain carries T1-205 marker',
    );
    assert(
      /onResetWcsToBaseline:[\s\S]{0,200}applyWcsNormalization/.test(panelSrc),
      'ConnectionPanelMain wires onResetWcsToBaseline to applyWcsNormalization',
    );
  }
}

// -------- 17. Hidden canStartJob conjuncts are visible --------
//
// Regression: Start could be disabled while every readiness row
// looked green because canStartJob also depended on baseSafe and
// recoveryAllowsStart. These rows keep the explanation aligned with
// the real Start button predicate.
{
  {
    const r = buildStartReadiness({
      ...happy(),
      activeOperation: { kind: 'jog', startedAt: 0, sessionId: 1 },
      canStartJob: false,
    });
    const g = r.gates.find((g) => g.id === 'noActiveOperation');
    assert(g?.status === 'fail', 'activeOperation set: noActiveOperation fails');
    assert(/jog/i.test(g?.failHeadline ?? ''), 'activeOperation: failHeadline names operation kind');
  }

  {
    const r = buildStartReadiness({
      ...happy(),
      machineState: { ...happy().machineState!, errorCode: 7 },
      canStartJob: false,
    });
    const g = r.gates.find((g) => g.id === 'noControllerError');
    assert(g?.status === 'fail', 'machineState.errorCode set: noControllerError fails');
    assert(/7/.test(g?.failHeadline ?? ''), 'controller error: failHeadline names error code');
  }

  {
    const r = buildStartReadiness({
      ...happy(),
      recoveryAllowsStart: false,
      canStartJob: false,
    });
    const g = r.gates.find((g) => g.id === 'recoveryComplete');
    assert(g?.status === 'fail', 'recoveryAllowsStart=false: recoveryComplete fails');
    assert(
      !/Recovery checklist incomplete/i.test(`${g?.failHeadline ?? ''} ${g?.failAction ?? ''}`),
      'recoveryAllowsStart=false: recovery gate no longer shows dead-end checklist wording',
    );
  }

  {
    const r = buildStartReadiness({
      ...happy(),
      recoveryPending: true,
      canStartJob: false,
    });
    const g = r.gates.find((g) => g.id === 'recoveryComplete');
    assert(g?.status === 'fail', 'recoveryPending=true: recoveryComplete fails');
    assert(/unsafe state pending/i.test(g?.failHeadline ?? ''),
      'recoveryPending: failHeadline names unsafe prior state');
  }

  {
    const r = buildStartReadiness({
      ...happy(),
      laserOutputState: 'on',
      canStartJob: false,
    });
    const g = r.gates.find((g) => g.id === 'laserState');
    assert(g?.status === 'fail', "laserOutputState 'on': laserState fails");
    assert(/still on/i.test(g?.failHeadline ?? ''), "laserOutputState 'on': headline names laser still on");
  }

  {
    const r = buildStartReadiness(happy());
    assert(r.gates.find((g) => g.id === 'noActiveOperation')?.status === 'ok',
      'happy: noActiveOperation ok');
    assert(r.gates.find((g) => g.id === 'noControllerError')?.status === 'ok',
      'happy: noControllerError ok');
    assert(r.gates.find((g) => g.id === 'recoveryComplete')?.status === 'ok',
      'happy: recoveryComplete ok');
  }
}

// -------- 19. WCS reset is surfaced before recovery copy when both block Start --------
{
  const noop = () => {};
  const r = buildStartReadiness({
    ...happy(),
    placementUncertain: true,
    placementUncertainReason: 'missing_g54',
    recoveryAllowsStart: false,
    canStartJob: false,
    onResetWcsToBaseline: noop,
  });
  const wcs = r.gates.find((g) => g.id === 'wcsState');
  assert(r.blockingGate?.id === 'wcsState',
    `WCS reset should be first blocking action when WCS and recovery both fail (got ${r.blockingGate?.id})`);
  assert(wcs?.failActionButton?.onClick === noop,
    'WCS gate keeps the reset-to-baseline action while recovery state also blocks Start');
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
  // T1-203 source-pins: the panel reads the placement-uncertain
  // reason from the controller and threads it into the readiness
  // input.
  assert(/T1-203/.test(panelSrc), 'ConnectionPanelMain carries T1-203 marker');
  assert(
    /controllerRef\.current\?\.getPlacementUncertainReason\?\.\(\)/.test(panelSrc),
    'ConnectionPanelMain reads getPlacementUncertainReason from the controller',
  );
  assert(
    /placementUncertainReason,/.test(panelSrc),
    'ConnectionPanelMain threads placementUncertainReason into buildStartReadiness',
  );

  // T1-203 source-pins on the helper module + interface.
  const helperSrc = readFileSync(
    resolve(here, '../src/ui/components/connection/buildStartReadiness.ts'),
    'utf-8',
  );
  assert(/T1-203/.test(helperSrc), 'buildStartReadiness.ts carries T1-203 marker');
  assert(
    /function wcsStateGate\(input: BuildStartReadinessInput\): StartReadinessGate/.test(helperSrc),
    'wcsStateGate helper extracted',
  );
  assert(
    /placementUncertainReason:\s*WcsUncertainReason \| null/.test(helperSrc),
    'BuildStartReadinessInput declares placementUncertainReason field',
  );

  const ifaceSrc = readFileSync(
    resolve(here, '../src/controllers/ControllerInterface.ts'),
    'utf-8',
  );
  assert(/T1-203/.test(ifaceSrc), 'ControllerInterface.ts carries T1-203 marker');
  assert(
    /getPlacementUncertainReason\?\(\): string \| null;/.test(ifaceSrc),
    'LaserController interface declares optional getPlacementUncertainReason',
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
