import { _electron as electron, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildArtcraftPreview, ARTCRAFT_PREVIEW_ROOT } from './build-artcraft-preview.mjs';

// Source-development renderer smoke. Launches its own vector session, no provider or machine I/O.
// Run --build-development to build the separate, nonrelease desktop development harness.
const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.resolve(
  process.argv.find((arg, index) => index > 1 && !arg.startsWith('--')) ??
    path.join(root, 'artifacts/artcraft-renderer-smoke'),
);
if (process.argv.includes('--build-development')) await buildArtcraftPreview();
await mkdir(output, { recursive: true });
const run = await mkdtemp(path.join(output, 'run-'));
const userData = path.join(run, 'user-data');
const require = createRequire(import.meta.url);
const env = { ...process.env, KERFDESK_ARTCRAFT_ROOT: path.join(root, '.artcraft') };
delete env.ELECTRON_RUN_AS_NODE;
delete env.LASERFORGE_DEV_URL;
const evidence = {
  kind: 'source-development-desktop-renderer-smoke',
  run,
  userData,
  started: new Date().toISOString(),
  errors: [],
  consoleErrors: [],
  passed: false,
};
let app;
let page;
try {
  app = await electron.launch({
    executablePath: require('electron'),
    cwd: root,
    env,
    args: [
      ARTCRAFT_PREVIEW_ROOT,
      `--kerfdesk-native-smoke-user-data=${userData}`,
      `--kerfdesk-native-smoke-result=${path.join(run, 'native-observation.json')}`,
      '--kerfdesk-native-smoke-interactive',
    ],
    timeout: 60000,
  });
  page = await app.firstWindow();
  evidence.failedResponses = [];
  page.on('response', (response) => {
    if (response.status() >= 400)
      evidence.failedResponses.push({ url: response.url(), status: response.status() });
  });
  page.on('pageerror', (error) => evidence.errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') evidence.consoleErrors.push(message.text());
  });
  await expect(page.locator('#app-splash')).toHaveCount(0, { timeout: 60000 });
  await page.getByRole('button', { name: 'Open Design Studio', exact: true }).click();
  const oldStudio = page.getByRole('dialog', { name: 'Design Studio', exact: true });
  await expect(oldStudio).toBeVisible();
  await oldStudio.getByRole('button', { name: 'Desktop editors', exact: true }).click();
  const panel = page.getByRole('dialog', {
    name: 'A bigger studio, connected to KerfDesk',
    exact: true,
  });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Desktop editor status updated.');
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Open VectorCraft', exact: true })).toBeVisible();
  await expect(oldStudio).toBeVisible();
  await page.screenshot({ path: path.join(run, 'desktop-editors-panel.png') });
  evidence.bridgeStatus = await page.evaluate(async () => {
    const response = await fetch('app://app/api/artcraft-studio', {
      headers: { 'X-KerfDesk-Studio': '1' },
    });
    return { httpStatus: response.status, body: await response.json() };
  });
  await panel.locator('input[type="file"]').setInputFiles({
    name: 'renderer-roundtrip.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="80mm" viewBox="0 0 120 80"><path fill="none" stroke="#000000" d="M0 0 H120 V80 H0 Z"/></svg>',
    ),
  });
  await panel.getByRole('button', { name: 'Open VectorCraft', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Apply to KerfDesk', exact: true })).toBeEnabled({
    timeout: 60000,
  });
  await panel.getByRole('button', { name: 'Apply to KerfDesk', exact: true }).click();
  await expect(panel).toContainText('Artwork applied to KerfDesk.', { timeout: 60000 });
  await panel.getByRole('button', { name: 'Apply to KerfDesk', exact: true }).click();
  await expect(panel).toContainText('Artwork applied to KerfDesk.', { timeout: 60000 });
  await page.screenshot({ path: path.join(run, 'vector-applied-twice.png') });
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(oldStudio).toBeVisible();
  await expect(
    oldStudio.getByRole('button', { name: 'Desktop editors', exact: true }),
  ).toBeFocused();
  await oldStudio.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(oldStudio).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open Design Studio', exact: true })).toBeVisible();
  await expect(page.getByText('Objects: 1', { exact: true })).toBeVisible();
  const width = Number(await page.getByLabel('Selection width', { exact: true }).inputValue());
  const height = Number(await page.getByLabel('Selection height', { exact: true }).inputValue());
  expect(width).toBeCloseTo(120, 2);
  expect(height).toBeCloseTo(80, 2);
  evidence.roundtrip = {
    vector: true,
    appliedTwice: true,
    objects: 1,
    widthMm: width,
    heightMm: height,
  };
  await page.screenshot({ path: path.join(run, 'old-workspace-preserved.png') });
  expect(evidence.errors).toEqual([]);
  // Existing DEV StrictMode cleanup may detach an already detached remote session.
  // Preserve these exact baseline failures; every other network/console error fails this smoke.
  const baselineCases = [
    {
      url: 'app://app/api/licensing/licence-link',
      status: 404,
      message: 'Failed to load resource: the server responded with a status of 404 (Not Found)',
    },
    {
      url: 'app://app/api/remote/detach',
      status: 409,
      message: 'Failed to load resource: the server responded with a status of 409 (Conflict)',
    },
  ];
  evidence.baselineNetworkIssues = evidence.failedResponses.filter((response) =>
    baselineCases.some(
      (baseline) => response.url === baseline.url && response.status === baseline.status,
    ),
  );
  expect(
    evidence.failedResponses.filter(
      (response) => !evidence.baselineNetworkIssues.includes(response),
    ),
  ).toEqual([]);
  expect(
    evidence.consoleErrors.filter(
      (message) => !baselineCases.some((baseline) => baseline.message === message),
    ),
  ).toEqual([]);
  for (const baseline of baselineCases) {
    expect(
      evidence.consoleErrors.filter((message) => message === baseline.message).length,
    ).toBeLessThanOrEqual(
      evidence.baselineNetworkIssues.filter(
        (response) => response.url === baseline.url && response.status === baseline.status,
      ).length,
    );
  }
  evidence.passed = true;
} catch (error) {
  if (page) {
    await page.screenshot({ path: path.join(run, 'failure.png') });
    evidence.visibleText = (await page.locator('body').innerText()).slice(0, 10000);
  }
  evidence.failure = error instanceof Error ? error.stack : String(error);
  process.exitCode = 1;
} finally {
  if (app) {
    const closing = app.close();
    // This profile was created by this smoke and holds only its synthetic rectangle.
    if (page && evidence.roundtrip) {
      await page
        .getByRole('button', { name: "Don't Save", exact: true })
        .click({ timeout: 5000 })
        .catch(() => undefined);
    }
    await closing;
  }
  await writeFile(path.join(run, 'renderer-smoke.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(
    JSON.stringify({ passed: evidence.passed, evidence: run, failure: evidence.failure ?? null }),
  );
}
