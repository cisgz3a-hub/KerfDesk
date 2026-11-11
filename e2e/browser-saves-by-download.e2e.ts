// Rolling audit v11 W9-P2-2 (ADR-688 Amendment 2): in a browser without file
// pickers (Firefox, Safari), Save downloads the project, the banner says so
// without calling the autosave safe, and the downloaded file opens again when
// dropped on the canvas. Chrome is made to look like such a browser by
// removing its pickers before the app loads.

import { readFileSync } from 'node:fs';
import { expect, test, type Page } from './fixtures/kerfdesk-test';
import { toolbarCommand } from './fixtures/workspace-ui';

// The message carries its variant for screen readers ("Success: ").
const DOWNLOADED_TOAST = /Downloaded dropped\.lf2\. Check that it reached your Downloads folder/;
const projectText = readFileSync(new URL('./fixtures/project-basic.lf2', import.meta.url), 'utf8');

async function removeFilePickers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    for (const name of ['showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker']) {
      Reflect.deleteProperty(window, name);
      Object.defineProperty(window, name, { configurable: true, value: undefined });
    }
  });
}

async function dropProject(page: Page, name: string, text: string): Promise<void> {
  await page.evaluate(
    ({ name, text }) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([text], name, { type: '' }));
      window.dispatchEvent(
        new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }),
      );
    },
    { name, text },
  );
}

test('without showSaveFilePicker, Save downloads the project and the download opens again', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await removeFilePickers(page);
  await page.goto('/');

  const banner = page.getByRole('status', { name: 'Browser file support' });
  await expect(banner).toContainText('This browser saves by downloading.');
  await expect(banner).toContainText('Safari does after 7 days without a visit');
  await expect(banner).not.toContainText('your work is autosaved in this browser');

  await dropProject(page, 'dropped.lf2', projectText);
  await expect(page).toHaveTitle(/dropped\.lf2/);
  const power = page.getByRole('spinbutton', { name: /^Power for/ }).first();
  await power.fill('37');
  await power.press('Tab');
  await expect(page).toHaveTitle(/\*$/);

  // Success toasts leave after 4 s, so every toast is recorded as it appears.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as Window & { __toastsSeen?: string[] }).__toastsSeen = seen;
    new MutationObserver(() => {
      for (const node of document.querySelectorAll('.lf-toast__message')) {
        const text = node.textContent ?? '';
        if (!seen.includes(text)) seen.push(text);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  const toastsSeen = () =>
    page.evaluate(() => (window as Window & { __toastsSeen?: string[] }).__toastsSeen ?? []);

  const downloadPromise = page.waitForEvent('download');
  await (await toolbarCommand(page, 'Save As...')).click();
  // A large project is prepared first and asks for a second click.
  const dialog = page.getByRole('dialog', { name: 'Save project', exact: true });
  const first = await Promise.race([
    downloadPromise.then(() => 'download' as const),
    dialog.waitFor({ state: 'visible', timeout: 60_000 }).then(() => 'dialog' as const),
  ]);
  if (first === 'dialog') {
    const choose = dialog.getByRole('button', { name: 'Choose file…', exact: true });
    await expect(choose).toBeEnabled({ timeout: 60_000 });
    await choose.click();
  }
  const download = await downloadPromise;
  await expect.poll(toastsSeen).toContainEqual(expect.stringMatching(DOWNLOADED_TOAST));
  await expect(page).not.toHaveTitle(/\*$/);
  expect(download.suggestedFilename()).toMatch(/\.lf2$/);
  const downloadedPath = await download.path();
  const saved = JSON.parse(readFileSync(downloadedPath, 'utf8')) as {
    scene: { layers: { power: number }[] };
  };
  expect(saved.scene.layers.map((layer) => layer.power)).toContain(37);

  // The downloaded copy is the way back in: dropping it opens it.
  await page.goto('/');
  await dropProject(page, 'reopened.lf2', readFileSync(downloadedPath, 'utf8'));
  await expect(page).toHaveTitle(/reopened\.lf2/);
  await expect(page.getByRole('spinbutton', { name: /^Power for/ }).first()).toHaveValue('37');
});
