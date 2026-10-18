import { expect, type CDPSession, type Page } from '@playwright/test';

// Heartbeats supplement browser-owned runtime evidence. An idle or blocked
// worker can stop ticking without releasing its execution context or resources.
const probe = `
(function installProbe(source) {
  let counts, owners, owner;
  self.addEventListener('message', event => {
    if (event.data?.kind !== 'nesting-lifetime-probe') return;
    event.stopImmediatePropagation();
    if (counts) return;
    counts = new Int32Array(event.data.buffer);
    owners = new Int32Array(event.data.owners);
    owner = event.data.owner;
    const slot = Atomics.add(counts, 0, 1) + 1;
    Atomics.store(owners, slot, owner);
    Atomics.add(counts, slot, 1);
    setInterval(() => Atomics.add(counts, slot, 1), 20);
  });
  const NativeWorker = self.Worker;
  self.Worker = class extends NativeWorker {
    constructor(...args) {
      const body = '(' + installProbe.toString() + ')(' + JSON.stringify(source) + ');' + source;
      const bootstrap = URL.createObjectURL(new Blob([body], { type: 'text/javascript' }));
      super(bootstrap, args[1]);
      if (counts) this.postMessage({ kind: 'nesting-lifetime-probe', buffer: counts.buffer, owners: owners.buffer, owner });
    }
  };
})
`;

interface LifetimeState {
  counts: Int32Array;
  owners: Int32Array;
  roots: { terminated: boolean; terminatedAt?: number; url: string }[];
}

declare global {
  interface Window {
    __nestingLifetime: LifetimeState;
    __nestingBlockedWorker?: Worker;
  }
}

interface WorkerRuntime {
  target: string;
  url: string;
  parent: string | undefined;
  destroyed: boolean;
  destroyedAt?: number;
}

// Busy workers can need Chromium's 2 s forcible-termination grace period at
// each nesting level. Keep a bounded allowance for that asynchronous teardown;
// only a browser targetDestroyed event proves that the worker was released.
const CHROMIUM_FORCIBLE_TERMINATION_MS = 2_000;
const THREAD_TEARDOWN_ALLOWANCE_MS = 3_000;

export class RuntimeObserver {
  readonly workers = new Map<string, WorkerRuntime>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly cdp: CDPSession,
    contextId: string,
  ) {
    // Browser discovery sees nested workers without attaching debugger sessions.
    // Those attachments can perturb the same worker teardown we are measuring.
    cdp.on('Target.targetCreated', ({ targetInfo }) => {
      if (targetInfo.type !== 'worker' || targetInfo.browserContextId !== contextId) return;
      const worker: WorkerRuntime = {
        target: targetInfo.targetId,
        url: targetInfo.url,
        parent: (targetInfo as { parentId?: string }).parentId,
        destroyed: false,
      };
      this.workers.set(worker.target, worker);
    });
    cdp.on('Target.targetInfoChanged', ({ targetInfo }) => {
      const worker = this.workers.get(targetInfo.targetId);
      if (worker) worker.url = targetInfo.url;
    });
    cdp.on('Target.targetDestroyed', ({ targetId }) => {
      const worker = this.workers.get(targetId);
      if (!worker) return;
      worker.destroyed = true;
      worker.destroyedAt = Date.now();
      this.changed();
    });
  }

  private changed(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private depth(): number {
    const level = (worker: WorkerRuntime, hops: number): number => {
      const parent = worker.parent === undefined ? undefined : this.workers.get(worker.parent);
      return parent === undefined || hops > this.workers.size ? 1 : 1 + level(parent, hops + 1);
    };
    return Math.max(0, ...[...this.workers.values()].map((worker) => level(worker, 0)));
  }

  // Settle on positive browser destruction events within the existing bounded
  // teardown allowance. Silence, detachment and context loss do not pass.
  async destruction(): Promise<string[]> {
    const deadline = this.depth() * CHROMIUM_FORCIBLE_TERMINATION_MS + THREAD_TEARDOWN_ALLOWANCE_MS;
    await new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        this.listeners.delete(check);
        resolve();
      };
      const check = (): void => {
        if (this.pending().length === 0) done();
      };
      const timer = setTimeout(done, deadline);
      this.listeners.add(check);
      check();
    });
    return this.pending();
  }

  pending(): string[] {
    return [...this.workers.values()]
      .filter((worker) => !worker.destroyed)
      .map((worker) => worker.target + ' (' + worker.url + '): target not destroyed');
  }

  async dispose(): Promise<void> {
    await this.cdp.detach();
  }
}

