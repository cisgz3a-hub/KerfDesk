import { expect, test, type Page } from './fixtures/kerfdesk-test';
import { toolbarCommand } from './fixtures/workspace-ui';

async function settings(page: Page) {
  const menu = page.getByRole('menubar', { name: 'Application menu', exact: true });
  await menu.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await menu
    .getByRole('menuitem')
    .filter({ has: page.getByText('Settings...', { exact: true }) })
    .click();
  return page.getByRole('dialog', { name: 'Settings', exact: true });
}

test('blocked preference saves stay visible and retry persists the latest choices', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    let refuse = true;
    Object.defineProperty(window, '__allowPreferenceWrites', {
      value: () => {
        refuse = false;
      },
    });
    Storage.prototype.setItem = function (key, value) {
      if (refuse && ['kerfdesk.theme.v1', 'kerfdesk.recent-projects.limit.v1'].includes(key)) {
        throw new DOMException('Synthetic blocked preference storage', 'QuotaExceededError');
      }
      original.call(this, key, value);
    };
  });
  await page.goto('/');
  const dialog = await settings(page);
  await dialog.getByRole('radio', { name: 'Dark', exact: true }).check();
  const limit = dialog.getByRole('spinbutton', { name: 'Recent projects to keep', exact: true });
  await limit.fill('7');
  await limit.press('Tab');
  await limit.fill('17');
  await limit.press('Tab');
  await expect(dialog.getByRole('status')).toContainText('Some settings could not be saved');
  await expect(dialog).toContainText('The new limit takes effect after it is saved');
  await page.evaluate(() => {
    (window as typeof window & { __allowPreferenceWrites: () => void }).__allowPreferenceWrites();
  });
  await dialog.getByRole('button', { name: 'Retry saving settings', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveCount(0);
  await expect(dialog).not.toContainText('The new limit takes effect after it is saved');
  await page.reload();
  const restored = await settings(page);
  await expect(restored.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
  await expect(
    restored.getByRole('spinbutton', { name: 'Recent projects to keep', exact: true }),
  ).toHaveValue('17');
});

test('computer preferences survive reload, Open and New without entering the saved document', async ({
  page,
  kerfdesk,
}, testInfo) => {
  await page.setViewportSize({ width: 1536, height: 864 });
  await page.goto('/');
  const dialog = await settings(page);
  await dialog.getByRole('radio', { name: 'Dark', exact: true }).check();
  await dialog.getByRole('radio', { name: 'Spacious', exact: true }).check();
  await dialog.getByRole('spinbutton', { name: 'Recent projects to keep', exact: true }).fill('17');
  await dialog.getByRole('tab', { name: 'Canvas', exact: true }).click();
  await dialog.getByRole('checkbox', { name: 'Snapping on', exact: true }).uncheck();
  await dialog
    .getByRole('checkbox', { name: 'Show frame and job start markers', exact: true })
    .uncheck();
  const grid = dialog.getByRole('spinbutton', {
    name: 'Snap grid spacing in millimetres',
    exact: true,
  });
  await grid.fill('12.5');
  await grid.press('Tab');
  const nudge = dialog.getByRole('spinbutton', {
    name: 'Arrow keys nudge distance in millimetres',
    exact: true,
  });
  await nudge.fill('2.5');
  await nudge.press('Tab');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await page.reload();
  const restored = await settings(page);
  await expect(restored.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
  await expect(restored.getByRole('radio', { name: 'Spacious', exact: true })).toBeChecked();
  await expect(
    restored.getByRole('spinbutton', { name: 'Recent projects to keep', exact: true }),
  ).toHaveValue('17');
  await restored.getByRole('tab', { name: 'Canvas', exact: true }).click();
  await expect(
    restored.getByRole('spinbutton', { name: 'Snap grid spacing in millimetres', exact: true }),
  ).toHaveValue('12.5');
  await expect(
    restored.getByRole('spinbutton', {
      name: 'Arrow keys nudge distance in millimetres',
      exact: true,
    }),
  ).toHaveValue('2.5');
  await restored.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Open...', exact: true }).click();
  await expect(page).toHaveTitle(/project-basic\.lf2/);
  await expect(page.getByRole('button', { name: 'Toggle snapping', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(
    page.getByRole('button', { name: 'Show frame and job start markers', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  // The shared Open fixture is read-only; Save As provides a writable target.
  await (await toolbarCommand(page, 'Save As...')).click();
  await expect.poll(async () => Object.keys(await kerfdesk.savedFiles()).length).toBeGreaterThan(0);
  const savedText = Object.values(await kerfdesk.savedFiles()).at(-1);
  if (typeof savedText !== 'string') throw new Error('Save As did not produce a file');
  const saved = JSON.parse(savedText);
  for (const key of [
    'theme',
    'snapSettings',
    'nudgeSteps',
    'recentProjectLimit',
    'workspaceLayout',
  ])
    expect(saved).not.toHaveProperty(key);
  const menu = page.getByRole('menubar', { name: 'Application menu', exact: true });
  await menu.getByRole('menuitem', { name: 'File', exact: true }).click();
  await menu
    .getByRole('menuitem')
    .filter({ has: page.getByText('New', { exact: true }) })
    .click();
  await expect(
    page.getByRole('group', { name: 'Workspace status details', exact: true }),
  ).toContainText('Objects: 0');
  await expect(page.getByRole('button', { name: 'Toggle snapping', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.screenshot({ path: testInfo.outputPath('preferences-after-new.png') });
});

test('Save As immediately after operation edits persists all newly typed settings', async ({
  page,
  kerfdesk,
}) => {
  await page.setViewportSize({ width: 1536, height: 864 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open...', exact: true }).click();
  await expect(page).toHaveTitle(/project-basic\.lf2/);
  const panel = page.getByRole('complementary', {
    name: 'Artwork / Operations panel',
    exact: true,
  });
  await panel.getByRole('spinbutton', { name: /^Power for/ }).fill('37');
  await panel.getByRole('spinbutton', { name: /^Speed for/ }).fill('2345');
  await panel.getByRole('spinbutton', { name: /^Passes for/ }).fill('3');
  await (await toolbarCommand(page, 'Save As...')).click();
  await expect.poll(async () => Object.keys(await kerfdesk.savedFiles()).length).toBeGreaterThan(0);
  const savedText = Object.values(await kerfdesk.savedFiles()).at(-1);
  if (typeof savedText !== 'string') throw new Error('Save As did not produce a file');
  const saved = JSON.parse(savedText);
  expect(saved.scene.layers[0]).toMatchObject({ power: 37, speed: 2345, passes: 3 });
  await expect(panel.getByRole('spinbutton', { name: /^Power for/ })).toHaveValue('37');
});

test('actual autosave recovery restores job settings without replacing computer preferences', async ({
  page,
}, testInfo) => {
  // Allow the real 31-second autosave wait plus two full renderer loads on the dev server.
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1536, height: 864 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open...', exact: true }).click();
  await expect(page).toHaveTitle(/project-basic\.lf2/);
  const panel = page.getByRole('complementary', {
    name: 'Artwork / Operations panel',
    exact: true,
  });
  await panel.getByRole('spinbutton', { name: /^Power for/ }).fill('43');
  await panel.getByRole('spinbutton', { name: /^Power for/ }).press('Tab');
  const dialog = await settings(page);
  await dialog.getByRole('radio', { name: 'Dark', exact: true }).check();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  // Exercise the production interval and IndexedDB backend, not a manually seeded recovery slot.
  await page.waitForTimeout(31_000);
  await page.reload();
  const recovery = page.getByRole('region', { name: 'Autosaved project', exact: true });
  await expect(recovery).toBeVisible();
  await recovery.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(panel.getByRole('spinbutton', { name: /^Power for/ })).toHaveValue('43');
  const restored = await settings(page);
  await expect(restored.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
  await restored.getByRole('button', { name: 'Done', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('recovered-job.png') });
});
