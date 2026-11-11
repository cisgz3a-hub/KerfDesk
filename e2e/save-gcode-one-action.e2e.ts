// Save G-code from one action (annoyance audit A4-P2-4 and A1-P3-9, ADR-656
// Amendment 4). A small job goes from Ctrl+Shift+E straight to the file dialog;
// a job ready only after the key press lapsed still shows the dialog and asks
// for Save as…; a refusal is one error toast.

import { expect, test, type KerfDeskFixture, type Page } from './fixtures/kerfdesk-test';
import { lapseClickActivation, notifications } from './fixtures/gcode-save';
import { toolbarCommand } from './fixtures/workspace-ui';

const count = async (fixture: KerfDeskFixture, kind: string): Promise<number> =>
  (await fixture.events()).filter((event) => event.kind === kind).length;

async function openSmallJob(page: Page): Promise<void> {
  await page.goto('/');
  await (await toolbarCommand(page, 'Open...')).click();
  await expect(page).toHaveTitle(/project-basic\.lf2/);
}

/** Counts every Save G-code dialog drawn from now on, however briefly. */
async function countSaveDialogs(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const state = window as Window & { __saveDialogs?: number };
    state.__saveDialogs = 0;
    new MutationObserver(() => {
      for (const heading of document.querySelectorAll('[role="dialog"] h2')) {
        if (heading.textContent !== 'Save G-code' || heading.hasAttribute('data-counted')) continue;
        heading.setAttribute('data-counted', '');
        state.__saveDialogs = (state.__saveDialogs ?? 0) + 1;
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
  return () =>
    page.evaluate(() => (window as Window & { __saveDialogs?: number }).__saveDialogs ?? 0);
}

test('a small job saves from Ctrl+Shift+E alone, with no dialog', async ({ page, kerfdesk }) => {
  await openSmallJob(page);
  const saveDialogs = await countSaveDialogs(page);

  await page.keyboard.press('Control+Shift+E');

  // Nothing else is pressed: the file dialog opens and the file is written.
  await expect.poll(() => count(kerfdesk, 'file-saved')).toBe(1);
  expect(await count(kerfdesk, 'picker-save')).toBe(1);
  expect(await saveDialogs()).toBe(0);
  const saved = (await kerfdesk.savedFiles())['project-basic.gcode'];
  expect(saved).toContain('G21');
  await expect(notifications(page)).toContainText('Saved G-code to project-basic.gcode');
});

test('a job ready after the key press lapsed shows the dialog and saves on Save as…', async ({
  page,
  kerfdesk,
}) => {
  await openSmallJob(page);
  await lapseClickActivation(page);

  await page.keyboard.press('Control+Shift+E');

  const dialog = page.getByRole('dialog', { name: 'Save G-code', exact: true });
  await expect(dialog).toContainText('The complete export is ready.');
  const saveAs = dialog.getByRole('button', { name: 'Save as…', exact: true });
  await expect(saveAs).toBeEnabled();
  // The picker cannot open without a click, so nothing has been chosen yet.
  expect(await count(kerfdesk, 'picker-save')).toBe(0);
  await saveAs.click();
  await expect.poll(() => count(kerfdesk, 'file-saved')).toBe(1);
  await expect(dialog).toBeHidden();
  expect((await kerfdesk.savedFiles())['project-basic.gcode']).toContain('G21');
});

test('Cancel in the slow-save dialog chooses and writes nothing', async ({ page, kerfdesk }) => {
  await openSmallJob(page);
  await lapseClickActivation(page);

  await page.keyboard.press('Control+Shift+E');

  const dialog = page.getByRole('dialog', { name: 'Save G-code', exact: true });
  await expect(dialog).toContainText('The complete export is ready.');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await count(kerfdesk, 'picker-save')).toBe(0);
  expect(await kerfdesk.savedFiles()).toEqual({});
});

test('an empty canvas is refused once, as an error toast', async ({ page, kerfdesk }) => {
  await page.goto('/');
  let nativeDialogs = 0;
  page.on('dialog', (dialog) => {
    nativeDialogs += 1;
    void dialog.dismiss();
  });
  const saveDialogs = await countSaveDialogs(page);

  await page.keyboard.press('Control+Shift+E');

  await expect(notifications(page)).toContainText(
    'Cannot save G-code: No output layers. Enable Output on at least one layer.',
  );
  // One dismissal clears it: no native alert, and no dialog left to cancel.
  expect(nativeDialogs).toBe(0);
  expect(await saveDialogs()).toBe(0);
  expect(await count(kerfdesk, 'picker-save')).toBe(0);
  await page
    .getByRole('button', { name: /^Dismiss error notification: Cannot save G-code/ })
    .click();
  await expect(notifications(page)).not.toContainText('Cannot save G-code');
});
