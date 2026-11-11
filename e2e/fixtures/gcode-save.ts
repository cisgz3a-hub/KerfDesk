import { expect, type Page } from './kerfdesk-test';

/**
 * Carry a Save G-code through to its written file, once the spec has started it.
 *
 * A laser export that is ready while the click is still active goes straight to
 * the file dialog, so there is nothing to click (ADR-656 Amendment 4). A CNC
 * export, or one that outlasted its click, shows the Save G-code dialog, and
 * this presses Save as… there. `saved` says when the file has been written.
 */
export async function finishGcodeSave(
  page: Page,
  saved: () => Promise<boolean>,
  timeout = 90_000,
): Promise<void> {
  const saveAs = page
    .getByRole('dialog', { name: 'Save G-code', exact: true })
    .getByRole('button', { name: 'Save as…', exact: true });
  await expect
    .poll(
      async () => {
        if (await saved()) return true;
        if ((await saveAs.isVisible()) && (await saveAs.isEnabled())) {
          // The dialog may close under the click when the save finishes first.
          await saveAs.click({ timeout: 2_000 }).catch(() => undefined);
        }
        return saved();
      },
      { timeout },
    )
    .toBe(true);
}

/**
 * Make the click's activation count as lapsed, as it is once a save has
 * prepared for more than 5 s. Waiting does not do it here: Playwright runs its
 * own page calls with a user gesture, which keeps the activation alive.
 */
export async function lapseClickActivation(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'userActivation', {
      configurable: true,
      get: () => ({ isActive: false, hasBeenActive: true }),
    });
  });
}

/**
 * A refused Save G-code, said once (ADR-656 Amendment 4): one error toast when
 * the refusal came back before the Save G-code dialog appeared, or the reasons
 * inside that dialog with a single Close when the preparation was slow enough
 * to show it. Either way this leaves nothing open.
 */
export async function expectGcodeSaveRefused(page: Page, reason: string | RegExp): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Save G-code', exact: true });
  const refusedInDialog = dialog.getByRole('alert');
  const toast = notifications(page).getByText(/Cannot save G-code/);
  await expect(toast.or(refusedInDialog).first()).toBeVisible({ timeout: 90_000 });
  if (await refusedInDialog.isVisible()) {
    await expect(refusedInDialog).toContainText('Cannot save G-code:');
    await expect(refusedInDialog).toContainText(reason);
    // One dismissal: the only button is Close.
    await expect(dialog.getByRole('button')).toHaveText(['Close']);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  } else {
    await expect(notifications(page)).toContainText(reason);
  }
  await expect(dialog).toBeHidden();
}

/** The notifications a refused save reports in (one error toast, no dialog). */
export function notifications(page: Page) {
  return page.getByRole('region', { name: 'Notifications', exact: true });
}
