import { expect, test } from './fixtures/kerfdesk-test';
import { expectMachineToolContainment } from './fixtures/machine-tools-layout';
import {
  connectMachineAndDismissFirstSetup,
  machineJogAction,
  openMachineToolDropdown,
  selectWorkspacePanel,
} from './fixtures/workspace-ui';

test('tool switching and Escape preserve unsent console and position drafts', async ({
  page,
  kerfdesk,
}) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/');
  await selectWorkspacePanel(page, 'Machine');
  await connectMachineAndDismissFirstSetup(page);
  const consoleTab = page.getByRole('button', { name: 'Console', exact: true });
  await consoleTab.focus();
  await consoleTab.press('ArrowDown');
  const consolePanel = page.getByRole('region', { name: 'Console', exact: true });
  await expect(consolePanel).toBeVisible();
  const command = consolePanel.getByRole('textbox', { name: 'Console command', exact: true });
  const draft = 'G0 X123.456 Y78.9';
  await command.fill(draft);
  await consolePanel.getByRole('checkbox', { name: 'Show status', exact: true }).check();
  await page
    .getByLabel('KerfDesk workspace', { exact: true })
    .click({ position: { x: 100, y: 100 } });
  await expect(consolePanel).toBeVisible();
  await expect(command).toHaveValue(draft);
  const origin = await openMachineToolDropdown(page, 'Origin');
  await expect(consolePanel).not.toBeVisible();
  await expect(consoleTab).toHaveAttribute('aria-expanded', 'false');
  await origin
    .locator('summary')
    .filter({ hasText: /^Move to position$/ })
    .click();
  const savedName = origin.getByRole('textbox', { name: 'Saved position name', exact: true });
  await savedName.fill('Next fixture');
  await savedName.press('Escape');
  await expect(origin).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Origin', exact: true })).toBeFocused();
  const placement = await openMachineToolDropdown(page, 'Placement & output');
  await expect(placement.getByRole('combobox', { name: 'Start from', exact: true })).toBeVisible();
  await openMachineToolDropdown(page, 'Console');
  await expect(placement).not.toBeVisible();
  await expect(command).toHaveValue(draft);
  await expect(
    consolePanel.getByRole('checkbox', { name: 'Show status', exact: true }),
  ).toBeChecked();
  await command.press('Escape');
  await expect(consolePanel).not.toBeVisible();
  await expect(consoleTab).toBeFocused();
  await openMachineToolDropdown(page, 'Origin');
  await expect(savedName).toHaveValue('Next fixture');
  await page.keyboard.press('Escape');
  expect(
    (await kerfdesk.events()).filter(
      (event) => event.kind === 'serial-write' && String(event['text']).trim() === draft,
    ),
  ).toEqual([]);
});

test('expanded console stays a global usable modal above the inline utility scrollport', async ({
  page,
  kerfdesk,
}, info) => {
  const viewport = { width: 1536, height: 900 };
  await page.setViewportSize(viewport);
  await page.goto('/');
  await selectWorkspacePanel(page, 'Machine');
  await connectMachineAndDismissFirstSetup(page);
  const consolePanel = await openMachineToolDropdown(page, 'Console');
  const draft = consolePanel.getByRole('textbox', { name: 'Console command', exact: true });
  await draft.fill('G0 X123.456 Y78.9');
  await consolePanel.getByRole('button', { name: 'Super console', exact: true }).click();
  const expanded = page.getByRole('dialog', { name: 'Super console', exact: true });
  await expect(expanded).toBeVisible();
  await page.screenshot({ path: info.outputPath('inline-super-console.png') });
  const bounds = await expanded.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) throw new Error('Expanded console has no backdrop bounds');
  expect(bounds.x).toBeCloseTo(0, 0);
  expect(bounds.y).toBeCloseTo(0, 0);
  expect(bounds.width).toBeCloseTo(viewport.width, 0);
  expect(bounds.height).toBeCloseTo(viewport.height, 0);
  const command = expanded.getByRole('textbox', { name: 'Console command', exact: true });
  await command.focus();
  await expect(command).toBeFocused();
  await command.press('Tab');
  expect(await expanded.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await expanded.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(expanded).toHaveCount(0);
  await expect(consolePanel).toBeVisible();
  await expect(draft).toHaveValue('G0 X123.456 Y78.9');
  expect(
    (await kerfdesk.events()).filter(
      (event) =>
        event.kind === 'serial-write' && String(event['text']).trim() === 'G0 X123.456 Y78.9',
    ),
  ).toEqual([]);
});

for (const theme of ['light', 'dark'] as const) {
  test(`inline machine tools stay below navigation and clear of artwork in ${theme} theme`, async ({
    page,
    kerfdesk,
  }, info) => {
    await page.addInitScript((value) => localStorage.setItem('kerfdesk.theme.v1', value), theme);
    await page.setViewportSize({ width: 1536, height: 900 });
    await page.goto('/');
    await selectWorkspacePanel(page, 'Machine');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const rail = page.getByLabel('Laser controls', { exact: true });
    await expect
      .poll(() => rail.evaluate((element) => element.scrollHeight <= element.clientHeight + 1))
      .toBe(true);
    await expect(machineJogAction(page, 'Set up homing')).toBeVisible();
    await expect(machineJogAction(page, 'Set up auto-focus')).toBeVisible();
    await expect(machineJogAction(page, 'Set origin here')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Turn manual air assist on/ })).toBeVisible();
    const tabs = page.getByRole('group', { name: 'Machine tool dropdowns', exact: true });
    await expect(tabs.getByRole('button')).toHaveCount(3);
    for (const viewport of [
      { width: 1536, height: 900 },
      { width: 1366, height: 900 },
      { width: 640, height: 450 },
    ]) {
      await page.setViewportSize(viewport);
      await selectWorkspacePanel(page, 'Machine');
      for (const tab of await tabs.getByRole('button').all()) {
        await expect
          .poll(() => tab.evaluate((element) => element.scrollWidth <= element.clientWidth + 1))
          .toBe(true);
      }
      for (const name of ['Origin', 'Placement & output', 'Console'] as const) {
        const panel = await openMachineToolDropdown(page, name);
        if (viewport.height < 600) await panel.scrollIntoViewIfNeeded();
        await expectMachineToolContainment(page, panel, viewport.height < 600);
        const close = panel.getByRole('button', { name: `Close ${name}`, exact: true });
        await close.scrollIntoViewIfNeeded();
        await expect(close).toBeVisible();
        await page.screenshot({
          path: info.outputPath(`inline-${name.split(' ')[0]}-${theme}-${viewport.width}.png`),
        });
        await close.click();
        await expect(page.getByRole('button', { name, exact: true })).toBeFocused();
      }
    }
    expect((await kerfdesk.events()).filter((event) => event.kind === 'serial-write')).toEqual([]);
  });
}
