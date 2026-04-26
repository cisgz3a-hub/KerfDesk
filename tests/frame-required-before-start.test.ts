/**
 * T1-59 regression test: Start button must require Frame first.
 *
 * Bug: ConnectionPanelMain's `canStartJob` did not consult `hasFramed.current`.
 * A user could compile, never frame, and click Start — the laser fired
 * immediately at whatever the resolved start position was. For beginners with
 * origin/saved-origin/mirror confusions this can mean burning in the wrong
 * place. Audit 4B Critical UX Failure 2.
 *
 * Fix: `canStartJob` now requires `hasFramed.current === true` (gated by a
 * `requireFrame` constant — when T2-64 advanced-mode lands, this becomes
 * `!advancedMode`). The `startDisabledReason` text tells the user to frame.
 *
 * This test mirrors the canStartJob expression and the startDisabledReason
 * branches as a pure-logic regression — no React rendering needed. The full
 * UI render path is exercised by `ui-start-job-uses-ticket.test.tsx`, which
 * was updated to click Frame first under the new gate.
 *
 * If the production canStartJob expression diverges from the mirror below,
 * this test stops being a meaningful regression. The matching is intentional
 * and the production code carries a `// T1-59` comment marking the gate.
 *
 * Run: npx tsx tests/frame-required-before-start.test.ts
 */

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

interface PreflightLike { canStart: boolean }

interface State {
  gcode: string | null;
  isRunning: boolean;
  preflight: PreflightLike | null;
  gcodeStale: boolean;
  machineBlocksJobStart: boolean;
  hasFramed: boolean;
  machineStatus: string;
  /** T2-64 seam: when true, frame is not required. Hardcoded false in source today. */
  advancedMode: boolean;
}

/**
 * Mirror of the canStartJob expression in
 * `src/ui/components/ConnectionPanelMain.tsx` after the T1-59 fix. Kept
 * structurally identical so a future divergence shows up here.
 */
function computeCanStartJob(s: State): boolean {
  const requireFrame = !s.advancedMode;
  return (
    !!s.gcode &&
    !s.isRunning &&
    !!s.preflight?.canStart &&
    !s.gcodeStale &&
    !s.machineBlocksJobStart &&
    (!requireFrame || s.hasFramed)
  );
}

/**
 * Mirror of the startDisabledReason expression. Same intent: kept structurally
 * identical to the source.
 */
function computeStartDisabledReason(s: State): string | null {
  const requireFrame = !s.advancedMode;
  if (s.isRunning) return null;
  if (!s.gcode) return 'Click G-code in the toolbar to compile this design';
  if (s.gcodeStale) return 'Design changed - click ↻ Update above';
  if (!s.preflight?.canStart) return 'Fix the issues listed below first';
  if (s.machineBlocksJobStart) {
    return `Machine is "${s.machineStatus}" — wait for idle (stop or reset on the controller if needed)`;
  }
  if (requireFrame && !s.hasFramed) {
    return 'Frame the job first (use Frame button) — this confirms where the laser will burn';
  }
  return null;
}

function ready(): State {
  return {
    gcode: 'G0 X0 Y0\n',
    isRunning: false,
    preflight: { canStart: true },
    gcodeStale: false,
    machineBlocksJobStart: false,
    hasFramed: true,
    machineStatus: 'idle',
    advancedMode: false,
  };
}

function run(): void {
  console.log('\n=== frame-required-before-start (T1-59) ===\n');

  // ── 1. Frame required: hasFramed=false blocks otherwise-ready state ────
  {
    const s = ready();
    s.hasFramed = false;
    assert(
      computeCanStartJob(s) === false,
      'hasFramed=false with all other conditions met → canStartJob false (gate works)',
    );
    const reason = computeStartDisabledReason(s);
    assert(
      reason !== null && /frame/i.test(reason),
      'startDisabledReason mentions framing when blocked solely on frame',
    );
  }

  // ── 2. Frame satisfied: hasFramed=true with everything else ready ─────
  {
    const s = ready();
    assert(
      computeCanStartJob(s) === true,
      'hasFramed=true with all other conditions met → canStartJob true',
    );
    assert(
      computeStartDisabledReason(s) === null,
      'startDisabledReason null when ready',
    );
  }

  // ── 3. Frame doesn't bypass the gcode gate ─────────────────────────────
  {
    const s = ready();
    s.gcode = null;
    assert(
      computeCanStartJob(s) === false,
      'hasFramed=true but gcode=null → still blocked',
    );
    const reason = computeStartDisabledReason(s);
    assert(
      reason !== null && /compile/i.test(reason) && !/frame/i.test(reason),
      'reason cites missing G-code, not framing',
    );
  }

  // ── 4. Frame doesn't bypass the gcodeStale gate ────────────────────────
  {
    const s = ready();
    s.gcodeStale = true;
    assert(
      computeCanStartJob(s) === false,
      'hasFramed=true but gcodeStale=true → still blocked',
    );
    const reason = computeStartDisabledReason(s);
    assert(
      reason !== null && /design changed/i.test(reason) && !/frame/i.test(reason),
      'reason cites stale gcode, not framing',
    );
  }

  // ── 5. Frame doesn't bypass the preflight gate ─────────────────────────
  {
    const s = ready();
    s.preflight = { canStart: false };
    assert(
      computeCanStartJob(s) === false,
      'hasFramed=true but preflight.canStart=false → still blocked',
    );
    const reason = computeStartDisabledReason(s);
    assert(
      reason !== null && /issues/i.test(reason) && !/frame/i.test(reason),
      'reason cites preflight issues, not framing',
    );
  }

  // ── 6. Frame doesn't bypass the machine-status gate ────────────────────
  {
    const s = ready();
    s.machineBlocksJobStart = true;
    s.machineStatus = 'alarm';
    assert(
      computeCanStartJob(s) === false,
      'hasFramed=true but machine non-idle → still blocked',
    );
    const reason = computeStartDisabledReason(s);
    assert(
      reason !== null && /alarm/.test(reason) && !/frame/i.test(reason),
      'reason cites machine status, not framing',
    );
  }

  // ── 7. T2-64 seam: advancedMode=true bypasses the frame requirement ────
  // Production today hardcodes advancedMode=false. This test future-proofs the
  // T2-64 hookup so when it lands, the override works as documented.
  {
    const s = ready();
    s.hasFramed = false;
    s.advancedMode = true;
    assert(
      computeCanStartJob(s) === true,
      'advancedMode=true bypasses frame requirement (T2-64 seam)',
    );
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
