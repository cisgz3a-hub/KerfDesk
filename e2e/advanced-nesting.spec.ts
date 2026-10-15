import { writeFile } from 'node:fs/promises';
import { expect, test } from './fixtures/kerfdesk-test';
import {
  disposeNestingLifetime,
  expectNestingStopped,
  observeNestingLifetime,
  nestingRuntimeSnapshot,
  nestingPendingTargets,
} from './fixtures/nesting-worker-lifecycle';

test.afterEach(async ({ page, browser }, testInfo) => {
  const evidence = testInfo.outputPath('worker-runtime-evidence.json');
  await writeFile(
    evidence,
    JSON.stringify({ chrome: browser.version(), workers: nestingRuntimeSnapshot(page) }, null, 2),
  );
  await testInfo.attach('worker-runtime-evidence', {
    path: evidence,
    contentType: 'application/json',
  });
  await disposeNestingLifetime(page);
});
import type { ProductionNestingInput } from '../src/core/nesting/production-nest';
import type { startProductionNestingSearch } from '../src/ui/commands/production-nesting-worker-client';
import type { validateProductionNest } from '../src/core/nesting/production-nest-validation';

function input(stockCount: number): ProductionNestingInput {
  return {
    definition: {
      id: 'forty-ls',
      name: 'Forty L parts',
      padding: 2,
      goal: 'compact',
      method: 'outline',
      optimise: false,
      parts: [
        {
          id: 'L',
          name: 'L',
          objectIds: ['L'],
          quantity: 40,
          materialKey: 'wood',
          thicknessMm: 3,
          grain: 'none',
          rotationAngles: [0, 90, 180, 270],
        },
      ],
      sheets: Array.from({ length: stockCount }, (_, i) => ({
        id: 'sheet-' + i,
        name: 'Sheet ' + i,
        stockId: 'stock-' + i,
        kind: 'sheet',
        materialKey: 'wood',
        thicknessMm: 3,
        grain: 'none',
        widthMm: 160,
        heightMm: 100,
      })),
    },
    geometry: [
      {
        partId: 'L',
        vectorLengthMm: 120,
        item: {
          id: 'L',
          width: 30,
          height: 30,
          canRotate: true,
          outline: [
            [
              { x: 0, y: 0 },
              { x: 30, y: 0 },
              { x: 30, y: 8 },
              { x: 8, y: 8 },
              { x: 8, y: 30 },
              { x: 0, y: 30 },
            ],
          ],
        },
      },
    ],
  };
}

test('advanced local nesting improves forty concave parts and preserves declared stock identities', async ({
  page,
}) => {
  // Static same-origin harness also keeps development HMR from interrupting the workers.
  await observeNestingLifetime(page);
  await page.goto('/packing-solver-worker.js');
  const result = await page.evaluate(
    async ({ four, two }) => {
      const clientUrl = '/src/ui/commands/production-nesting-worker-client.ts';
      const proofUrl = '/src/core/nesting/production-nest-validation.ts';
      const { startProductionNestingSearch: search } = (await import(clientUrl)) as {
        startProductionNestingSearch: typeof startProductionNestingSearch;
      };
      const { validateProductionNest: validate } = (await import(proofUrl)) as {
        validateProductionNest: typeof validateProductionNest;
      };
      const progress: number[] = [];
      const improved = await search(four, (p) => progress.push(p.best?.sheets.length ?? 0), true)
        .result;
      const limited = await search(two, () => undefined, true).result;
      return {
        isolated: crossOriginIsolated,
        progress,
        improved: improved.best && {
          produced: improved.best.produced,
          sheets: improved.best.sheets.length,
          valid: validate(four, improved.best),
        },
        limited: limited.best && {
          produced: limited.best.produced,
          ids: limited.best.sheets.map((s) => s.sheetId),
          valid: validate(two, limited.best),
        },
      };
    },
    { four: input(4), two: input(2) },
  );
  expect(result.isolated).toBe(true);
  expect(result.progress[0]).toBe(4);
  expect(result.improved).toEqual({ produced: 40, sheets: 2, valid: true });
  expect(result.limited?.produced).toBe(40);
  expect(result.limited?.valid).toBe(true);
  expect(result.limited?.ids.sort()).toEqual(['sheet-0', 'sheet-1']);
  await expectNestingStopped(page, true);
});

