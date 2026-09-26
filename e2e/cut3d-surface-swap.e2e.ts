import { toolbarCommand } from './fixtures/workspace-ui';
import { expect, test } from './fixtures/kerfdesk-test';
import { openReadyCut3D } from './fixtures/cut3d-offscreen-browser';
import { clearCanvasProject, installMixedCanvasProject } from './fixtures/mixed-canvas-project';

// ADR-425: a recomputed cut swaps into the open Cut 3D in place. Establish the
// renderer first: continuous playback may finish before initial preparation
// settles on a busy runner, leaving no later surface to swap.
test('Cut 3D keeps its canvas and worker when scrubbing recomputes the cut', async ({ page }) => {
  test.setTimeout(180_000);
  const cut3DWorkers: string[] = [];
  page.on('worker', (worker) => {
    if (worker.url().includes('cut3d-offscreen-worker')) cut3DWorkers.push(worker.url());
  });
  await page.goto('/');
  await clearCanvasProject(page);
  await installMixedCanvasProject(page);
  await (await toolbarCommand(page, 'Preview')).click();
  const open3D = page.getByRole('button', { name: 'Open 3D cut preview' });
  await expect(open3D).toBeVisible({ timeout: 60_000 });

  const cut3D = await openReadyCut3D(page);
  const canvas = await cut3D.canvas.elementHandle();
  for (const fraction of [0.25, 0.75]) {
    const previous = Number((await cut3D.canvas.getAttribute('data-surface-revision')) ?? 0);
    // The modal keeps workspace controls inert. Change the same preview store
    // the scrubber writes, retaining the real grid, mesh and render workers.
    await page.evaluate(async (scrubberT) => {
      const modulePath = '/src/ui/state/ui-store.ts';
      const loaded = (await import(/* @vite-ignore */ modulePath)) as {
        useUiStore: { getState: () => { setScrubberT: (value: number) => void } };
      };
      loaded.useUiStore.getState().setScrubberT(scrubberT);
    }, fraction);
    await expect
      .poll(async () => Number((await cut3D.canvas.getAttribute('data-surface-revision')) ?? 0), {
        timeout: 90_000,
      })
      .toBeGreaterThan(previous);
    expect(await canvas?.evaluate((element) => element.isConnected)).toBe(true);
  }

  expect(await canvas?.evaluate((element) => element.isConnected)).toBe(true);
  await expect(cut3D.canvas).toHaveAttribute('data-scene-state', 'ready');
  expect(cut3DWorkers).toHaveLength(1);
});
