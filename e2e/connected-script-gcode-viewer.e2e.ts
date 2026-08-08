import { expect, test } from './fixtures/kerfdesk-test';
import {
  assertResponsivePhase,
  startResponsivenessProbe,
  stopResponsivenessProbe,
} from './fixtures/browser-responsiveness';
import { installConnectedScriptCanvasProject } from './fixtures/connected-script-canvas-project';
import { showGcodeCanvas, waitForGcodeCanvasReady } from './fixtures/mixed-canvas-project';

test('real connected-script multi-operation G-code 3D reaches ready off-thread', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const workerUrls: string[] = [];
  const pageErrors: string[] = [];
  page.on('worker', (worker) => workerUrls.push(worker.url()));
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');
  await installConnectedScriptCanvasProject(page);

  await startResponsivenessProbe(page);
  const startedAt = Date.now();
  await showGcodeCanvas(page);
  await waitForGcodeCanvasReady(page);
  const compileElapsedMs = Date.now() - startedAt;
  await page.waitForTimeout(750);
  const responsiveness = await stopResponsivenessProbe(page);
  const hardwareConcurrency = await page.evaluate(() => navigator.hardwareConcurrency);
  await expect(page.getByLabel('G-code canvas view')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Playback', { exact: true })).toBeVisible();

  testInfo.annotations.push({
    type: 'measurement',
    description:
      `real Dancing Script/Pacifico, eight drawings/six operations: ` +
      `compileMs=${compileElapsedMs}; workers=${workerUrls.length}`,
  });
  console.info(
    'connected-script G-code 3D initial open responsiveness',
    JSON.stringify({ compileElapsedMs, hardwareConcurrency, responsiveness, workerUrls }),
  );
  expect(compileElapsedMs).toBeLessThan(30_000);
  assertResponsivePhase(testInfo, 'connected-script G-code 3D initial open', responsiveness);
  expect(workerUrls.some((url) => url.includes('output-preparation-worker'))).toBe(true);
  expect(workerUrls.some((url) => url.includes('canvas-compilation-worker'))).toBe(true);
  expect(workerUrls.some((url) => url.includes('gcode-inspector-worker'))).toBe(true);
  expect(pageErrors).toEqual([]);
  await expect(page.getByText(/Background compilation unavailable/i)).toHaveCount(0);
  await expect(page.getByText(/background preview worker could not start/i)).toHaveCount(0);
});