test('cancelling advanced nesting retains its standard draft and terminates owned workers', async ({
  page,
}) => {
  await observeNestingLifetime(page);
  await page.goto('/packing-solver-worker.js');
  const result = await page.evaluate(async (data) => {
    const clientUrl = '/src/ui/commands/production-nesting-worker-client.ts';
    const { startProductionNestingSearch: search } = (await import(clientUrl)) as {
      startProductionNestingSearch: typeof startProductionNestingSearch;
    };
    const active = search(data, () => undefined, true);
    // Cancel an actually started solver pool, not merely the standard draft.
    try {
      const deadline = performance.now() + 10_000;
      while (Atomics.load(window.__nestingLifetime.counts, 0) < 2) {
        if (performance.now() > deadline) throw new Error('Solver pthread pool did not start');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    } finally {
      active.cancel();
    }
    const result = await active.result;
    return { cancelled: result.cancelled, produced: result.best?.produced };
  }, input(4));
  expect(result).toEqual({ cancelled: true, produced: 40 });
  await expectNestingStopped(page, false);
});

test('nesting lifetime proof rejects a still-running worker after reported termination', async ({
  page,
}) => {
  await observeNestingLifetime(page);
  await page.goto('/packing-solver-worker.js');
  await page.evaluate(() => {
    const source = `onmessage = event => {
      const counts = new Int32Array(event.data);
      setInterval(() => Atomics.add(counts, 1, 1), 20);
    };`;
    const worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
    worker.postMessage(window.__nestingLifetime.counts.buffer);
    // Simulate a mistaken ownership record: the liveness proof must still fail.
    const record = window.__nestingLifetime.roots[0];
    if (record === undefined) throw new Error('Missing worker ownership record');
    record.terminated = true;
  });
  await expect
    .poll(() => page.evaluate(() => Atomics.load(window.__nestingLifetime.counts, 1)))
    .toBeGreaterThan(1);
  await expect(expectNestingStopped(page, false)).rejects.toThrow();
});

test('nesting lifetime proof rejects a live blocked child despite silent heartbeats', async ({
  page,
}) => {
  await observeNestingLifetime(page);
  await page.goto('/packing-solver-worker.js');
  await page.evaluate(() => {
    const child = `onmessage = event => {
      const counts = new Int32Array(event.data);
      Atomics.store(counts, 1, 2);
      Atomics.store(counts, 2, 1);
      Atomics.wait(counts, 3, 0);
    };`;
    const root = `onmessage = event => {
      const child = new Worker(URL.createObjectURL(new Blob([${JSON.stringify(child)}], { type: 'text/javascript' })));
      child.postMessage(event.data);
    };`;
    const worker = new Worker(URL.createObjectURL(new Blob([root], { type: 'text/javascript' })));
    window.__nestingBlockedWorker = worker;
    worker.postMessage(window.__nestingLifetime.counts.buffer);
    const record = window.__nestingLifetime.roots[0];
    if (!record) throw new Error('Missing root owner');
    record.terminated = true;
  });
  await page.waitForFunction(() => Atomics.load(window.__nestingLifetime.counts, 2) === 1);
  // Chromium may report an empty URL for a live blob root. Identify this
  // isolated context's root by ownership instead of debugger display metadata.
  await expect
    .poll(() => {
      const workers = nestingRuntimeSnapshot(page);
      const root = workers.find(
        (worker) => !workers.some((parent) => parent.target === worker.parent),
      );
      return workers.filter((worker) => worker.parent === root?.target && worker.sawContext).length;
    })
    .toBe(1);
  const runtimes = nestingRuntimeSnapshot(page);
  const roots = runtimes.filter(
    (worker) => !runtimes.some((parent) => parent.target === worker.parent),
  );
  expect(roots).toHaveLength(1);
  const root = roots[0];
  const child = runtimes.find((worker) => worker.parent === root?.target);
  expect(child?.destroyed).toBe(false);
  expect(
    nestingPendingTargets(page).some((target) =>
      target.startsWith(child?.target ?? 'missing-child'),
    ),
  ).toBe(true);
  try {
    await expect(expectNestingStopped(page, false)).rejects.toThrow();
  } finally {
    await page.evaluate(() => {
      window.__nestingBlockedWorker?.terminate();
      Atomics.notify(window.__nestingLifetime.counts, 3);
    });
  }
  await expectNestingStopped(page, false);
});