const observers = new WeakMap<Page, RuntimeObserver>();

export async function observeNestingLifetime(page: Page): Promise<void> {
  const browser = page.context().browser();
  if (!browser) throw new Error('Worker lifetime proof requires a Chromium browser');
  const pageSession = await page.context().newCDPSession(page);
  const { targetInfo } = await pageSession.send('Target.getTargetInfo');
  await pageSession.detach();
  if (!targetInfo.browserContextId) throw new Error('Missing isolated browser context');
  const cdp = await browser.newBrowserCDPSession();
  const observer = new RuntimeObserver(cdp, targetInfo.browserContextId);
  observers.set(page, observer);
  await cdp.send('Target.setDiscoverTargets', { discover: true });
  await page.context().route('**/packing-solver-worker.js', async (route) => {
    const response = await route.fetch();
    const source = (await response.text()).replaceAll(
      'self.location.href',
      JSON.stringify(route.request().url()),
    );
    await route.fulfill({ response, body: probe + '(' + JSON.stringify(source) + ');' + source });
  });
  await page.addInitScript(() => {
    const state: LifetimeState = {
      counts: new Int32Array(new SharedArrayBuffer(4096)),
      owners: new Int32Array(new SharedArrayBuffer(4096)),
      roots: [],
    };
    window.__nestingLifetime = state;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      private readonly record: { terminated: boolean; terminatedAt?: number; url: string };
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.record = { terminated: false, url: String(url) };
        state.roots.push(this.record);
        if (String(url).includes('packing-solver-worker.js')) {
          this.postMessage({
            kind: 'nesting-lifetime-probe',
            buffer: state.counts.buffer,
            owners: state.owners.buffer,
            owner: state.roots.length,
          });
        }
      }
      override terminate(): void {
        this.record.terminated = true;
        this.record.terminatedAt = Date.now();
        super.terminate();
      }
    };
  });
}

export async function disposeNestingLifetime(page: Page): Promise<void> {
  const observer = observers.get(page);
  observers.delete(page);
  await observer?.dispose();
}

export async function expectNestingStopped(page: Page, completed: boolean): Promise<void> {
  const observer = observers.get(page);
  if (!observer) throw new Error('Missing independent worker runtime observer');
  const snapshot = () =>
    page.evaluate(() => ({
      roots: window.__nestingLifetime.roots,
      counts: Array.from(window.__nestingLifetime.counts),
      owners: Array.from(window.__nestingLifetime.owners),
    }));
  const before = await snapshot();
  expect(before.roots.length).toBeGreaterThanOrEqual(completed ? 4 : 1);
  expect(before.roots.every((worker) => worker.terminated)).toBe(true);
  if (completed) {
    const solverOwners = before.roots.flatMap((root, index) =>
      root.url.includes('packing-solver-worker.js') ? [index + 1] : [],
    );
    expect(solverOwners).toHaveLength(2);
    for (const owner of solverOwners) {
      const slots = before.owners.flatMap((value, index) => (value === owner ? [index] : []));
      // Each session must actually boot both its root and at least one pthread.
      expect(slots.length).toBeGreaterThanOrEqual(2);
      for (const slot of slots) expect(before.counts[slot]).toBeGreaterThan(0);
    }
  }
  const nonSolverRoots = before.roots.filter(
    (root) => !root.url.includes('packing-solver-worker.js'),
  ).length;
  const observedWorkers = Math.max(before.roots.length, (before.counts[0] ?? 0) + nonSolverRoots);
  expect(observer.workers.size).toBeGreaterThanOrEqual(observedWorkers);
  // Every discovered worker needs positive target destruction. No heartbeat,
  // protocol timeout, context loss or detached parent can stand in for that evidence.
  expect(await observer.destruction()).toEqual([]);
  // Worker.terminate() requests asynchronous teardown. Heartbeats may advance
  // before the browser confirms destruction, but must stop after that barrier.
  const stopped = await snapshot();
  await page.waitForTimeout(100);
  expect(await snapshot()).toEqual(stopped);
  expect(observer.pending()).toEqual([]);
}

export function nestingRuntimeSnapshot(page: Page) {
  return [...(observers.get(page)?.workers.values() ?? [])].map((worker) => ({
    ...worker,
  }));
}

export function nestingPendingTargets(page: Page): string[] {
  return observers.get(page)?.pending() ?? [];
}
