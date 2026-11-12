// Open over unsaved work after a slow save (annoyance audit A4-P3-2, ADR-656
// Amendment 5). Chromium opens a file picker only within 5 s of the last click
// or key press. An Open that had to wait for Save longer than that asks for a
// fresh Choose file… click instead of ending in the browser's error.

import { readFileSync } from 'node:fs';
import { menuAction } from './fixtures/artwork-library-acceptance';
import { lapseClickActivation, notifications } from './fixtures/gcode-save';
import {
  expect,
  test,
  type KerfDeskFixture,
  type Locator,
  type Page,
} from './fixtures/kerfdesk-test';
import { toolbarCommand } from './fixtures/workspace-ui';

const projectText = readFileSync(new URL('./fixtures/project-basic.lf2', import.meta.url), 'utf8');
const SQUARE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="20mm" viewBox="0 0 20 20">' +
  '<rect x="2" y="2" width="16" height="16" fill="none" stroke="#000"/></svg>';

const count = async (fixture: KerfDeskFixture, kind: string): Promise<number> =>
  (await fixture.events()).filter((event) => event.kind === kind).length;

const saveChanges = (page: Page): Locator =>
  page.getByRole('dialog', { name: 'Save changes?', exact: true });

/** Artwork on the canvas and no file yet, so Save has to ask where. */
async function unsavedWorkWithNoFile(page: Page, kerfdesk: KerfDeskFixture): Promise<void> {
  await page.goto('/');
  await kerfdesk.setOpenFiles([{ name: 'square.svg', text: SQUARE_SVG }]);
  await (await toolbarCommand(page, 'Import...')).click();
  await expect(page).toHaveTitle(/untitled \*$/);
  expect(await count(kerfdesk, 'picker-open')).toBe(1);
}

/** Counts every fresh-click dialog drawn from now on, however briefly. */
async function countFreshClickDialogs(page: Page, title: string): Promise<() => Promise<number>> {
  await page.evaluate((wanted) => {
    const state = window as Window & { __freshClickDialogs?: number };
    state.__freshClickDialogs = 0;
    new MutationObserver(() => {
      for (const heading of document.querySelectorAll('[role="dialog"] h2')) {
        if (heading.textContent !== wanted || heading.hasAttribute('data-counted')) continue;
        heading.setAttribute('data-counted', '');
        state.__freshClickDialogs = (state.__freshClickDialogs ?? 0) + 1;
      }
    }).observe(document.body, { childList: true, subtree: true });
  }, title);
  return () =>
    page.evaluate(
      () => (window as Window & { __freshClickDialogs?: number }).__freshClickDialogs ?? 0,
    );
}

test('Open after a quick save goes straight to the open picker', async ({ page, kerfdesk }) => {
  await unsavedWorkWithNoFile(page, kerfdesk);
  await kerfdesk.setOpenFiles([{ name: 'next.lf2', text: projectText }]);
  const freshClickDialogs = await countFreshClickDialogs(page, 'Open project');

  await page.keyboard.press('Control+O');
  await saveChanges(page).getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page).toHaveTitle(/next\.lf2/);
  expect(await count(kerfdesk, 'picker-save')).toBe(1);
  expect(await count(kerfdesk, 'picker-open')).toBe(2);
  expect(await freshClickDialogs()).toBe(0);
});

test('Open after a slow save asks for a fresh click, then reaches the open picker', async ({
  page,
  kerfdesk,
}) => {
  await unsavedWorkWithNoFile(page, kerfdesk);
  await kerfdesk.setOpenFiles([{ name: 'next.lf2', text: projectText }]);

  await page.keyboard.press('Control+O');
  await expect(saveChanges(page)).toBeVisible();
  // The save picker stays open past the 5 s the Save click is good for.
  await lapseClickActivation(page);
  await saveChanges(page).getByRole('button', { name: 'Save', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Open project', exact: true });
  await expect(dialog).toContainText('untitled.lf2 is saved. Choose the project to open.');
  expect((await kerfdesk.savedFiles())['untitled.lf2']).toContain('square.svg');
  // No picker was asked for without a click, and nothing reported an error.
  expect(await count(kerfdesk, 'picker-open')).toBe(1);
  await expect(notifications(page)).not.toContainText('Could not open project');

  await dialog.getByRole('button', { name: 'Choose file…', exact: true }).click();

  await expect(page).toHaveTitle(/next\.lf2/);
  await expect(dialog).toBeHidden();
  expect(await count(kerfdesk, 'picker-open')).toBe(2);
});

test('Cancel in that dialog keeps the saved project open', async ({ page, kerfdesk }) => {
  await unsavedWorkWithNoFile(page, kerfdesk);
  await kerfdesk.setOpenFiles([{ name: 'next.lf2', text: projectText }]);

  await page.keyboard.press('Control+O');
  await expect(saveChanges(page)).toBeVisible();
  await lapseClickActivation(page);
  await saveChanges(page).getByRole('button', { name: 'Save', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Open project', exact: true });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

  await expect(dialog).toBeHidden();
  // Saved, not replaced, and no longer marked as changed.
  await expect(page).toHaveTitle(/untitled\.lf2$/);
  expect(await count(kerfdesk, 'picker-open')).toBe(1);
  await expect(page.getByLabel('Selection width', { exact: true })).toHaveValue('16');
});

test('Open template after a slow save asks for a fresh click too', async ({ page, kerfdesk }) => {
  await unsavedWorkWithNoFile(page, kerfdesk);
  await menuAction(page, 'File', 'Save template...');
  await expect.poll(() => count(kerfdesk, 'file-saved')).toBe(1);
  const template = (await kerfdesk.savedFiles())['untitled.lf2template'];
  if (template === undefined) throw new Error('The template was not saved');
  await kerfdesk.setOpenFiles([{ name: 'badge.lf2template', text: template }]);

  await menuAction(page, 'File', 'Open template...');
  await expect(saveChanges(page)).toBeVisible();
  await lapseClickActivation(page);
  await saveChanges(page).getByRole('button', { name: 'Save', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Open template', exact: true });
  await expect(dialog).toContainText('untitled.lf2 is saved. Choose the template to open.');
  expect(await count(kerfdesk, 'picker-open')).toBe(1);
  await expect(notifications(page)).not.toContainText('Could not open template');

  await dialog.getByRole('button', { name: 'Choose file…', exact: true }).click();

  await expect(notifications(page)).toContainText('Started a new project from badge.lf2template');
  await expect(page).toHaveTitle(/badge\.lf2 \*$/);
  expect(await count(kerfdesk, 'picker-open')).toBe(2);
});
