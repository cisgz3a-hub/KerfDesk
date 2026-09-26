import { toolbarCommand } from './fixtures/workspace-ui';
import { expect, test } from './fixtures/kerfdesk-test';
import { openReadyCut3D } from './fixtures/cut3d-offscreen-browser';
import { clearCanvasProject, installMixedCanvasProject } from './fixtures/mixed-canvas-project';

// ADR-425: a recomputed cut swaps into the open Cut 3D in place. Before, each
// new grid unmounted the dialog, so playback reset the camera every step.
test('Cut 3D keeps its canvas and worker while playback recomputes the cut', async ({ page }) => {
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

  await page.getByRole('button', { name: 'Play route preview' }).click();
  const cut3D = await openReadyCut3D(page);
  const canvas = await cut3D.canvas.elementHandle();
  await expect
    .poll(async () => Number((await cut3D.canvas.getAttribute('data-surface-revision')) ?? 0), {
      timeout: 90_000,
    })
    .toBeGreaterThan(0);

  expect(await canvas?.evaluate((element) => element.isConnected)).toBe(true);
  await expect(cut3D.canvas).toHaveAttribute('data-scene-state', 'ready');
  expect(cut3DWorkers).toHaveLength(1);
});
