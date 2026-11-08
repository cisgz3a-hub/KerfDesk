// Ctrl+K finds what a beginner types first (ADR-604 Amendment 1, UX audit
// U6-P2-1→P3, U6-P3-2): a machine-panel action opens the panel at its control
// and focuses it without pressing it, a setting opens Settings at its section,
// and Keyboard Shortcuts opens from search and from the Help menu.
import { expect, test, type Page } from './fixtures/kerfdesk-test';

async function search(page: Page, query: string): Promise<void> {
  await page.keyboard.press('Control+K');
  const box = page.getByRole('combobox', { name: 'Find a command', exact: true });
  await expect(box).toBeFocused();
  await box.fill(query);
}

test('Ctrl+K reveals panel actions, opens Settings and Keyboard Shortcuts', async ({
  page,
  kerfdesk,
}) => {
  await page.goto('/');
  await expect(page.locator('#app-splash')).toHaveCount(0);

  await search(page, 'frame job');
  const first = page.getByRole('option').first();
  await expect(first).toContainText('Frame job');
  await expect(first).toContainText('Machine panel');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Find a command' })).toHaveCount(0);
  // Nothing is connected, so Frame job is disabled: the notice repeats its reason,
  // and nothing was sent to the machine.
  await expect(page.getByText(/Frame job: /)).toBeVisible();
  expect((await kerfdesk.events()).filter((event) => event.kind === 'serial-write')).toEqual([]);

  await search(page, 'units');
  await expect(page.getByRole('option').first()).toContainText('Units (millimetres or inches)');
  await page.keyboard.press('Enter');
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings.getByText('Units', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);

  await search(page, 'shortcuts');
  await expect(page.getByRole('option').first()).toContainText('Keyboard Shortcuts...');
  await page.keyboard.press('Enter');
  const shortcuts = page.getByRole('dialog', { name: 'Keyboard Shortcuts' });
  await expect(shortcuts).toContainText('F12');
  await page.keyboard.press('Escape');
  await expect(shortcuts).toHaveCount(0);

  await page.getByRole('menuitem', { name: 'Help', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Keyboard Shortcuts/ }).click();
  await expect(shortcuts).toBeVisible();
});
