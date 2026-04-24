/**
 * T1-3: Negative machine / G-code coords — severity depends on profile.allowsNegativeWorkspace.
 * Run: npx tsx tests/preflight-negative-coords.test.ts
 */
import { createBlankProfile, type DeviceProfile } from '../src/core/devices/DeviceProfile';
import {
  runPreflight,
  PREFLIGHT_CODES,
  type PreflightContext,
  type PreflightResult,
} from '../src/core/preflight/Preflight';
import { confirmPreflightForJobStart } from '../src/core/preflight/confirmPreflightForJobStart';
import type { PreflightSummary, PreflightIssue, IssueSeverity } from '../src/core/preflight/Preflight';
import { createScene, type Scene } from '../src/core/scene/Scene';
import { createRect } from '../src/core/scene/SceneObject';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function makeProfile(overrides: Partial<DeviceProfile> = {}): DeviceProfile {
  return { ...createBlankProfile('Test'), bedWidth: 300, bedHeight: 300, ...overrides };
}

function makeScene(): Scene {
  const s = createScene(300, 300, 'Neg test');
  const baseLayer = s.layers[0];
  baseLayer.name = 'L1';
  return {
    ...s,
    layers: [baseLayer],
    objects: [createRect(baseLayer.id, 20, 20, 50, 50, 'R')],
  };
}

function makeCtx(overrides: Partial<PreflightContext> = {}): PreflightContext {
  return {
    scene: makeScene(),
    profile: makeProfile(),
    optimizeOrderEnabled: true,
    preflightBedWidthMm: 300,
    preflightBedHeightMm: 300,
    ...overrides,
  };
}

/** Map engine results to the same blocker/warning shape as runPreflightSummary (for confirmPreflightForJobStart tests). */
function resultsToSummary(results: PreflightResult[]): PreflightSummary {
  const issues: PreflightIssue[] = results.map((r, i) => {
    const severity: IssueSeverity =
      r.severity === 'error' ? 'blocker' : r.severity === 'warning' ? 'warning' : 'info';
    return {
      id: `t-${i}-${r.code}`,
      severity,
      title: (r.message.split('. ')[0] || r.message).trim() || r.code,
      detail: r.message,
      category: 'output',
    };
  });
  const blockers = issues.filter(x => x.severity === 'blocker').length;
  const warnings = issues.filter(x => x.severity === 'warning').length;
  return { score: 0, issues, blockers, warnings, canStart: blockers === 0 };
}

console.log('\n=== output bounds: false/undefined → error ===');
{
  const withFlag = (v: boolean | undefined) => runPreflight(
    makeCtx({ profile: makeProfile({ allowsNegativeWorkspace: v }), machinePlanBounds: { minX: -5, minY: 0, maxX: 100, maxY: 100 } }),
  );
  const a = withFlag(false);
  assert(
    a.some(r => r.code === PREFLIGHT_CODES.OUTPUT_NEGATIVE_X && r.severity === 'error'),
    'allowsNegativeWorkspace: false → error',
  );
  const b = withFlag(undefined);
  assert(
    b.some(r => r.code === PREFLIGHT_CODES.OUTPUT_NEGATIVE_X && r.severity === 'error'),
    'omitted allowsNegativeWorkspace → error',
  );
}

console.log('\n=== output bounds: positive plan → no negative output codes ===');
{
  const r = runPreflight(
    makeCtx({ machinePlanBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 } }),
  );
  assert(!r.some(x => x.code === PREFLIGHT_CODES.OUTPUT_NEGATIVE_X || x.code === PREFLIGHT_CODES.OUTPUT_NEGATIVE_Y), 'no neg findings');
}

console.log('\n=== output bounds: allowsNegativeWorkspace true → warning ===');
{
  const r = runPreflight(
    makeCtx({
      profile: makeProfile({ allowsNegativeWorkspace: true }),
      machinePlanBounds: { minX: -5, minY: 0, maxX: 100, maxY: 100 },
    }),
  );
  assert(
    r.some(x => x.code === PREFLIGHT_CODES.OUTPUT_NEGATIVE_X && x.severity === 'warning'),
    'flag true → warning not error',
  );
}

console.log('\n=== gcode travel: false → error, true → warning ===');
{
  const gcode = 'G0 X-3 Y10';
  const f = runPreflight(
    makeCtx({
      profile: makeProfile({ allowsNegativeWorkspace: false }),
      machinePlanBounds: null,
      gcodeTravelScan: gcode,
    }),
  );
  assert(
    f.some(x => x.code === PREFLIGHT_CODES.GCODE_TRAVEL_NEGATIVE_X && x.severity === 'error'),
    'gcode path + false → error',
  );
  const w = runPreflight(
    makeCtx({
      profile: makeProfile({ allowsNegativeWorkspace: true }),
      machinePlanBounds: null,
      gcodeTravelScan: gcode,
    }),
  );
  assert(
    w.some(x => x.code === PREFLIGHT_CODES.GCODE_TRAVEL_NEGATIVE_X && x.severity === 'warning'),
    'gcode path + true → warning',
  );
}

async function runAsyncTests(): Promise<void> {
  console.log('\n=== confirmPreflightForJobStart: error blocks (no confirm) ===');
  {
    const results = runPreflight(
      makeCtx({ profile: makeProfile({ allowsNegativeWorkspace: false }), machinePlanBounds: { minX: -5, minY: 0, maxX: 10, maxY: 10 } }),
    );
    const summary = resultsToSummary(results);
    assert(!summary.canStart, 'summary has blockers');
    let alertCount = 0;
    let confirmCount = 0;
    const { confirmed } = await confirmPreflightForJobStart(
      summary,
      async () => { alertCount++; },
      async () => { confirmCount++; return true; },
    );
    assert(!confirmed, 'returns false when blockers');
    assert(alertCount === 1, 'showAlert once');
    assert(confirmCount === 0, 'no confirm when blocked');
  }

  console.log('\n=== confirmPreflightForJobStart: warning → confirm, proceed on true ===');
  {
    const refull = runPreflight(
      makeCtx({
        profile: makeProfile({ allowsNegativeWorkspace: true }),
        machinePlanBounds: { minX: -5, minY: 0, maxX: 10, maxY: 10 },
      }),
    );
    const fullSummary = resultsToSummary(refull);
    assert(fullSummary.canStart, 'warning-only canStart');
    assert(fullSummary.warnings > 0, 'has warnings');
    let confirmCount = 0;
    const { confirmed } = await confirmPreflightForJobStart(
      fullSummary,
      async () => {},
      async () => { confirmCount++; return true; },
    );
    assert(confirmCount === 1, 'showConfirm for warnings');
    assert(confirmed === true, 'user confirms');
  }
}

void runAsyncTests()
  .then(() => {
    if (failed > 0) process.exit(1);
    process.stdout.write(`\nPreflight negative coords: ${passed} passed\n`);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
