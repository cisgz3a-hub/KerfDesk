import { test, expect, type Locator, type Page } from './fixtures/kerfdesk-test';

const viewports = [
  { width: 1920, height: 1080, layout: 'spacious' },
  { width: 1536, height: 864, layout: 'spacious' },
  { width: 1366, height: 668, layout: 'compact' },
  { width: 1280, height: 620, layout: 'compact' },
  { width: 1024, height: 600, layout: 'compact' },
  { width: 1536, height: 650, layout: 'compact' },
] as const;

for (const viewport of viewports) {
  test(`workspace fits ${viewport.width}x${viewport.height} without browser zoom`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize(viewport);
    await page.goto('/');
    const panels = page.getByRole('region', { name: 'Workspace side panels' });
    await expect(panels).toHaveAttribute('data-layout', viewport.layout);
    await expectWithinViewport(page, panels);
    await expectWithinViewport(page, page.getByRole('region', { name: 'Job actions' }));
    await expectWithinViewport(page, page.getByRole('button', { name: 'Frame job', exact: true }));
    await expectWithinViewport(page, page.getByRole('button', { name: 'Set up & Frame' }));
    await expectWithinViewport(page, page.getByRole('group', { name: 'Workspace status details' }));
    const canvas = await page.getByLabel('KerfDesk workspace', { exact: true }).boundingBox();
    expect(canvas?.width).toBeGreaterThan(viewport.width * 0.5);
    await expectNoPageOverflow(page);
    for (const button of await page.locator('.lf-toolbar-shell button:visible').all()) {
      await expectWithinViewport(page, button);
    }
    if (viewport.layout === 'compact') {
      await page.getByRole('tab', { name: 'Machine', exact: true }).click();
    }
    const dock = page.getByRole('region', { name: 'Job actions' });
    const dockBeforeScroll = await dock.boundingBox();
    const machine = page.getByLabel('Laser controls', { exact: true });
    await expect(machine).toBeVisible();
    await machine.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    expect(await dock.boundingBox()).toEqual(dockBeforeScroll);
    await expectWithinViewport(page, dock);
    await expectNoPageOverflow(page);
    if (viewport.layout === 'compact') {
      await page.getByRole('tab', { name: 'Artwork', exact: true }).click();
      await expect(dock).toHaveCount(1);
      await expectWithinViewport(page, dock);
    }
    expect(errors).toEqual([]);
  });
}

test('layout preference survives reload, constrains narrow windows and resets from Window menu', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1536, height: 864 });
  await page.goto('/');
  const layout = page.getByRole('button', { name: 'Workspace layout', exact: true });
  const panels = page.getByRole('region', { name: 'Workspace side panels' });
  await chooseLayout(page, 'Compact');
  await expect(panels).toHaveAttribute('data-layout', 'compact');
  await page.reload();
  await expect(layout).toContainText('Compact');
  await expect(panels).toHaveAttribute('data-layout', 'compact');
  await chooseLayout(page, 'Spacious');
  await page.setViewportSize({ width: 900, height: 650 });
  await expect(panels).toHaveAttribute('data-layout', 'compact');
  await expect(layout).toContainText('Spacious');
  await page.setViewportSize({ width: 1536, height: 864 });
  await expect(panels).toHaveAttribute('data-layout', 'spacious');
  await page.getByRole('button', { name: 'Machine', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Window', exact: true }).click();
  // Anchored at the start of the label, the same way the rest of the suite
  // anchors /^Connect/ and friends.
  await page.getByRole('menuitem', { name: /^Reset Workspace Layout/i }).click();
  await expect(layout).toContainText('Auto layout');
  await expect(page.getByLabel('Laser controls', { exact: true })).toBeVisible();
  await expectWithinViewport(page, page.getByRole('region', { name: 'Job actions' }));
});

