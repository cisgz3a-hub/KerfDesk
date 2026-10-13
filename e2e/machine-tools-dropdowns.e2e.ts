import { expect, test } from './fixtures/kerfdesk-test';
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
  const consolePanel = page.getByRole('dialog', { name: 'Console', exact: true });
  await expect(consolePanel).toBeVisible();
  const command = consolePanel.getByRole('textbox', { name: 'Console command', exact: true });
  const draft = 'G0 X123.456 Y78.9';
  await command.fill(draft);
  await consolePanel.getByRole('checkbox', { name: 'Show status', exact: true }).check();
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

for (const theme of ['light', 'dark'] as const) {
  test(`machine tools fit the normal rail and compact popup viewport in ${theme} theme`, async ({
    page,
    kerfdesk,
  }, info) => {
    await page.addInitScript((value) => localStorage.setItem('kerfdesk.theme.v1', value), theme);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto('/');
    await selectWorkspacePanel(page, 'Machine');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const tools = page.getByRole('region', { name: 'Machine tools', exact: true });
    const rail = page.getByLabel('Laser controls', { exact: true });
    for (const region of [tools, rail]) {
      await expect
        .poll(() => region.evaluate((element) => element.scrollHeight <= element.clientHeight + 1))
        .toBe(true);
    }
    await expect(machineJogAction(page, 'Set up homing')).toBeVisible();
    await expect(machineJogAction(page, 'Set up auto-focus')).toBeVisible();
    await expect(machineJogAction(page, 'Set origin here')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Turn manual air assist on/ })).toBeVisible();
    const tabs = page.getByRole('group', { name: 'Machine tool dropdowns', exact: true });
    await expect(tabs.getByRole('button')).toHaveCount(3);
    await page.screenshot({ path: info.outputPath(`machine-tabs-${theme}.png`) });
    await page.setViewportSize({ width: 640, height: 450 });
    for (const tab of await tabs.getByRole('button').all()) {
      await expect
        .poll(() => tab.evaluate((element) => element.scrollWidth <= element.clientWidth + 1))
        .toBe(true);
    }
    for (const name of ['Origin', 'Placement & output', 'Console'] as const) {
      const panel = await openMachineToolDropdown(page, name);
      const bounds = await panel.boundingBox();
      expect(bounds).not.toBeNull();
      if (!bounds) throw new Error('Tool popup has no bounds');
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(640);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(450);
      await page.screenshot({
        path: info.outputPath(`machine-${name.split(' ')[0]}-${theme}.png`),
      });
      await panel.getByRole('button', { name: `Close ${name}`, exact: true }).click();
      await expect(page.getByRole('button', { name, exact: true })).toBeFocused();
    }
    expect((await kerfdesk.events()).filter((event) => event.kind === 'serial-write')).toEqual([]);
  });
}
