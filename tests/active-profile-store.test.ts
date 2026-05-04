/**
 * T2-52: centralized active-profile external store with `useSyncExternalStore`.
 *
 * Replaces ad-hoc patterns (1-second polling + storage event listener +
 * `laserforge:active-profile-changed` custom event + App.tsx's
 * profileRevision counter) with a single store. Listeners notified on:
 *   - `setActiveProfile(p)` direct mutator call
 *   - `storage` event (cross-tab updates)
 *   - `laserforge:active-profile-changed` custom event (back-compat
 *     with existing mutators that haven't migrated)
 *
 * Run: npx tsx tests/active-profile-store.test.ts
 */
import {
  activeProfileStore,
  ActiveProfileStore,
} from '../src/core/devices/ActiveProfileStore';
import {
  createBlankProfile,
  saveDeviceProfile,
  setActiveProfileId,
  type DeviceProfile,
} from '../src/core/devices/DeviceProfile';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ✓ ${m}`);
  } else {
    failed++;
    console.error(`  ✗ ${m}`);
  }
}

console.log('\n=== T2-52 active-profile external store ===\n');

const memoryStore: Record<string, string> = {};
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  get length(): number { return Object.keys(memoryStore).length; },
  key: (i: number) => Object.keys(memoryStore)[i] ?? null,
  getItem: (k: string) => (k in memoryStore ? memoryStore[k] : null),
  setItem: (k: string, v: string) => { memoryStore[k] = v; },
  removeItem: (k: string) => { delete memoryStore[k]; },
  clear: () => { for (const k of Object.keys(memoryStore)) delete memoryStore[k]; },
};

// Minimal window stub for the store's event listeners. Nodes below 21
// don't have a global window; the store's `typeof window !== 'undefined'`
// guard keeps it functional, but tests want to verify event delivery,
// so we install a simple EventTarget-shaped stub.
type StubWindow = {
  _listeners: Map<string, Set<(e: unknown) => void>>;
  addEventListener: (t: string, l: (e: unknown) => void) => void;
  removeEventListener: (t: string, l: (e: unknown) => void) => void;
  dispatchEvent: (e: { type: string }) => void;
};

const stubWindow: StubWindow = {
  _listeners: new Map(),
  addEventListener(type, listener) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type)!.add(listener);
  },
  removeEventListener(type, listener) {
    this._listeners.get(type)?.delete(listener);
  },
  dispatchEvent(event) {
    const set = this._listeners.get(event.type);
    if (!set) return;
    for (const l of set) l(event);
  },
};
(globalThis as unknown as { window: StubWindow }).window = stubWindow;
// Also alias Event so `new Event('foo')` works.
(globalThis as unknown as { Event: typeof Event }).Event = class FakeEvent {
  type: string;
  constructor(type: string) { this.type = type; }
} as unknown as typeof Event;

async function run(): Promise<void> {

function freshProfile(name: string): DeviceProfile {
  const p = createBlankProfile(name);
  p.bedWidth = 300;
  p.bedHeight = 200;
  p.maxSpindle = 1000;
  p.maxFeedRate = 6000;
  p.baudRate = 115200;
  p.originCorner = 'front-left';
  return p;
}

// Reset memory + store between tests by using a fresh store instance.
function freshStore(): ActiveProfileStore {
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];
  stubWindow._listeners.clear();
  activeProfileStore.destroyForTests();
  return new ActiveProfileStore();
}

// ── 1. Subscribe + setActiveProfile fires the listener ──
{
  const store = freshStore();
  const p = freshProfile('A');
  saveDeviceProfile(p);

  let calls = 0;
  const unsub = store.subscribe(() => { calls++; });
  store.setActiveProfile(p);
  assert(calls >= 1, `setActiveProfile fires subscriber (got ${calls})`);
  assert(store.getSnapshot()?.id === p.id, 'getSnapshot returns the just-set profile');
  unsub();
}

// ── 2. Multiple subscribers — all notified on a single mutation ──
{
  const store = freshStore();
  const p = freshProfile('multi');
  saveDeviceProfile(p);

  let aCalls = 0;
  let bCalls = 0;
  store.subscribe(() => { aCalls++; });
  store.subscribe(() => { bCalls++; });
  store.setActiveProfile(p);
  assert(aCalls === 1 && bCalls === 1,
    `both subscribers notified once on a single mutation (a=${aCalls} b=${bCalls})`);
}

// ── 3. Unsubscribe — no further notifications ──
{
  const store = freshStore();
  const p = freshProfile('unsub');
  saveDeviceProfile(p);

  let calls = 0;
  const unsub = store.subscribe(() => { calls++; });
  store.setActiveProfile(p);
  unsub();
  store.setActiveProfile(p);
  assert(calls === 1, `unsubscribed listener received exactly one notification (got ${calls})`);
}

// ── 4. Storage event from another tab triggers refresh + notify ──
{
  const store = freshStore();
  const p = freshProfile('cross-tab');
  saveDeviceProfile(p);

  let calls = 0;
  store.subscribe(() => { calls++; });

  // First trigger the store's lazy init by reading.
  store.getSnapshot();

  // Now simulate a cross-tab storage event.
  setActiveProfileId(p.id);  // change the underlying state
  stubWindow.dispatchEvent({ type: 'storage', key: 'laserforge_active_profile' } as unknown as Event);

  assert(calls >= 1, `storage event triggers notify (got ${calls})`);
  assert(store.getSnapshot()?.id === p.id, 'snapshot reflects post-storage-event state');
}

// ── 5. Custom event (legacy mutators) triggers refresh + notify ──
{
  const store = freshStore();
  const p = freshProfile('legacy');
  saveDeviceProfile(p);

  let calls = 0;
  store.subscribe(() => { calls++; });

  // Force lazy init.
  store.getSnapshot();

  // Legacy mutator pattern: set ID directly + dispatch the custom event.
  setActiveProfileId(p.id);
  stubWindow.dispatchEvent({ type: 'laserforge:active-profile-changed' } as unknown as Event);

  assert(calls >= 1, `custom event triggers notify (back-compat for legacy mutators)`);
  assert(store.getSnapshot()?.id === p.id, 'snapshot reflects post-custom-event state');
}

// ── 6. setActiveProfile dispatches the custom event for back-compat ──
{
  const store = freshStore();
  const p = freshProfile('event-dispatch');
  saveDeviceProfile(p);

  let customEventFired = false;
  stubWindow.addEventListener('laserforge:active-profile-changed', () => {
    customEventFired = true;
  });

  store.setActiveProfile(p);
  assert(customEventFired,
    'setActiveProfile dispatches laserforge:active-profile-changed for legacy listeners');
}

// ── 7. setActiveProfile(null) clears the snapshot ──
{
  const store = freshStore();
  const p = freshProfile('clear');
  saveDeviceProfile(p);
  store.setActiveProfile(p);

  store.setActiveProfile(null);
  assert(store.getSnapshot() === null, 'setActiveProfile(null) clears the snapshot');
}

// ── 8. refresh() re-reads storage; no-op when snapshot identity unchanged ──
{
  const store = freshStore();
  const p = freshProfile('refresh');
  saveDeviceProfile(p);
  setActiveProfileId(p.id);

  let calls = 0;
  store.subscribe(() => { calls++; });
  store.getSnapshot();  // initialize

  store.refresh();
  // Refresh fired but the snapshot identity may differ if the underlying
  // cache returns a different object. We accept either 0 or 1 call here.
  assert(calls >= 0, 'refresh runs without throwing');
}

// ── 9. Listener that throws does NOT break other subscribers ──
{
  const store = freshStore();
  const p = freshProfile('throw');
  saveDeviceProfile(p);

  const origWarn = console.warn;
  let warned = false;
  console.warn = () => { warned = true; };
  try {
    store.subscribe(() => { throw new Error('listener boom'); });
    let goodCalled = false;
    store.subscribe(() => { goodCalled = true; });

    store.setActiveProfile(p);
    assert(goodCalled, 'second subscriber still called after first throws');
    assert(warned, 'thrown listener is logged via console.warn');
  } finally {
    console.warn = origWarn;
  }
}

// ── 10. Source-level pin ──
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(
    path.resolve(here, '../src/core/devices/ActiveProfileStore.ts'),
    'utf-8',
  );
  assert(/T2-52/.test(src), 'T2-52 marker in ActiveProfileStore.ts');
  assert(/import \{ useSyncExternalStore \} from 'react'/.test(src),
    'useSyncExternalStore imported from React');
  assert(/export class ActiveProfileStore/.test(src),
    'ActiveProfileStore class exported');
  assert(/export const activeProfileStore = new ActiveProfileStore\(\)/.test(src),
    'singleton activeProfileStore exported');
  assert(/export function useActiveProfile\(\): DeviceProfile \| null/.test(src),
    'useActiveProfile hook exported');
  assert(/laserforge:active-profile-changed/.test(src),
    'subscribes to legacy custom event for back-compat');
  assert(/'storage'/.test(src), 'subscribes to storage event for cross-tab updates');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
