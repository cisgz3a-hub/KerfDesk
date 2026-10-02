import { expect, test, type Page } from './fixtures/kerfdesk-test';
import { toolbarCommand } from './fixtures/workspace-ui';

test('New and a renderer restart retain committed machine setup while new artwork has fresh process defaults', async ({
  page,
  kerfdesk,
}) => {
  await page.setViewportSize({ width: 1536, height: 864 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open...', exact: true }).click();
  await expect(page).toHaveTitle(/project-basic\.lf2/);
  await page.getByRole('button', { name: 'Machine Setup', exact: true }).click();
  const setup = page.getByRole('dialog', { name: 'Machine Setup', exact: true });
  await setup.getByRole('button', { name: 'Check essentials', exact: true }).click();
  for (const [label, value] of [
    ['Bed width (mm)', '321'],
    ['Bed height (mm)', '234'],
    ['GRBL $30 max power S', '900'],
  ] as const) {
    const input = setup.getByRole('spinbutton', { name: label, exact: true });
    await input.fill(value);
    await input.press('Tab');
  }
  await setup.getByRole('button', { name: 'Review setup', exact: true }).click();
  await setup.getByRole('button', { name: 'Save machine setup', exact: true }).click();
  await expect(setup).toBeHidden();
  const panel = page.getByRole('complementary', {
    name: 'Artwork / Operations panel',
    exact: true,
  });
  for (const [name, value] of [
    [/^Power for/, '73'],
    [/^Speed for/, '987'],
    [/^Passes for/, '3'],
  ] as const) {
    const input = panel.getByRole('spinbutton', { name });
    await input.fill(value);
    await input.press('Tab');
  }
  await panel.getByRole('checkbox', { name: /^Output / }).uncheck();
  await newCanvas(page);
  await expectSavedMachine(page);
  await importFreshArtwork(page, kerfdesk.setOpenFiles);
  await expect(panel.getByRole('spinbutton', { name: /^Power for/ })).toHaveValue('30');
  await expect(panel.getByRole('spinbutton', { name: /^Speed for/ })).toHaveValue('1500');
  await expect(panel.getByRole('spinbutton', { name: /^Passes for/ })).toHaveValue('1');
  await expect(panel.getByRole('checkbox', { name: /^Output / })).toBeChecked();
  await newCanvas(page);
  await page.reload();
  await expect(page.getByLabel('KerfDesk workspace', { exact: true })).toBeVisible();
  await expectSavedMachine(page);
  expect((await kerfdesk.events()).filter((event) => event.kind === 'serial-write')).toEqual([]);
});

async function newCanvas(page: Page): Promise<void> {
  const before = await page.title();
  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New Ctrl+N', exact: true }).click();
  const discard = page.getByRole('dialog', { name: 'Save changes?', exact: true });
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: "Don't Save", exact: true }).click();
  await expect(page).not.toHaveTitle(before);
  await expect(page.getByLabel('Selection width', { exact: true })).toBeDisabled();
}

async function expectSavedMachine(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Machine Setup', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Machine Setup', exact: true });
  await dialog.getByRole('button', { name: 'Check essentials', exact: true }).click();
  for (const [label, value] of [
    ['Bed width (mm)', '321'],
    ['Bed height (mm)', '234'],
    ['GRBL $30 max power S', '900'],
  ] as const) {
    await expect(dialog.getByRole('spinbutton', { name: label, exact: true })).toHaveValue(value);
  }
  await dialog.getByRole('button', { name: 'Cancel without saving', exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function importFreshArtwork(
  page: Page,
  setOpenFiles: (files: readonly { name: string; text: string }[]) => Promise<void>,
): Promise<void> {
  await setOpenFiles([
    {
      name: 'fresh.svg',
      text: '<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="20mm" viewBox="0 0 20 20"><path d="M2 2H18V18H2Z" fill="none" stroke="#ff0000"/></svg>',
    },
  ]);
  await (await toolbarCommand(page, 'Import...')).click();
  await expect(page.getByRole('spinbutton', { name: /^Power for/ })).toBeVisible();
}
