/**
 * T1-204: regression test for the `uiFeatureFlags` module — the
 * persistence layer behind the `WorkflowPanel` rollout.
 *
 * What this test pins:
 *   - `workflowPanelV2` default is `false` so existing users see no
 *     change after the T1-204 ship.
 *   - `setUiFeatureFlag` persists to localStorage and round-trips
 *     through `getUiFeatureFlag`.
 *   - The storage key is namespaced (`laserforge.feature.*`) so a
 *     future flag won't collide with the other localStorage entries
 *     (active profile, autosave state, unsafe prior state, etc.).
 *   - The flag dispatches the `laserforge:ui-feature-flag-changed`
 *     event so subscribed components can re-render without polling.
 *   - Liberal read: legacy storage values 'true' / '1' both parse
 *     as true; anything else parses as false.
 *
 * Run: npx tsx tests/workflow-panel-feature-flag.test.ts
 */
import {
  getUiFeatureFlag,
  setUiFeatureFlag,
  getAllUiFeatureFlags,
  UI_FEATURE_FLAG_STORAGE_PREFIX,
  UI_FEATURE_FLAG_CHANGED_EVENT,
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

// Mock localStorage + window.dispatchEvent so the module's
// browser-side branches are exercised.
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

console.log('\n=== T1-204 uiFeatureFlags ===\n');

// -------- 1. Storage key prefix is namespaced --------
{
  assert(
    UI_FEATURE_FLAG_STORAGE_PREFIX === 'laserforge.feature.',
    "storage prefix is 'laserforge.feature.' (namespaced)",
  );
  assert(
    UI_FEATURE_FLAG_CHANGED_EVENT === 'laserforge:ui-feature-flag-changed',
    'event name follows the laserforge:* convention',
  );
}

// -------- 2. workflowPanelV2 default is false --------
{
  resetMemoryStore();
  assert(
    getUiFeatureFlag('workflowPanelV2') === false,
    'workflowPanelV2 default is false (no storage entry)',
  );
  const all = getAllUiFeatureFlags();
  assert(all.workflowPanelV2 === false, 'getAllUiFeatureFlags also returns false by default');
}

// -------- 3. setUiFeatureFlag persists and round-trips --------
{
  resetMemoryStore();
  setUiFeatureFlag('workflowPanelV2', true);
  assert(
    getUiFeatureFlag('workflowPanelV2') === true,
    'after set(true) → get() returns true',
  );
  assert(
    memoryStore['laserforge.feature.workflowPanelV2'] === 'true',
    "storage value is the literal 'true'",
  );
  setUiFeatureFlag('workflowPanelV2', false);
  assert(
    getUiFeatureFlag('workflowPanelV2') === false,
    'after set(false) → get() returns false',
  );
  assert(
    memoryStore['laserforge.feature.workflowPanelV2'] === 'false',
    "storage value is the literal 'false'",
  );
}

// -------- 4. Change event dispatched on set --------
{
  resetMemoryStore();
  setUiFeatureFlag('workflowPanelV2', true);
  assert(
    dispatched.includes('laserforge:ui-feature-flag-changed'),
    'set() dispatches the change event',
  );
}

// -------- 5. Liberal read: '1' parses as true --------
{
  resetMemoryStore();
  memoryStore['laserforge.feature.workflowPanelV2'] = '1';
  assert(
    getUiFeatureFlag('workflowPanelV2') === true,
    "legacy storage value '1' parses as true",
  );
}

// -------- 6. Liberal read: unknown values parse as false --------
{
  resetMemoryStore();
  memoryStore['laserforge.feature.workflowPanelV2'] = 'maybe';
  assert(
    getUiFeatureFlag('workflowPanelV2') === false,
    "unknown storage value 'maybe' parses as false (default-safe)",
  );
}

// -------- 7. getAllUiFeatureFlags returns a frozen snapshot --------
{
  resetMemoryStore();
  setUiFeatureFlag('workflowPanelV2', true);
  const snapshot = getAllUiFeatureFlags();
  assert(Object.isFrozen(snapshot), 'getAllUiFeatureFlags returns a frozen object');
  assert(snapshot.workflowPanelV2 === true, 'snapshot reflects the current value');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