test('overflow commands and all nine anchors remain reachable on a short laptop', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.goto('/');
  const more = page.getByRole('button', { name: 'More commands', exact: true });
  await more.focus();
  await more.press('ArrowDown');
  const menu = page.getByRole('menu', { name: 'More commands' });
  await expectWithinViewport(page, menu);
  await expect(menu.getByRole('menuitem', { name: 'Box Generator...' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Save G-code...' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();
  await page.getByRole('button', { name: 'Open...', exact: true }).click();
  await expect(page.getByText('Objects: 1', { exact: true })).toBeVisible();
  await page.keyboard.press('Control+a');
  const anchor = page.getByRole('button', { name: 'Choose transform anchor' });
  await expect(anchor).toBeEnabled();
  await anchor.click();
  const picker = page.getByRole('dialog', { name: 'Transform anchor', exact: true });
  await expectWithinViewport(page, picker);
  await expect(picker.getByRole('button')).toHaveCount(9);
  await picker.getByRole('button', { name: 'Transform anchor: bottom right', exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect(anchor).toBeFocused();
  await expect(anchor).toHaveAttribute('title', /bottom right/);
});

test('short dark workspace keeps the tool rail scrollable and machine modes accessible', async ({
  page,
}) => {
  await useThemePreference(page, 'dark');
  await page.setViewportSize({ width: 1024, height: 500 });
  await page.goto('/');
  const designStudio = page.getByRole('button', { name: 'Open Design Studio', exact: true });
  await designStudio.focus();
  await expectWithinViewport(page, designStudio);
  await designStudio.click();
  await expect(page.getByRole('dialog', { name: 'Design Studio', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'CNC', exact: true }).click();
  await page.getByRole('tab', { name: 'Machine', exact: true }).click();
  await expect(page.getByLabel('Router controls', { exact: true })).toBeVisible();
  await expectWithinViewport(page, page.getByRole('region', { name: 'Job actions' }));
  await expectNoPageOverflow(page);
});

// ADR-339: the desktop no longer decides the theme. A dark-mode machine must
// still open light, and Window > Appearance is the only route to dark.
test('opens light on a dark desktop, and Window > Appearance reaches dark', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  const canvas = page.getByLabel('KerfDesk workspace', { exact: true });
  await expect.poll(() => bedBrightness(canvas)).toBeGreaterThan(190);
  await chooseAppearance(page, 'Dark');
  await expect.poll(() => bedBrightness(canvas)).toBeLessThan(90);
  await chooseAppearance(page, 'Light');
  await expect.poll(() => bedBrightness(canvas)).toBeGreaterThan(190);
});

test('Match System follows the desktop, including live theme changes', async ({ page }) => {
  await useThemePreference(page, 'system');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  const canvas = page.getByLabel('KerfDesk workspace', { exact: true });
  await expect.poll(() => bedBrightness(canvas)).toBeLessThan(90);
  await page.getByRole('button', { name: 'Workspace layout', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Workspace layout options' });
  await expectWithinViewport(page, menu);
  const background = await menu.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(background).toBe('rgb(37, 35, 32)');
  await expect(menu.getByRole('menuitemradio', { name: 'Auto layout' })).toBeChecked();
  await page.keyboard.press('Escape');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(() => bedBrightness(canvas)).toBeGreaterThan(190);
});

// Seeded before the first navigation, the way a returning operator's stored
// choice arrives. The checkmark glyph beside a chosen item is aria-hidden, so
// these accessible names stay exactly 'Light' / 'Dark' / 'Match System'.
async function useThemePreference(
  page: Page,
  preference: 'light' | 'dark' | 'system',
): Promise<void> {
  await page.addInitScript((value) => {
    try {
      localStorage.setItem('kerfdesk.theme.v1', value);
    } catch {
      // Storage denied: light stands, and the assertions will say so.
    }
  }, preference);
}

async function chooseAppearance(page: Page, name: string): Promise<void> {
  // Choosing closes the menu, but Escape first keeps this safe to call twice.
  await page.keyboard.press('Escape');
  await page.getByRole('menuitem', { name: 'Window', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name, exact: true }).click();
}

async function chooseLayout(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Workspace layout', exact: true }).click();
  await page.getByRole('menuitemradio', { name, exact: true }).click();
}

async function bedBrightness(canvas: Locator): Promise<number> {
  return canvas.evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error('Workspace canvas missing');
    const pixels = element
      .getContext('2d')
      ?.getImageData(element.width / 2, element.height * 0.6, 1, 1).data;
    if (pixels === undefined || pixels[3] !== 255) throw new Error('Bed has not painted');
    return ((pixels[0] ?? 0) + (pixels[1] ?? 0) + (pixels[2] ?? 0)) / 3;
  });
}

async function expectWithinViewport(page: Page, locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  if (box === null || viewport === null) throw new Error('Visible control has no viewport bounds');
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function expectNoPageOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth - innerWidth,
    height: document.documentElement.scrollHeight - innerHeight,
  }));
  expect(overflow.width).toBeLessThanOrEqual(1);
  expect(overflow.height).toBeLessThanOrEqual(1);
}
