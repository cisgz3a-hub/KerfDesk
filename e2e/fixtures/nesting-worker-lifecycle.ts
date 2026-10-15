import { expect, type Page } from '@playwright/test';

// Chromium can retain an attached, terminated solver target in Target.getTargets.
// Measure worker execution instead: one shared heartbeat slot per real solver or
// pthread, plus explicit ownership of the two page-created workers.
// Playwright does not route nested worker requests, so the child bootstrap adds
// the probe to the same host source; its vendor URL stays absolute and unchanged.
const probe = `
(function installProbe(source) {
  let counts;
  self.addEventListener('message', event => {
    if (event.data?.kind !== 'nesting-lifetime-probe') return;
    event.stopImmediatePropagation();
    if (counts) return;
    counts = new Int32Array(event.data.buffer);
    const slot = Atomics.add(counts, 0, 1) + 1;
    Atomics.add(counts, slot, 1);
    setInterval(() => Atomics.add(counts, slot, 1), 20);
  });
  const NativeWorker = self.Worker;
  self.Worker = class extends NativeWorker {
    constructor(...args) {
      const body = '(' + installProbe.toString() + ')(' + JSON.stringify(source) + ');' + source;
      const bootstrap = URL.createObjectURL(new Blob([body], { type: 'text/javascript' }));
      super(bootstrap, args[1]);
      if (counts) this.postMessage({ kind: 'nesting-lifetime-probe', buffer: counts.buffer });
    }
  };
})
`;

interface LifetimeState {
  counts: Int32Array;
  roots: { terminated: boolean; url: string }[];
}

declare global {
  interface Window {
    __nestingLifetime: LifetimeState;
  }
}

export async function observeNestingLifetime(page: Page): Promise<void> {
  await page.context().route('**/packing-solver-worker.js', async (route) => {
    const response = await route.fetch();
    const source = (await response.text()).replaceAll(
      'self.location.href',
      JSON.stringify(route.request().url()),
    );
    await route.fulfill({ response, body: probe + '(' + JSON.stringify(source) + ');' + source });
  });
  await page.addInitScript(() => {
    const state: LifetimeState = { counts: new Int32Array(new SharedArrayBuffer(4096)), roots: [] };
    window.__nestingLifetime = state;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      private readonly record: { terminated: boolean; url: string };
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.record = { terminated: false, url: String(url) };
        state.roots.push(this.record);
        if (String(url).includes('packing-solver-worker.js')) {
          this.postMessage({ kind: 'nesting-lifetime-probe', buffer: state.counts.buffer });
        }
      }
      override terminate(): void {
        this.record.terminated = true;
        super.terminate();
      }
    };
  });
}

export async function expectNestingStopped(page: Page, completed: boolean): Promise<void> {
  const snapshot = () =>
    page.evaluate(() => ({
      roots: window.__nestingLifetime.roots,
      counts: Array.from(window.__nestingLifetime.counts),
    }));
  const before = await snapshot();
  expect(before.roots.length).toBeGreaterThanOrEqual(completed ? 4 : 1);
  expect(before.roots.every((worker) => worker.terminated)).toBe(true);
  if (completed) {
    // Both real sessions booted their solver and pthread pools, so unchanged
    // counters cannot pass merely because no execution was observed.
    expect(before.counts[0]).toBeGreaterThan(2);
    expect(before.counts.slice(1).some((count) => count > 1)).toBe(true);
  }
  await page.waitForTimeout(500);
  expect(await snapshot()).toEqual(before);
}
