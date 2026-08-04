import { expect, test, type Page } from './fixtures/kerfdesk-test';
import {
  assertResponsivePhase,
  recordResponsivenessPhase,
  startResponsivenessProbe,
  stopResponsivenessProbe,
} from './fixtures/browser-responsiveness';
import { clearCanvasProject, installMixedCanvasProject } from './fixtures/mixed-canvas-project';

const POST_COMPLETION_WINDOW_MS = 750;

test('retired docked CNC pane is absent by default and its controlled A/B mount records isolated cost', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const workerUrls: string[] = [];
  page.on('worker', (worker) => workerUrls.push(worker.url()));
  await page.goto('/');
  await clearCanvasProject(page);
  await expect(page.getByTestId('canvas-motion-probe')).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: '3D result pane' })).toHaveCount(0);

  const idleWorkerStarted = page.waitForEvent('worker', {
    predicate: (worker) => worker.url().includes('idle-canvas-motion-worker'),
    timeout: 10_000,
  });
  await startResponsivenessProbe(page);
  await installMixedCanvasProject(page);
  await idleWorkerStarted;
  await expect(page.getByTestId('canvas-motion-probe')).toHaveCount(1, { timeout: 60_000 });
  await page.waitForTimeout(POST_COMPLETION_WINDOW_MS);
  const hidden = await stopResponsivenessProbe(page);
  assertResponsivePhase(testInfo, 'complex V-carve with persistent 3D pane hidden', hidden);
  expect(workerUrls.some((url) => url.includes('design-scene-worker'))).toBe(false);

  const designWorkerStarted = page.waitForEvent('worker', {
    predicate: (worker) => worker.url().includes('design-scene-worker'),
    timeout: 10_000,
  });
  await startResponsivenessProbe(page);
  await mountRetiredPaneForTest(page);
  await designWorkerStarted;
  const pane = page.getByRole('complementary', { name: '3D result pane' });
  await expect(pane).toBeVisible();
  const retiredCanvas = pane.getByLabel('Live 3D cut result');
  await expect(retiredCanvas).toBeVisible({ timeout: 60_000 });
  await expect(retiredCanvas).toHaveAttribute('data-scene-state', 'ready', { timeout: 60_000 });
  await page.waitForTimeout(POST_COMPLETION_WINDOW_MS);
  const mounted = await stopResponsivenessProbe(page);
  recordResponsivenessPhase(
    testInfo,
    'complex V-carve with retired docked 3D pane mounted',
    mounted,
  );

  expect(workerUrls.some((url) => url.includes('design-scene-worker'))).toBe(true);
  expect(workerUrls.some((url) => url.includes('canvas-compilation-worker'))).toBe(true);
  await unmountRetiredPaneForTest(page);
  await expect(pane).toHaveCount(0);
});

test('mixed-operation Preview and Cut 3D complete without a delayed UI stall', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const workerUrls: string[] = [];
  page.on('worker', (worker) => workerUrls.push(worker.url()));
  await page.goto('/');
  await clearCanvasProject(page);
  await installMixedCanvasProject(page);

  const previewButton = page.getByRole('button', { name: 'Preview', exact: true });
  await expect(previewButton).toBeEnabled();
  await startResponsivenessProbe(page);
  await previewButton.click();
  await expect(
    page.getByRole('group', { name: 'Preview route controls and statistics' }),
  ).toBeVisible({ timeout: 60_000 });
  const openCut3D = page.getByRole('button', { name: 'Open 3D cut preview' });
  await expect(openCut3D).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(POST_COMPLETION_WINDOW_MS);
  const preview = await stopResponsivenessProbe(page);
  assertResponsivePhase(testInfo, 'mixed-operation Preview preparation', preview);

  await startResponsivenessProbe(page);
  await openCut3D.click();
  const cut3D = page.getByRole('dialog', { name: 'Cut 3D preview' });
  await expect(cut3D).toBeVisible();
  await expect(cut3D.getByLabel('Cut 3D preview surface')).toBeVisible();
  await expect(
    cut3D.getByText('Drag to orbit, scroll to zoom. Depth is true to scale.'),
  ).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(POST_COMPLETION_WINDOW_MS);
  const cut3DOpen = await stopResponsivenessProbe(page);
  assertResponsivePhase(testInfo, 'Cut 3D initial open', cut3DOpen);

  expect(workerUrls.some((url) => url.includes('/workspace/preparation-worker'))).toBe(true);
  expect(workerUrls.some((url) => url.includes('cnc-removal-grid-worker'))).toBe(true);
  expect(workerUrls.some((url) => url.includes('canvas-compilation-worker'))).toBe(true);
  await cut3D.getByRole('button', { name: 'Close' }).click();
});

async function mountRetiredPaneForTest(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const harnessPath = '/e2e/fixtures/cnc-3d-pane-harness.tsx';
    const loaded: unknown = await import(/* @vite-ignore */ harnessPath);
    const harness = loaded as { readonly mountCnc3DPaneHarness: () => void };
    harness.mountCnc3DPaneHarness();
  });
}

async function unmountRetiredPaneForTest(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const harnessPath = '/e2e/fixtures/cnc-3d-pane-harness.tsx';
    const loaded: unknown = await import(/* @vite-ignore */ harnessPath);
    const harness = loaded as { readonly unmountCnc3DPaneHarness: () => void };
    harness.unmountCnc3DPaneHarness();
  });
}
