/**
 * F45-14-001: WorkflowPanel v2 must not be exposed to beta users
 * through stale/local DevTools feature-flag storage until it reaches
 * machine-control parity with the legacy ConnectionPanelMain path.
 *
 * Run: npx tsx tests/workflow-panel-v2-beta-lock.test.ts
 */
import {
  getAllUiFeatureFlags,
  getUiFeatureFlag,
  setUiFeatureFlag,
} from '../src/ui/features/uiFeatureFlags';

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

const memoryStore: Record<string, string> = {};
const dispatched: string[] = [];

(globalThis as unknown as { localStorage: Storage }).localStorage = {
  get length() { return Object.keys(memoryStore).length; },
  clear(): void { for (const k of Object.keys(memoryStore)) delete memoryStore[k]; },
  getItem: (k: string) => Object.prototype.hasOwnProperty.call(memoryStore, k) ? memoryStore[k] : null,
  key: (i: number) => Object.keys(memoryStore)[i] ?? null,
  removeItem: (k: string) => { delete memoryStore[k]; },
  setItem: (k: string, v: string) => { memoryStore[k] = v; },
} as Storage;

(globalThis as unknown as {
  window: { dispatchEvent: (e: Event) => boolean };
  Event: typeof Event;
}).window = {
  dispatchEvent: (e: Event) => {
    dispatched.push(e.type);
    return true;
  },
};

function resetMemoryStore(): void {
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];
  dispatched.length = 0;
}

console.log('\n=== F45-14-001 WorkflowPanel v2 beta lock ===\n');

// -------- 1. Stale/localStorage true cannot expose v2 --------
{
  resetMemoryStore();
  memoryStore['laserforge.feature.workflowPanelV2'] = 'true';
  assert(
    getUiFeatureFlag('workflowPanelV2') === false,
    'stale localStorage true does not expose WorkflowPanel v2',
  );
}

// -------- 2. Legacy "1" value cannot expose v2 --------
{
  resetMemoryStore();
  memoryStore['laserforge.feature.workflowPanelV2'] = '1';
  assert(
    getUiFeatureFlag('workflowPanelV2') === false,
    "legacy localStorage value '1' does not expose WorkflowPanel v2",
  );
}

// -------- 3. Programmatic set(true) persists but remains beta-locked --------
{
  resetMemoryStore();
  setUiFeatureFlag('workflowPanelV2', true);
  assert(
    memoryStore['laserforge.feature.workflowPanelV2'] === 'true',
    'set(true) preserves rollout preference for a future parity-safe build',
  );
  assert(
    getUiFeatureFlag('workflowPanelV2') === false,
    'set(true) does not expose v2 while the beta lock is active',
  );
  assert(
    dispatched.includes('laserforge:ui-feature-flag-changed'),
    'set(true) still dispatches the feature-flag change event',
  );
}

// -------- 4. Snapshots also report the effective locked value --------
{
  resetMemoryStore();
  memoryStore['laserforge.feature.workflowPanelV2'] = 'true';
  const snapshot = getAllUiFeatureFlags();
  assert(Object.isFrozen(snapshot), 'getAllUiFeatureFlags still returns a frozen object');
  assert(snapshot.workflowPanelV2 === false, 'snapshot reports effective beta-locked value');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
