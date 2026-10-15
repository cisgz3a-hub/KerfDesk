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
  roots: { terminated: boolean; url: string }[];
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
  contexts: Set<number>;
  sawContext: boolean;
  enabled: boolean;
  destroyed: boolean;
  error?: string;
}

class RuntimeObserver {
  readonly workers = new Map<string, WorkerRuntime>();
  private readonly sessions = new Map<string, WorkerRuntime>();
  private readonly requests = new Map<number, WorkerRuntime>();
  private nextRequest = 0;

  constructor(
    private readonly cdp: CDPSession,
    contextId: string,
  ) {
    cdp.on('Target.targetCreated', ({ targetInfo }) => {
      if (targetInfo.type !== 'worker' || targetInfo.browserContextId !== contextId) return;
      const worker: WorkerRuntime = {
        target: targetInfo.targetId,
        url: targetInfo.url,
        parent: (targetInfo as { parentId?: string }).parentId,
        contexts: new Set(),
        sawContext: false,
        enabled: false,
        destroyed: false,
      };
      this.workers.set(worker.target, worker);
      void this.attach(worker);
    });
    cdp.on('Target.targetInfoChanged', ({ targetInfo }) => {
      const worker = this.workers.get(targetInfo.targetId);
      if (worker) worker.url = targetInfo.url;
    });
    cdp.on('Target.targetDestroyed', ({ targetId }) => {
      const worker = this.workers.get(targetId);
      if (worker) worker.destroyed = true;
    });
    cdp.on('Target.receivedMessageFromTarget', ({ sessionId, message }) => {
      const worker = this.sessions.get(sessionId);
      if (!worker) return;
      const event = JSON.parse(message) as {
        id?: number;
        error?: { message: string };
        method?: string;
        params?: { context?: { id: number }; executionContextId?: number };
      };
      if (event.id !== undefined && this.requests.delete(event.id)) {
        worker.enabled = event.error === undefined;
        if (event.error) worker.error = event.error.message;
      }
      if (event.method === 'Runtime.executionContextCreated' && event.params?.context) {
        worker.sawContext = true;
        worker.contexts.add(event.params.context.id);
      } else if (event.method === 'Runtime.executionContextDestroyed') {
        worker.contexts.delete(event.params?.executionContextId ?? -1);
      } else if (event.method === 'Runtime.executionContextsCleared') worker.contexts.clear();
    });
    // Detachment alone is not destruction: a parent can detach while its child
    // is still blocked. These sessions attach from the browser, not the parent.
  }

  private async attach(worker: WorkerRuntime): Promise<void> {
    try {
      const { sessionId } = await this.cdp.send('Target.attachToTarget', {
        targetId: worker.target,
        flatten: false,
      });
      this.sessions.set(sessionId, worker);
      const id = ++this.nextRequest;
      this.requests.set(id, worker);
      await this.cdp.send('Target.sendMessageToTarget', {
        sessionId,
        message: JSON.stringify({ id, method: 'Runtime.enable' }),
      });
    } catch (error) {
      worker.error = String(error);
    }
  }

  pending(): string[] {
    return [...this.workers.values()]
      .filter(
        (worker) =>
          !worker.destroyed && !(worker.enabled && worker.sawContext && worker.contexts.size === 0),
      )
      .map(
        (worker) => `${worker.target} (${worker.url}): ${worker.error ?? 'runtime not destroyed'}`,
      );
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
      private readonly record: { terminated: boolean; url: string };
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
  // Positive runtime destruction or target destruction is required. No heartbeat,
  // protocol timeout, or detached parent session can stand in for that evidence.
  await expect.poll(() => observer.pending(), { timeout: 2_000 }).toEqual([]);
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
    contexts: [...worker.contexts],
  }));
}

export function nestingPendingTargets(page: Page): string[] {
  return observers.get(page)?.pending() ?? [];
}
