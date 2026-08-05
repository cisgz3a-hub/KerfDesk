import { expect, test, type Page } from './fixtures/kerfdesk-test';
import {
  assertResponsivePhase,
  startResponsivenessProbe,
  stopResponsivenessProbe,
} from './fixtures/browser-responsiveness';
import { installConnectedScriptCompilationProject } from './fixtures/connected-script-project';
import { showGcodeCanvas } from './fixtures/mixed-canvas-project';

test('real multi-artwork Dancing Script compiles off-thread into responsive G-code 3D', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const workerUrls: string[] = [];
  page.on('worker', (worker) => workerUrls.push(worker.url()));
  await page.goto('/');
  await startResponsivenessProbe(page);
  await installConnectedScriptCompilationProject(page);

  const compilationStartedAt = Date.now();
  await showGcodeCanvas(page);
  await expect(page.getByLabel('G-code canvas view')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled({
    timeout: 90_000,
  });
  await expect(page.getByLabel('Playback', { exact: true })).toBeVisible({ timeout: 90_000 });
  const compileElapsedMs = Date.now() - compilationStartedAt;

  // Include the delayed delivery window that previously distinguished worker
  // completion from actual browser responsiveness.
  await page.waitForTimeout(750);
  const initialOpen = await stopResponsivenessProbe(page);
  testInfo.annotations.push({
    type: 'measurement',
    description: `4-artwork Dancing Script G-code 3D: compileMs=${compileElapsedMs}`,
  });
  assertResponsivePhase(testInfo, 'connected-script G-code 3D initial open', initialOpen);

  await startResponsivenessProbe(page);
  await runMenuCommand(page, 'File', 'Inspect G-code (3D)...');
  const inspector = page.getByRole('dialog', { name: /G-code Inspector: .*current canvas/ });
  await expect(inspector.getByLabel('Program health')).toBeVisible({ timeout: 90_000 });
  await expect(inspector.getByLabel('Playback', { exact: true })).toBeVisible({ timeout: 90_000 });
  await page.waitForTimeout(750);
  const inspectorOpen = await stopResponsivenessProbe(page);
  assertResponsivePhase(testInfo, 'connected-script G-code Inspector open', inspectorOpen);
  await inspector.getByRole('button', { name: 'Close' }).click();

  expect(workerUrls.some((url) => url.includes('output-preparation-worker'))).toBe(true);
  expect(workerUrls.some((url) => url.includes('canvas-compilation-worker'))).toBe(true);
});

async function runMenuCommand(page: Page, family: string, command: string): Promise<void> {
  await page.getByText(family, { exact: true }).click();
  await page.getByRole('menuitem').filter({ hasText: command }).click();
}
