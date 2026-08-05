import { expect, test, type Page } from './fixtures/kerfdesk-test';
import {
  assertResponsivePhase,
  startResponsivenessProbe,
  stopResponsivenessProbe,
} from './fixtures/browser-responsiveness';
import { installConnectedScriptCompilationProject } from './fixtures/connected-script-project';
import { showGcodeCanvas } from './fixtures/mixed-canvas-project';

const POST_COMPLETION_WINDOW_MS = 750;
const IDLE_WORKER_START_TIMEOUT_MS = 10_000;
const READINESS_TIMEOUT_MS = 90_000;
const TEST_TIMEOUT_MS = 180_000;

test('real multi-artwork Dancing Script compiles off-thread into responsive G-code 3D', async ({
  page,
}, testInfo) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const workerUrls: string[] = [];
  page.on('worker', (worker) => workerUrls.push(worker.url()));
  await page.goto('/');

  // Wait for the background canvas planner to own the installed project before
  // G-code takes ownership and cancels it. This keeps the measured transition
  // deterministic and matches the established heavy-canvas coverage.
  const idleWorkerStarted = page.waitForEvent('worker', {
    predicate: (worker) => worker.url().includes('idle-canvas-motion-worker'),
    timeout: IDLE_WORKER_START_TIMEOUT_MS,
  });
  await installConnectedScriptCompilationProject(page);
  await idleWorkerStarted;

  // Font parsing and fixture construction are setup, not G-code compilation.
  await startResponsivenessProbe(page);
  const compilationStartedAt = Date.now();
  await showGcodeCanvas(page);
  await expect(page.getByLabel('G-code canvas view')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled({
    timeout: READINESS_TIMEOUT_MS,
  });
  await expect(page.getByLabel('Playback', { exact: true })).toBeVisible({
    timeout: READINESS_TIMEOUT_MS,
  });
  const compileElapsedMs = Date.now() - compilationStartedAt;

  // Include the delayed delivery window that previously distinguished worker
  // completion from actual browser responsiveness.
  await page.waitForTimeout(POST_COMPLETION_WINDOW_MS);
  const initialOpen = await stopResponsivenessProbe(page);
  testInfo.annotations.push({
    type: 'measurement',
    description: `4-artwork Dancing Script G-code 3D: compileMs=${compileElapsedMs}`,
  });
  const hardwareConcurrency = await page.evaluate(() => navigator.hardwareConcurrency);
  console.info(
    'connected-script G-code 3D responsiveness',
    JSON.stringify({ compileElapsedMs, hardwareConcurrency, initialOpen, workerUrls }),
  );
  assertResponsivePhase(testInfo, 'connected-script G-code 3D initial open', initialOpen);

  await startResponsivenessProbe(page);
  await runMenuCommand(page, 'File', 'Inspect G-code (3D)...');
  const inspector = page.getByRole('dialog', { name: /G-code Inspector: .*current canvas/ });
  await expect(inspector.getByLabel('Program health')).toBeVisible({
    timeout: READINESS_TIMEOUT_MS,
  });
  await expect(inspector.getByLabel('Playback', { exact: true })).toBeVisible({
    timeout: READINESS_TIMEOUT_MS,
  });
  await page.waitForTimeout(POST_COMPLETION_WINDOW_MS);
  const inspectorOpen = await stopResponsivenessProbe(page);
  console.info(
    'connected-script G-code Inspector responsiveness',
    JSON.stringify({ inspectorOpen }),
  );
  assertResponsivePhase(testInfo, 'connected-script G-code Inspector open', inspectorOpen);
  await inspector.getByRole('button', { name: 'Close' }).click();

  expect(workerUrls.some((url) => url.includes('output-preparation-worker'))).toBe(true);
  expect(workerUrls.some((url) => url.includes('canvas-compilation-worker'))).toBe(true);
});

async function runMenuCommand(page: Page, family: string, command: string): Promise<void> {
  await page.getByText(family, { exact: true }).click();
  await page.getByRole('menuitem').filter({ hasText: command }).click();
}
