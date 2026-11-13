import type { Locator } from '@playwright/test';

/**
 * Click a save dialog's button if it is visible and enabled right now, for a
 * poll whose dialog may close at any moment. A dialog that has gone, or never
 * came, counts as nothing to click.
 *
 * `isVisible()` answers at once, but `isEnabled()` first waits for the button
 * to exist, and this config sets no actionTimeout, so that wait had no limit.
 * When the dialog closed between the two checks (the picker opened by itself,
 * or the file was written), the poll's callback never returned, and the poll
 * failed at 90 s however soon the save had finished. Bounding the enabled
 * check closes that gap.
 */
export async function clickDialogButtonIfReady(button: Locator): Promise<void> {
  if (!(await button.isVisible())) return;
  if (!(await button.isEnabled({ timeout: 1_000 }).catch(() => false))) return;
  // The dialog may close under the click when the save finishes first.
  await button.click({ timeout: 2_000 }).catch(() => undefined);
}
