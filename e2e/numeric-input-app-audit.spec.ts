import { expect, test, type Locator, type Page } from './fixtures/kerfdesk-test';
import { readFileSync } from 'node:fs';
import { toolbarCommand } from './fixtures/workspace-ui';

test('operation power and speed accept keyboard retyping after every digit is removed', async ({
  page,
}) => {
  const panel = await openBasicProject(page);
  for (const field of [
    { label: /^Power for/, value: '37' },
    { label: /^Speed for/, value: '2300' },
    { label: /^Passes for/, value: '3' },
  ]) {
    const input = panel.getByRole('spinbutton', { name: field.label });
    await clearEachDigit(input);
    await input.pressSequentially(field.value, { delay: 60 });
    await expect(input).toHaveValue(field.value);
    await input.press('Tab');
    await expect(input).toHaveValue(field.value);
  }
});

test('toolbar position and size accept clear, pause and keyboard retyping', async ({ page }) => {
  await openBasicProject(page);
  for (const field of [
    { label: 'Selection X position', value: '42' },
    { label: 'Selection Y position', value: '36' },
    { label: 'Selection width', value: '25' },
    { label: 'Selection height', value: '18' },
  ]) {
    const input = page.getByLabel(field.label, { exact: true });
    await clearEachDigit(input);
    await input.pressSequentially(field.value, { delay: 60 });
    await expect(input).toHaveValue(field.value);
    await input.press('Tab');
    await expect(input).toHaveValue(field.value);
  }
});

test('mixed artwork power scale accepts explicit 100 after clearing its blank draft', async ({
  page,
  kerfdesk,
}) => {
  const project = JSON.parse(
    readFileSync(new URL('./fixtures/project-basic.lf2', import.meta.url), 'utf8'),
  ) as { scene: { objects: Record<string, unknown>[] } };
  const original = project.scene.objects[0];
  if (original === undefined) throw new Error('Numeric project fixture has no artwork');
  project.scene.objects = [
    { ...original, powerScale: 50 },
    { ...structuredClone(original), id: 'e2e-second', powerScale: 80 },
  ];
  await page.setViewportSize({ width: 1536, height: 864 });
  await page.goto('/');
  await kerfdesk.setOpenFiles([{ name: 'numeric-mixed.lf2', text: JSON.stringify(project) }]);
  await page.getByRole('button', { name: 'Open...', exact: true }).click();
  await expect(page).toHaveTitle(/numeric-mixed\.lf2/, { timeout: 30_000 });
  const menu = page.getByRole('menubar', { name: 'Application menu', exact: true });
  await menu.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await menu
    .getByRole('menuitem')
    .filter({ has: page.getByText('Select All', { exact: true }) })
    .click();
  const panel = page.getByRole('complementary', {
    name: 'Artwork / Operations panel',
    exact: true,
  });
  await panel
    .getByRole('tablist', { name: 'Edit artwork or operation', exact: true })
    .getByRole('tab', { name: 'Artwork', exact: true })
    .click();
  const input = panel.getByRole('spinbutton', {
    name: 'Power scale for selected objects',
    exact: true,
  });
  await expect(input).toHaveAttribute('placeholder', 'Mixed');
  await expect(input).toHaveValue('');
  await input.press('ControlOrMeta+A');
  await input.press('Backspace');
  await input.pressSequentially('100', { delay: 60 });
  await expect(input).toHaveValue('100');
  await input.press('Tab');
  await expect(input).toHaveValue('100');
  await expect(input).not.toHaveAttribute('data-mixed', 'true');
  await (await toolbarCommand(page, 'Save As...')).click();
  await expect.poll(async () => Object.keys(await kerfdesk.savedFiles()).length).toBeGreaterThan(0);
  const savedText = Object.values(await kerfdesk.savedFiles()).at(-1);
  if (savedText === undefined) throw new Error('Numeric mixed project was not saved');
  const saved = JSON.parse(savedText) as { scene: { objects: { powerScale?: number }[] } };
  expect(saved.scene.objects.map((object) => object.powerScale)).toEqual([100, 100]);
});

test('laser Machine Setup numbers accept clear, pause and retyping', async ({ page }) => {
  await openBasicProject(page);
  await page.getByRole('button', { name: 'Machine Setup', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Machine Setup', exact: true });
  await dialog.getByRole('button', { name: 'Check essentials', exact: true }).click();
  for (const field of [
    { label: 'Bed width (mm)', value: '510' },
    { label: 'Bed height (mm)', value: '320' },
    { label: 'GRBL $30 max power S', value: '900' },
  ]) {
    const input = dialog.getByRole('spinbutton', { name: field.label, exact: true });
    await clearEachDigit(input);
    await input.pressSequentially(field.value, { delay: 60 });
    await input.press('Tab');
    await expect(input).toHaveValue(field.value);
  }
  await dialog.getByRole('button', { name: 'Review setup', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save machine setup', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Machine Setup', exact: true }).click();
  await dialog.getByRole('button', { name: 'Check essentials', exact: true }).click();
  await expect(dialog.getByRole('spinbutton', { name: 'Bed width (mm)', exact: true })).toHaveValue(
    '510',
  );
});

test('CNC Machine Setup safe Z and RPM accept clear, pause and retyping', async ({ page }) => {
  await openBasicProject(page);
  await page.getByRole('button', { name: 'Machine Setup', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: /CNC only/ }).check();
  await dialog.getByRole('button', { name: 'Check essentials', exact: true }).click();
  for (const field of [
    { label: 'Safe Z', value: '4.5' },
    { label: 'Spindle maximum', value: '12000' },
    { label: 'Spin-up delay', value: '1.5' },
  ]) {
    const input = dialog.getByRole('spinbutton', { name: field.label, exact: true });
    await clearEachDigit(input);
    await input.pressSequentially(field.value, { delay: 60 });
    await input.press('Tab');
    await expect(input).toHaveValue(field.value);
  }
});

async function clearEachDigit(input: Locator): Promise<void> {
  await input.focus();
  await input.press('End');
  const count = (await input.inputValue()).length;
  for (let index = 0; index < count; index += 1) await input.press('Backspace');
  await expect(input).toHaveValue('');
  await input.page().waitForTimeout(450);
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
}

async function openBasicProject(page: Page): Promise<Locator> {
  await page.setViewportSize({ width: 1536, height: 864 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open...', exact: true }).click();
  await expect(page).toHaveTitle(/project-basic\.lf2/, { timeout: 30_000 });
  const sideTab = page
    .getByRole('tablist', { name: 'Side panel', exact: true })
    .getByRole('tab', { name: 'Artwork', exact: true });
  if (await sideTab.isVisible()) await sideTab.click();
  const panel = page.getByRole('complementary', {
    name: 'Artwork / Operations panel',
    exact: true,
  });
  await expect(panel.getByRole('radiogroup', { name: /^Mode for/ })).toBeVisible();
  return panel;
}
