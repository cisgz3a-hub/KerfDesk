// ADR-698: Simple view hides the advanced laser settings, never a value that
// changes the burn, and Show all settings brings them back.
import { test, expect } from './fixtures/kerfdesk-test';
import { toolbarCommand } from './fixtures/workspace-ui';

test('Simple view keeps power, speed and passes and lists the hidden values a burn uses', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await (await toolbarCommand(page, 'Open...')).click();
  await expect(page).toHaveTitle(/project-basic\.lf2/, { timeout: 30_000 });
  const sideTab = page
    .getByRole('tablist', { name: 'Side panel', exact: true })
    .getByRole('tab', { name: 'Artwork', exact: true });
  if (await sideTab.isVisible()) await sideTab.click();
  const panel = page.getByRole('complementary', { name: 'Artwork panel', exact: true });
  const mode = panel.getByRole('radiogroup', { name: /^Mode for/ });
  await mode.getByRole('radio', { name: /^Fill/ }).check({ force: true });
  const spacing = panel.getByRole('spinbutton', { name: /^Hatch spacing for/ });
  await spacing.fill('0.05');
  await spacing.press('Tab');
  await expect(spacing).toHaveValue('0.05');

  const menu = page.getByRole('menubar', { name: 'Application menu' });
  await menu.getByRole('menuitem', { name: 'Window', exact: true }).click();
  const toggle = menu.getByRole('menuitemcheckbox', { name: 'Simple View', exact: true });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  const note = panel.getByRole('region', { name: 'Settings Simple view hides', exact: true });
  await expect(note).toContainText('Line spacing: 0.05 mm');
  for (const name of [/^Power for/, /^Speed for/, /^Passes for/]) {
    await expect(panel.getByRole('spinbutton', { name })).toBeVisible();
  }
  await expect(spacing).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'More cut settings', exact: true })).toHaveCount(
    0,
  );
  await panel.screenshot({ path: testInfo.outputPath('simple-view-on.png') });

  // A computer preference, kept for the next start.
  expect(await page.evaluate(() => localStorage.getItem('kerfdesk.simple-view.v1'))).toBe('on');

  await note.getByRole('button', { name: 'Show all settings', exact: true }).click();
  await expect(spacing).toHaveValue('0.05');
  await expect(panel.getByRole('button', { name: 'More cut settings', exact: true })).toBeVisible();
  await panel.screenshot({ path: testInfo.outputPath('simple-view-off.png') });
});
