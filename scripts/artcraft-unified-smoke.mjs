/* global window, innerWidth, innerHeight */
import { _electron as electron, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildArtcraftPreview,
  ARTCRAFT_PREVIEW_ROOT,
  ARTCRAFT_REPO_ROOT as root,
} from './build-artcraft-preview.mjs';
const require = createRequire(import.meta.url);
if (process.argv.includes('--build-development')) await buildArtcraftPreview();
const output = path.join(root, 'artifacts/artcraft-unified-smoke');
await mkdir(output, { recursive: true });
const run = await mkdtemp(path.join(output, 'run-'));
const env = { ...process.env, KERFDESK_ARTCRAFT_ROOT: path.join(root, '.artcraft') };
delete env.ELECTRON_RUN_AS_NODE;
delete env.LASERFORGE_DEV_URL;
const evidence = { run, passed: false, errors: [], hosted: [], profiles: [] };
let app, page;
async function launch(profile) {
  app = await electron.launch({
    executablePath: require('electron'),
    cwd: root,
    env,
    args: [
      ARTCRAFT_PREVIEW_ROOT,
      `--kerfdesk-native-smoke-user-data=${path.join(run, profile)}`,
      `--kerfdesk-native-smoke-result=${path.join(run, profile + '-observation.json')}`,
      '--kerfdesk-native-smoke-interactive',
    ],
    timeout: 60000,
  });
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = (_window, options) => {
      const index = options.buttons?.indexOf("Don't Save") ?? -1;
      return index >= 0 ? index : (options.cancelId ?? 0);
    };
  });
  page = await app.firstWindow();
  page.on('pageerror', (error) => evidence.errors.push(error.message));
  await expect(page.locator('#app-splash')).toHaveCount(0, { timeout: 60000 });
  evidence.profiles.push(profile);
}
async function openPanel() {
  await page.getByRole('button', { name: 'Open Design Studio', exact: true }).click();
  await page.getByRole('button', { name: 'Desktop editors', exact: true }).click();
  return page.locator('.artcraft-backdrop');
}
async function hosted() {
  await expect(async () => {
    const sessions = await page.evaluate(
      async () =>
        (
          await (
            await fetch('app://app/api/artcraft-studio', { headers: { 'X-KerfDesk-Studio': '1' } })
          ).json()
        ).sessions,
    );
    const state = await page.locator('.artcraft-editor').evaluate(async (el, id) => {
      const r = el.getBoundingClientRect();
      const res = await fetch('app://app/api/artcraft-studio', {
        method: 'POST',
        headers: { 'X-KerfDesk-Studio': '1', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'host',
          sessionId: id,
          rect: {
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            viewportWidth: innerWidth,
            viewportHeight: innerHeight,
          },
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }, sessions.at(-1).id);
    expect(state.parent).not.toBe('0');
    expect(state.visible).toBe(true);
    evidence.hosted.push(state);
  }).toPass({ timeout: 60000 });
}
async function closeApp() {
  // Isolated generated project only. Request normal close, permit discard of synthetic data if asked.
  const closing = app.close();
  await page
    .getByRole('button', { name: "Don't Save", exact: true })
    .click({ timeout: 8000 })
    .catch(() => undefined);
  await closing;
  app = undefined;
  page = undefined;
  await writeFile(path.join(run, 'result.json'), JSON.stringify(evidence, null, 2));
  await promisify(execFile)(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      path.join(root, 'scripts/artcraft-cleanup-smoke.ps1'),
      '-EvidenceFile',
      path.join(run, 'result.json'),
    ],
    { windowsHide: true, timeout: 15000 },
  );
}
try {
  await launch('original-profile');
  let panel = await openPanel();
  await panel.locator('input[type="file"]').setInputFiles({
    name: 'unified-vector.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="80mm" viewBox="0 0 120 80"><path d="M0 0 H120 V80 H0Z" fill="#386faa"/></svg>',
    ),
  });
  await panel.getByRole('button', { name: 'Open VectorCraft', exact: true }).click();
  await expect(panel).toContainText('Editable source is in this project.', { timeout: 60000 });
  await hosted();
  await captureWindow();
  await panel.getByRole('button', { name: 'Apply to KerfDesk', exact: true }).click();
  await expect(panel).toContainText('Artwork updated in KerfDesk.', { timeout: 60000 });
  await panel.getByRole('button', { name: 'PhotoCraft', exact: true }).click();
  await panel.getByRole('button', { name: 'Open PhotoCraft', exact: true }).click();
  await expect(panel).toContainText('Editable source is in this project.', { timeout: 60000 });
  await hosted();
  await captureWindow();
  await expect(panel.locator('.artcraft-documents button')).toHaveCount(2);
  // Use the real save pipeline and a deterministic test-owned picker destination.
  await page.evaluate(() => {
    window.__studioSaved = '';
    const handle = {
      kind: 'file',
      name: 'unified-studio.lf2',
      isSameEntry: async (other) => other === handle,
      createWritable: async () => {
        let text = '';
        return {
          write: async (data) => {
            text += typeof data === 'string' ? data : await data.text();
          },
          close: async () => {
            window.__studioSaved = text;
          },
          abort: async () => undefined,
        };
      },
    };
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: async () => handle,
    });
  });
  await panel.getByRole('button', { name: 'Save project', exact: true }).click();
  await expect(panel).toContainText('Project saved with editable studio documents.', {
    timeout: 60000,
  });
  const saved = await page.evaluate(() => window.__studioSaved);
  await writeFile(path.join(run, 'unified-studio.lf2'), saved);
  const project = JSON.parse(saved);
  const data = project.project ?? project;
  expect(data.studioDocuments).toHaveLength(2);
  evidence.savedDocuments = data.studioDocuments.map(({ nativeBase64, ...doc }) => ({
    ...doc,
    bytes: Buffer.from(nativeBase64, 'base64').length,
  }));
  await panel.getByRole('button', { name: 'Back to old studio', exact: true }).click();
  await expect(panel).toHaveCount(0, { timeout: 60000 });
  const old = page.getByRole('dialog', { name: 'Design Studio', exact: true });
  await old.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByText('Objects: 1', { exact: true })).toBeVisible();
  evidence.oldStudioRetained = true;
  await closeApp();
  // Fresh application profile exercises deserialize + actual native restore from the .lf2 contents.
  await launch('reopened-profile');
  await page.evaluate((text) => {
    const handle = {
      kind: 'file',
      name: 'unified-studio.lf2',
      getFile: async () => new File([text], 'unified-studio.lf2', { type: 'application/json' }),
      queryPermission: async () => 'granted',
      isSameEntry: async (other) => other === handle,
    };
    Object.defineProperty(window, 'showOpenFilePicker', {
      configurable: true,
      value: async () => [handle],
    });
  }, saved);
  await page.keyboard.press('Control+o');
  await expect(page.getByText('Objects: 1', { exact: true })).toBeVisible({ timeout: 60000 });
  panel = await openPanel();
  await expect(panel.locator('.artcraft-documents button')).toHaveCount(2);
  await panel
    .locator('.artcraft-documents button')
    .filter({ hasText: 'unified-vector.svg' })
    .click();
  await expect(panel).toContainText('Full editor restored from this project.', { timeout: 60000 });
  await hosted();
  await captureWindow();
  await panel.getByRole('button', { name: 'Apply to KerfDesk', exact: true }).click();
  await expect(panel).toContainText('Artwork updated in KerfDesk.', { timeout: 60000 });
  await panel.locator('.artcraft-documents button').filter({ hasText: 'Photo artwork' }).click();
  await expect(panel).toContainText('Full editor restored from this project.', { timeout: 60000 });
  await hosted();
  await captureWindow();
  await page.screenshot({ path: path.join(run, 'unified-chrome.png') });
  await panel.getByRole('button', { name: 'Back to old studio', exact: true }).click();
  await expect(panel).toHaveCount(0, { timeout: 60000 });
  await page
    .getByRole('dialog', { name: 'Design Studio', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await expect(page.getByText('Objects: 1', { exact: true })).toBeVisible();
  evidence.reopenNoDuplicateArtwork = true;
  await expect(page.getByText(/Studio recovery checkpoint failed:/)).toHaveCount(0);
  expect(evidence.errors).toEqual([]);
  evidence.passed = true;
} catch (error) {
  evidence.failure = String(error.stack ?? error);
  if (page) {
    evidence.visibleText = (
      await page
        .locator('body')
        .innerText()
        .catch(() => '')
    ).slice(-10000);
    await page.screenshot({ path: path.join(run, 'failure.png') }).catch(() => undefined);
  }
  process.exitCode = 1;
} finally {
  await writeFile(path.join(run, 'result.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ run, passed: evidence.passed, failure: evidence.failure }));
  if (app) await closeApp().catch(() => undefined);
}

async function captureWindow() {
  const handle = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE().toString(),
  );
  await promisify(execFile)(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      path.join(root, 'scripts/artcraft-capture-window.ps1'),
    ],
    {
      windowsHide: true,
      timeout: 15000,
      env: {
        ...process.env,
        SMOKE_HOST_HANDLE: handle,
        SMOKE_IMAGE_PATH: path.join(run, 'embedded-' + evidence.hosted.length + '.png'),
      },
    },
  );
}
