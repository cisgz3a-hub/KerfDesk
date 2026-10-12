import { expect, test } from './fixtures/kerfdesk-test';
import type { Browser } from '@playwright/test';
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
  browser,
}) => {
  // Static same-origin harness also keeps development HMR from interrupting the workers.
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
  await expectNoNestingWorkers(browser);
});

test('cancelling advanced nesting retains its standard draft and terminates owned workers', async ({
  page,
  browser,
}) => {
  await page.goto('/packing-solver-worker.js');
  const result = await page.evaluate(async (data) => {
    const clientUrl = '/src/ui/commands/production-nesting-worker-client.ts';
    const { startProductionNestingSearch: search } = (await import(clientUrl)) as {
      startProductionNestingSearch: typeof startProductionNestingSearch;
    };
    const active = search(data, () => setTimeout(() => active.cancel(), 0), true);
    const result = await active.result;
    return { cancelled: result.cancelled, produced: result.best?.produced };
  }, input(4));
  expect(result).toEqual({ cancelled: true, produced: 40 });
  await expectNoNestingWorkers(browser);
});

async function expectNoNestingWorkers(browser: Browser): Promise<void> {
  const session = await browser.newBrowserCDPSession();
  try {
    // This static harness has no unrelated workers. Check every live dedicated
    // worker, including pthread descendants with blob or empty URLs.
    // Playwright's nested-worker records depend on events through their parent
    // sessions, which are detached when the owning engine is terminated.
    await expect
      .poll(async () => {
        const { targetInfos } = await session.send('Target.getTargets');
        return targetInfos
          .filter(({ type }) => type === 'worker')
          .map(({ targetId, url }) => ({ targetId, url }));
      })
      .toEqual([]);
  } finally {
    await session.detach();
  }
}
