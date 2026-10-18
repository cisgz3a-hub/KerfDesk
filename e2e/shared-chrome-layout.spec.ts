import { expect, test } from './fixtures/kerfdesk-test';
import { openMachineToolDropdown, toolbarCommand } from './fixtures/workspace-ui';

// Shared chrome layout at a desktop size where the Artwork and Machine rails
// sit side by side, so the Machine panel has its default 300px width.
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 960 });
  await page.goto('/');
  await (await toolbarCommand(page, 'Open...')).click();
  await expect(page).toHaveTitle(/project-basic\.lf2/, { timeout: 30_000 });
  await expect(page.getByRole('spinbutton', { name: /^Power for/ })).toBeVisible();
});

test('a scrolled dialog keeps its footer on the bottom edge', async ({ page }) => {
  const panel = page.getByRole('complementary', {
    name: 'Artwork / Operations panel',
    exact: true,
  });
  await panel.getByRole('button', { name: 'More cut settings', exact: true }).click();
  await expect(page.getByRole('dialog', { name: /^Cut settings for/ })).toBeVisible();

  const gap = await page.locator('.lf-dialog').evaluate((dialog) => {
    dialog.scrollTop = 140;
    const actions = dialog.querySelector(':scope > .lf-dialog-actions');
    if (actions === null) throw new Error('Cut settings has no footer');
    const border = Number.parseFloat(getComputedStyle(dialog).borderBottomWidth);
    return dialog.getBoundingClientRect().bottom - border - actions.getBoundingClientRect().bottom;
  });
  // Before the fix the footer stopped 16px short and rows showed beneath it.
  expect(Math.abs(gap)).toBeLessThanOrEqual(1);
});

test('Settings keeps one size across sections and scrolls only the section', async ({ page }) => {
  await page.getByRole('button', { name: 'More commands', exact: true }).focus();
  await page.keyboard.press('ControlOrMeta+,');
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(settings).toBeVisible();

  const sizes = new Set<string>();
  const tabHeights = new Set<number>();
  for (const tab of await settings.getByRole('tab').all()) {
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    const box = await page.locator('.lf-dialog').evaluate((dialog) => {
      const rect = dialog.getBoundingClientRect();
      return {
        size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
        panelScrolls: dialog.scrollHeight > dialog.clientHeight,
      };
    });
    sizes.add(box.size);
    expect(box.panelScrolls).toBe(false);
    tabHeights.add(Math.round((await tab.boundingBox())?.height ?? 0));
  }
  expect([...sizes]).toHaveLength(1);
  // "Machine & materials" wrapped onto two lines in a 160px section list.
  expect([...tabHeights]).toHaveLength(1);
});

test('app menus keep every command on one line inside the window', async ({ page }) => {
  const families = await page
    .locator('[data-menu-family-summary]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-menu-family-summary')));
  expect(families.length).toBeGreaterThan(0);
  for (const family of families) {
    await page.locator(`[data-menu-family-summary="${family}"]`).click();
    const menu = page.locator(`[data-family-menu="${family}"]`);
    await expect(menu).toBeVisible();
    const fit = await menu.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const heights = [...element.querySelectorAll('.lf-menu-item')].map(
        (item) => item.getBoundingClientRect().height,
      );
      return {
        insideWindow: rect.bottom <= window.innerHeight && rect.right <= window.innerWidth,
        wrapped: Math.max(...heights) - Math.min(...heights) > 2,
      };
    });
    expect(fit, family ?? '').toEqual({ insideWindow: true, wrapped: false });
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  }
});

test('Placement selects show their whole value in a default Machine panel', async ({ page }) => {
  const placement = await openMachineToolDropdown(page, 'Placement & output');
  for (const label of ['Start from', 'Line burn start near']) {
    const select = placement.getByRole('combobox', { name: label, exact: true });
    expect(await select.evaluate(clippedBy), label).toBeLessThanOrEqual(0);
  }
});

// How many pixels narrower the select is than at its natural width, which
// fits its longest option and the arrow. Runs in the page.
function clippedBy(select: HTMLElement): number {
  const natural = select.cloneNode(true) as HTMLElement;
  Object.assign(natural.style, {
    position: 'absolute',
    width: 'auto',
    minWidth: '0',
    flex: 'none',
    visibility: 'hidden',
  });
  select.parentElement?.append(natural);
  const shortfall = natural.offsetWidth - select.offsetWidth;
  natural.remove();
  return shortfall;
}
