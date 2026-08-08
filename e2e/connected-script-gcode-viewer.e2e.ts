import type { TestInfo } from '@playwright/test';
import { expect, test } from './fixtures/kerfdesk-test';
import {
  assertResponsivePhase,
  startResponsivenessProbe,
  stopResponsivenessProbe,
  type ResponsivenessMeasurement,
} from './fixtures/browser-responsiveness';
import { installConnectedScriptCanvasProject } from './fixtures/install-connected-script-canvas-project';
import { showGcodeCanvas } from './fixtures/mixed-canvas-project';
import { waitForGcodeCanvasReady } from './fixtures/wait-for-gcode-canvas-ready';

const TEST_TIMEOUT_MS = 120_000;
const POST_READY_OBSERVATION_MS = 750;
const MAX_COMPILE_ELAPSED_MS = 30_000;
const APP_ROUTE = '/';
const CANVAS_LABEL = 'G-code canvas view';
const REFRESH_BUTTON_NAME = 'Refresh';
const PLAYBACK_LABEL = 'Playback';
const RESPONSIVENESS_PHASE = 'connected-script G-code 3D initial open';
const REQUIRED_WORKER_URL_PARTS = [
  'output-preparation-worker',
  'canvas-compilation-worker',
  'gcode-inspector-worker',
] as const;
const COMPILATION_UNAVAILABLE_PATTERN = /Background compilation unavailable/i;
const PREVIEW_WORKER_UNAVAILABLE_PATTERN = /background preview worker could not start/i;

test('real connected-script multi-operation G-code 3D reaches ready off-thread', async ({
  page,
}, testInfo) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const workerUrls: string[] = [];
  const pageErrors: string[] = [];
  page.on('worker', (worker) => workerUrls.push(worker.url()));
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(APP_ROUTE);
  await installConnectedScriptCanvasProject(page);

  await startResponsivenessProbe(page);
  const startedAt = Date.now();
  await showGcodeCanvas(page);
  await waitForGcodeCanvasReady(page);
  const compileElapsedMs = Date.now() - startedAt;
  await page.waitForTimeout(POST_READY_OBSERVATION_MS);
  const responsiveness = await stopResponsivenessProbe(page);
  const hardwareConcurrency = await page.evaluate(() => navigator.hardwareConcurrency);
  await expect(page.getByLabel(CANVAS_LABEL)).toBeVisible();
  await expect(page.getByRole('button', { name: REFRESH_BUTTON_NAME, exact: true })).toBeEnabled();
  await expect(page.getByLabel(PLAYBACK_LABEL, { exact: true })).toBeVisible();

  reportViewerMeasurement({
    testInfo,
    compileElapsedMs,
    hardwareConcurrency,
    responsiveness,
    workerUrls,
  });
  expectRequiredWorkers(workerUrls);
  expect(pageErrors).toEqual([]);
  await expect(page.getByText(COMPILATION_UNAVAILABLE_PATTERN)).toHaveCount(0);
  await expect(page.getByText(PREVIEW_WORKER_UNAVAILABLE_PATTERN)).toHaveCount(0);
});

function reportViewerMeasurement(args: {
  readonly testInfo: TestInfo;
  readonly compileElapsedMs: number;
  readonly hardwareConcurrency: number;
  readonly responsiveness: ResponsivenessMeasurement;
  readonly workerUrls: readonly string[];
}): void {
  args.testInfo.annotations.push({
    type: 'measurement',
    description:
      `real Dancing Script/Pacifico, eight drawings/six operations: ` +
      `compileMs=${args.compileElapsedMs}; workers=${args.workerUrls.length}`,
  });
  console.info(
    `${RESPONSIVENESS_PHASE} responsiveness`,
    JSON.stringify({
      compileElapsedMs: args.compileElapsedMs,
      hardwareConcurrency: args.hardwareConcurrency,
      responsiveness: args.responsiveness,
      workerUrls: args.workerUrls,
    }),
  );
  expect(args.compileElapsedMs).toBeLessThan(MAX_COMPILE_ELAPSED_MS);
  assertResponsivePhase(args.testInfo, RESPONSIVENESS_PHASE, args.responsiveness);
}

function expectRequiredWorkers(workerUrls: readonly string[]): void {
  for (const urlPart of REQUIRED_WORKER_URL_PARTS) {
    expect(workerUrls.some((url) => url.includes(urlPart))).toBe(true);
  }
}
