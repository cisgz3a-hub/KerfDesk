/**
 * Regression guard: framing is recommended for gantry jobs, but no longer a
 * hard Start gate unless strict framing is enabled or position trust is lost.
 *
 * Run: npx tsx tests/frame-required-before-start.test.ts
 */

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  âœ“ ${message}`);
  } else {
    failed++;
    console.error(`  âœ— ${message}`);
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
  requireFrame: boolean;
  placementUncertain: boolean;
}

function computeCanStartJob(s: State): boolean {
  return (
    !!s.gcode &&
    !s.isRunning &&
    !!s.preflight?.canStart &&
    !s.gcodeStale &&
    !s.machineBlocksJobStart &&
    (!s.requireFrame || s.hasFramed) &&
    !s.placementUncertain
  );
}

function ready(): State {
  return {
    gcode: 'G0 X0 Y0\n',
    isRunning: false,
    preflight: { canStart: true },
    gcodeStale: false,
    machineBlocksJobStart: false,
    hasFramed: false,
    requireFrame: false,
    placementUncertain: false,
  };
}

function run(): void {
  console.log('\n=== frame recommended before start ===\n');

  {
    const s = ready();
    assert(
      computeCanStartJob(s) === true,
      'unframed gantry job can start when all safety and output gates pass',
    );
  }

  {
    const s = ready();
    s.requireFrame = true;
    assert(
      computeCanStartJob(s) === false,
      'strict frame mode still blocks start until frame succeeds',
    );
    s.hasFramed = true;
    assert(
      computeCanStartJob(s) === true,
      'strict frame mode allows start after frame succeeds',
    );
  }

  {
    const s = ready();
    s.placementUncertain = true;
    assert(
      computeCanStartJob(s) === false,
      'unframed start cannot bypass uncertain machine/work-coordinate state',
    );
  }

  {
    const s = ready();
    s.gcode = null;
    assert(computeCanStartJob(s) === false, 'missing G-code still blocks start');
  }

  {
    const s = ready();
    s.gcodeStale = true;
    assert(computeCanStartJob(s) === false, 'stale G-code still blocks start');
  }

  {
    const s = ready();
    s.preflight = { canStart: false };
    assert(computeCanStartJob(s) === false, 'preflight blockers still block start');
  }

  {
    const s = ready();
    s.machineBlocksJobStart = true;
    assert(computeCanStartJob(s) === false, 'non-idle or alarmed machine still blocks start');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
