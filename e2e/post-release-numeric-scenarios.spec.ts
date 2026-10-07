import {
  expect,
  test,
  type KerfDeskFixture,
  type Locator,
  type Page,
} from './fixtures/kerfdesk-test';
import { toolbarCommand } from './fixtures/workspace-ui';
import { readFileSync } from 'node:fs';

interface SavedProject {
  scene: {
    layers: { power: number; speed: number; passes: number; hatchSpacingMm: number }[];
    objects: { transform: { x: number; scaleX: number } }[];
  };
}

test('clearing and abandoning power and speed never saves zero or minimum feed', async ({
  page,
  kerfdesk,
}) => {
  const panel = await openProject(page);
  for (const name of [/^Power for/, /^Speed for/]) {
    const input = panel.getByRole('spinbutton', { name });
    const original = await input.inputValue();
    await blank(input);
    await input.press('Tab');
    await expect(input).toHaveValue(original);
  }
  const saved = await saveProject(page, kerfdesk);
  expect(saved.scene.layers[0]).toMatchObject({ power: 30, speed: 1500 });
  await expectNoSerial(kerfdesk);
});

test('decimal draft stays editable through multiple debounce windows and saves the completed value', async ({
  page,
  kerfdesk,
}) => {
  const panel = await openProject(page);
  const input = panel.getByRole('spinbutton', { name: /^Power for/ });
  await blank(input);
  await input.pressSequentially('0.');
  await page.waitForTimeout(650);
  // Chromium exposes a trailing decimal as "0" through input.value. The
  // following digit proves whether its native editing buffer kept the dot.
  await expect(input).toHaveValue('0');
  await input.pressSequentially('5');
  await page.waitForTimeout(650);
  await expect(input).toHaveValue('0.5');
  await input.press('Tab');
  expect((await saveProject(page, kerfdesk)).scene.layers[0]?.power).toBe(0.5);
});

test('document Undo and Redo after a blank numeric draft retire its pending timer', async ({
  page,
  kerfdesk,
}) => {
  const panel = await openProject(page);
  const input = panel.getByRole('spinbutton', { name: /^Power for/ });
  await input.fill('41');
  await input.press('Tab');
  await expect(input).toHaveValue('41');
  await blank(input);
  // Focused editors own Ctrl+Z for native text undo. Invoke document commands.
  await page
    .getByRole('group', { name: 'Edit history', exact: true })
    .getByRole('button', { name: 'Undo', exact: true })
    .click();
  await expect(input).toHaveValue('30');
  await page
    .getByRole('group', { name: 'Edit history', exact: true })
    .getByRole('button', { name: 'Redo', exact: true })
    .click();
  await expect(input).toHaveValue('41');
  await page.waitForTimeout(650);
  await input.press('Tab');
  expect((await saveProject(page, kerfdesk)).scene.layers[0]?.power).toBe(41);
});

test('a pending numeric edit cannot overwrite an opened project with the same operation IDs', async ({
  page,
  kerfdesk,
}) => {
  const panel = await openProject(page);
  const replacement = JSON.parse(
    readFileSync(new URL('./fixtures/project-basic.lf2', import.meta.url), 'utf8'),
  ) as SavedProject;
  const operation = replacement.scene.layers[0];
  if (operation === undefined) throw new Error('Operation missing');
  operation.power = 91;
  operation.speed = 2700;
  await kerfdesk.setOpenFiles([
    { name: 'replacement-numeric.lf2', text: JSON.stringify(replacement) },
  ]);
  await panel.getByRole('spinbutton', { name: /^Power for/ }).fill('62');
  await (await toolbarCommand(page, 'Open...')).click();
  await discardChangesIfAsked(page);
  await expect(page).toHaveTitle(/replacement-numeric\.lf2/);
  await page.waitForTimeout(650);
  await expect(panel.getByRole('spinbutton', { name: /^Power for/ })).toHaveValue('91');
  expect((await saveProject(page, kerfdesk)).scene.layers[0]).toMatchObject({
    power: 91,
    speed: 2700,
  });
  await expectNoSerial(kerfdesk);
});

test('Fill interval can be cleared and entered below one without a timer changing the text', async ({
  page,
  kerfdesk,
}) => {
  const panel = await openProject(page);
  await panel
    .getByRole('radiogroup', { name: /^Mode for/ })
    .getByRole('radio', { name: 'Fill', exact: true })
    .check();
  const input = panel.getByRole('spinbutton', { name: /^Hatch spacing for/ });
  await blank(input);
  await input.pressSequentially('0');
  await page.waitForTimeout(650);
  await expect(input).toHaveValue('0');
  await input.pressSequentially('.125');
  await input.press('Tab');
  await expect(input).toHaveValue('0.125');
  expect((await saveProject(page, kerfdesk)).scene.layers[0]?.hatchSpacingMm).toBe(0.125);
});

test('clamped values remain clearable and an off-grid decimal is preserved on save', async ({
  page,
  kerfdesk,
}) => {
  const panel = await openProject(page);
  const power = panel.getByRole('spinbutton', { name: /^Power for/ });
  await power.fill('999');
  await power.press('Tab');
  await expect(power).toHaveValue('100');
  await blank(power);
  await power.pressSequentially('37.25');
  await power.press('Tab');
  await expect(power).toHaveValue('37.25');
  expect((await saveProject(page, kerfdesk)).scene.layers[0]?.power).toBe(37.25);
});

test('transform expressions commit exact independent arithmetic after clearing and undo correctly', async ({
  page,
}) => {
  await openProject(page);
  const width = page.getByLabel('Selection width', { exact: true });
  await blank(width);
  await width.pressSequentially('2*(3+4)');
  await width.press('Enter');
  await expect(width).toHaveValue('14');
  await page
    .getByRole('group', { name: 'Edit history', exact: true })
    .getByRole('button', { name: 'Undo', exact: true })
    .click();
  await expect(width).toHaveValue('20');
  await width.fill('1in');
  await width.press('Tab');
  await expect(width).toHaveValue('25.4');
});

async function openProject(page: Page): Promise<Locator> {
  await page.setViewportSize({ width: 1536, height: 864 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open...', exact: true }).click();
  await expect(page).toHaveTitle(/project-basic\.lf2/, { timeout: 30_000 });
  const panel = page.getByRole('complementary', {
    name: 'Artwork / Operations panel',
    exact: true,
  });
  await expect(panel.getByRole('spinbutton', { name: /^Power for/ })).toBeVisible();
  return panel;
}

async function blank(input: Locator): Promise<void> {
  await input.focus();
  await input.press('ControlOrMeta+A');
  await input.press('Backspace');
  await expect(input).toHaveValue('');
  await input.page().waitForTimeout(650);
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
}

async function saveProject(page: Page, kerfdesk: KerfDeskFixture): Promise<SavedProject> {
  const count = Object.keys(await kerfdesk.savedFiles()).length;
  await (await toolbarCommand(page, 'Save As...')).click();
  await expect
    .poll(async () => Object.keys(await kerfdesk.savedFiles()).length)
    .toBeGreaterThan(count);
  const text = Object.values(await kerfdesk.savedFiles()).at(-1);
  if (text === undefined) throw new Error('Saved project missing');
  return JSON.parse(text) as SavedProject;
}

async function discardChangesIfAsked(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Save changes?', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: "Don't Save", exact: true }).click();
}

async function expectNoSerial(kerfdesk: KerfDeskFixture): Promise<void> {
  expect((await kerfdesk.events()).filter((event) => event.kind === 'serial-write')).toEqual([]);
}
