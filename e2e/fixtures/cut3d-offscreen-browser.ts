import { expect, type Locator, type Page, type TestInfo, type Worker } from '@playwright/test';
import {
  assertResponsivePhase,
  startResponsivenessProbe,
  stopResponsivenessProbe,
} from './browser-responsiveness';

export interface OpenCut3D {
  readonly dialog: Locator;
  readonly canvas: Locator;
  readonly worker: Worker;
}

const POST_INTERACTION_WINDOW_MS = 750;
const WORKER_TIMEOUT_MS = 60_000;
const RESIZED_VIEWPORT_WIDTH_PX = 640;
const RESIZED_VIEWPORT_HEIGHT_PX = 700;

export async function openReadyCut3D(page: Page): Promise<OpenCut3D> {
  const started = waitForCut3DWorker(page);
  await page.getByRole('button', { name: 'Open 3D cut preview' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cut 3D preview' });
  const canvas = dialog.getByLabel('Cut 3D preview surface');
  await expect(dialog).toBeVisible();
  await expect(canvas).toBeVisible();
  const worker = await started;
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
  await expect(canvas).toHaveAttribute('tabindex', '0');
  await expect(canvas).toHaveAttribute('data-scene-state', 'ready', {
    timeout: WORKER_TIMEOUT_MS,
  });
  await expect(
    dialog.getByText(/Left-drag to pan, right-drag to orbit.+Shift\+Arrow keys to orbit/u),
  ).toBeVisible();
  return { dialog, canvas, worker };
}

export async function exerciseCut3DKeyboardControls(opened: OpenCut3D): Promise<void> {
  await opened.dialog.getByRole('button', { name: 'Close' }).press('Tab');
  await expect(opened.canvas).toBeFocused();
  for (const key of ['ArrowLeft', 'Shift+ArrowRight', 'Shift+Equal', 'Minus']) {
    const previousRevision = await frameRevision(opened.canvas);
    await opened.canvas.press(key);
    await expect.poll(() => frameRevision(opened.canvas)).toBeGreaterThan(previousRevision);
  }
}

export async function exerciseCut3DControlsAndResize(
  page: Page,
  opened: OpenCut3D,
  testInfo: TestInfo,
): Promise<void> {
  const firstRevision = await frameRevision(opened.canvas);
  const box = await opened.canvas.boundingBox();
  if (box === null) throw new Error('Cut 3D canvas has no browser bounds.');
  await startResponsivenessProbe(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(box.x + box.width / 2 + 45, box.y + box.height / 2 + 20, {
    steps: 6,
  });
  await page.mouse.up({ button: 'right' });
  await page.mouse.wheel(0, -120);
  const originalViewport = page.viewportSize();
  await page.setViewportSize({
    width: RESIZED_VIEWPORT_WIDTH_PX,
    height: RESIZED_VIEWPORT_HEIGHT_PX,
  });
  await expect.poll(() => frameRevision(opened.canvas)).toBeGreaterThan(firstRevision);
  if (originalViewport !== null) await page.setViewportSize(originalViewport);
  await page.waitForTimeout(POST_INTERACTION_WINDOW_MS);
  const measurement = await stopResponsivenessProbe(page);
  assertResponsivePhase(testInfo, 'Cut 3D controls and resize', measurement);
}

export async function injectCut3DLateError(opened: OpenCut3D): Promise<void> {
  await opened.worker.evaluate(() => {
    // Worker evaluation has no WebWorker lib in the E2E tsconfig; this is the
    // exact one-way postMessage surface the real worker uses.
    const scope = globalThis as unknown as { postMessage: (message: unknown) => void };
    scope.postMessage({ kind: 'error', sessionId: 1, message: 'Injected render-worker failure.' });
  });
  await expect(opened.dialog.getByRole('alert')).toContainText(
    '3D view unavailable: Injected render-worker failure.',
  );
  await expect(opened.canvas).toHaveAttribute('data-scene-state', 'unavailable');
}

export async function cancelThenRemountCut3D(
  page: Page,
  previousCanvas: Locator,
): Promise<OpenCut3D> {
  const previousHandle = await previousCanvas.elementHandle();
  if (previousHandle === null) throw new Error('Previous Cut 3D canvas handle is missing.');
  const previousDialog = page.getByRole('dialog', { name: 'Cut 3D preview' });
  await previousCanvas.focus();
  await previousCanvas.press('Escape');
  await expect(previousDialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open 3D cut preview' })).toBeFocused();
  const started = waitForCut3DWorker(page);
  await page.getByRole('button', { name: 'Open 3D cut preview' }).click();
  const cancellingDialog = page.getByRole('dialog', { name: 'Cut 3D preview' });
  await started;
  await cancellingDialog.getByRole('button', { name: 'Close' }).click();
  await expect(cancellingDialog).toHaveCount(0);

  const remounted = await openReadyCut3D(page);
  const isFreshCanvas = await remounted.canvas.evaluate(
    (current, previous) => current !== previous,
    previousHandle,
  );
  expect(isFreshCanvas).toBe(true);
  return remounted;
}

export async function assertUnsupportedCut3D(page: Page, workerUrls: string[]): Promise<void> {
  await page
    .getByRole('dialog', { name: 'Cut 3D preview' })
    .getByRole('button', { name: 'Close' })
    .click();
  const workerCount = cut3DWorkerCount(workerUrls);
  await page.evaluate(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', {
      configurable: true,
      value: undefined,
    });
  });
  await page.getByRole('button', { name: 'Open 3D cut preview' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cut 3D preview' });
  await expect(dialog.getByRole('alert')).toContainText(
    '3D view unavailable: Background 3D rendering is unavailable in this browser.',
    { timeout: WORKER_TIMEOUT_MS },
  );
  expect(cut3DWorkerCount(workerUrls)).toBe(workerCount);
}

export async function assertNoMainRealmThreeImport(page: Page): Promise<void> {
  const imports = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => /(?:\/deps\/three|\/three(?:\.module)?\.js)/u.test(name)),
  );
  expect(imports, 'main-realm Three.js resource entries').toEqual([]);
}

function waitForCut3DWorker(page: Page): Promise<Worker> {
  return page.waitForEvent('worker', {
    predicate: (worker) => worker.url().includes('cut3d-offscreen-worker'),
    timeout: WORKER_TIMEOUT_MS,
  });
}

async function frameRevision(canvas: Locator): Promise<number> {
  return Number((await canvas.getAttribute('data-frame-revision')) ?? '0');
}

function cut3DWorkerCount(workerUrls: string[]): number {
  return workerUrls.filter((url) => url.includes('cut3d-offscreen-worker')).length;
}
