import { test, expect, type Locator, type Page } from './fixtures/kerfdesk-test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('banner', { name: 'Toolbar' })).toContainText('KerfDesk');
  await expect(page.locator('#app-splash')).toHaveCount(0, { timeout: 10_000 });
});

test.describe('workspace shell acceptance', () => {
  test('supports keyboard focus and disclosure controls at laptop size', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 700 });

    const newButton = page.getByRole('button', { name: 'New', exact: true });
    const openButton = page.getByRole('button', { name: 'Open...', exact: true });
    await newButton.focus();
    await page.keyboard.press('Tab');
    await expect(openButton).toBeFocused();
    await expectFocusRing(openButton);

    const collapseLayers = page.getByRole('button', {
      name: 'Collapse Cuts / Layers panel',
      exact: true,
    });
    await collapseLayers.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Cuts / Layers panel collapsed')).toBeVisible();

    const expandLayers = page.getByRole('button', {
      name: 'Expand Cuts / Layers panel',
      exact: true,
    });
    await expandLayers.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Cuts / Layers panel', { exact: true })).toBeVisible();

    await expect(page.getByLabel('Laser controls collapsed')).toBeVisible();
    const expandMachine = page.getByRole('button', {
      name: 'Expand Laser panel',
      exact: true,
    });
    await expandMachine.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Laser controls', { exact: true })).toBeVisible();

    const consoleDetails = page
      .locator('aside[aria-label="Laser controls"] details')
      .filter({ hasText: 'Console' });
    await expect(consoleDetails).not.toHaveAttribute('open', '');
    const consoleSummary = consoleDetails.locator('summary');
    await consoleSummary.focus();
    await page.keyboard.press('Enter');
    await expect(consoleDetails).toHaveAttribute('open', '');

    await expectInsideViewport(page, page.getByRole('button', { name: 'Frame', exact: true }));
    await expectInsideViewport(page, page.getByRole('button', { name: 'Start job', exact: true }));
    await expectInsideViewport(page, page.getByRole('contentinfo', { name: 'Status bar' }));
    await page.getByRole('button', { name: 'Collapse Laser panel', exact: true }).click();
  });

  test('keeps a usable overflow-free canvas at compact sizes', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 450 });

    await expect(page.getByLabel('Cuts / Layers panel collapsed')).toBeVisible();
    await expect(page.getByLabel('Laser controls collapsed')).toBeVisible();
    await expectNoPageOverflow(page);
    await expectInsideViewport(page, page.getByRole('contentinfo', { name: 'Status bar' }));
    await expectOneToolbarRow(page);

    const canvas = page.locator('canvas[aria-label="KerfDesk workspace"]');
    const compactBox = await canvas.boundingBox();
    expect(compactBox?.width ?? 0).toBeGreaterThan(400);
    expect(compactBox?.height ?? 0).toBeGreaterThan(200);

    const expandMachine = page.getByRole('button', {
      name: 'Expand Laser panel',
      exact: true,
    });
    await expandMachine.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Laser controls', { exact: true })).toBeVisible();
    expect((await canvas.boundingBox())?.width ?? 0).toBeGreaterThan(150);

    await page.setViewportSize({ width: 1024, height: 700 });
    await page.setViewportSize({ width: 640, height: 450 });
    await expect(page.getByLabel('Laser controls collapsed')).toBeVisible();
    await expectNoPageOverflow(page);
  });

  test('toggles and resets the workspace layout with familiar controls', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 700 });

    await page.keyboard.press('F12');
    await expect(page.getByLabel('Cuts / Layers panel collapsed')).toBeVisible();
    await expect(page.getByLabel('Laser controls collapsed')).toBeVisible();

    await page.keyboard.press('F12');
    await expect(page.getByLabel('Cuts / Layers panel', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Laser controls', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Collapse Cuts / Layers panel', exact: true }).click();
    await page.getByRole('button', { name: 'Collapse Laser panel', exact: true }).click();
    await page.getByText('Window', { exact: true }).click();
    await page.getByRole('menuitem', { name: 'Reset Workspace Layout', exact: true }).click();

    await expect(page.getByLabel('Cuts / Layers panel', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Laser controls', { exact: true })).toBeVisible();
  });

  test('renders a nonblank workspace in Chromium canvas', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 700 });
    const canvas = page.locator('canvas[aria-label="KerfDesk workspace"]');
    await expect(canvas).toBeVisible();

    await expect
      .poll(() => canvas.evaluate(countSampledCanvasColors), { timeout: 10_000 })
      .toBeGreaterThan(3);
  });

  test('names visible controls and exposes operator help', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 700 });
    expect(await unnamedVisibleControls(page)).toEqual([]);

    await page.getByText('Help', { exact: true }).click();
    await expect(page.getByRole('menuitem', { name: /connect|troubleshoot/i })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /safety/i })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /about kerfdesk/i })).toBeVisible();
  });
});

async function expectFocusRing(locator: Locator): Promise<void> {
  const focus = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { visible: element.matches(':focus-visible'), width: style.outlineWidth };
  });
  expect(focus.visible).toBe(true);
  expect(Number.parseFloat(focus.width)).toBeGreaterThanOrEqual(2);
}

async function expectInsideViewport(page: Page, locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport?.height ?? 0);
}

async function expectNoPageOverflow(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  expect(widths.body).toBeLessThanOrEqual(widths.viewport);
}

async function expectOneToolbarRow(page: Page): Promise<void> {
  const rows = await page
    .getByLabel('Toolbar', { exact: true })
    .locator('button')
    .evaluateAll(
      (buttons) =>
        new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().top))).size,
    );
  expect(rows).toBe(1);
}

function countSampledCanvasColors(canvas: HTMLCanvasElement): number {
  const context = canvas.getContext('2d');
  if (context === null || canvas.width === 0 || canvas.height === 0) return 0;
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const colors = new Set<number>();
  const pixelCount = pixels.length / 4;
  const stride = Math.max(1, Math.floor(pixelCount / 8_000));
  for (let pixel = 0; pixel < pixelCount; pixel += stride) {
    const offset = pixel * 4;
    const red = pixels[offset] ?? 0;
    const green = pixels[offset + 1] ?? 0;
    const blue = pixels[offset + 2] ?? 0;
    const alpha = pixels[offset + 3] ?? 0;
    colors.add(((red * 256 + green) * 256 + blue) * 256 + alpha);
    if (colors.size > 3) break;
  }
  return colors.size;
}

async function unnamedVisibleControls(page: Page): Promise<readonly string[]> {
  return page.locator('button, input, select, textarea, summary, a[href]').evaluateAll((elements) =>
    elements.flatMap((element, index) => {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return [];
      if (element.getClientRects().length === 0) return [];
      const labelledBy = element.getAttribute('aria-labelledby');
      const labelledText = labelledBy
        ?.split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ');
      const labelText =
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement
          ? [...element.labels].map((label) => label.textContent ?? '').join(' ')
          : '';
      const name = [
        element.getAttribute('aria-label'),
        labelledText,
        labelText,
        element.textContent,
        element.getAttribute('title'),
        element.getAttribute('alt'),
      ]
        .filter((value): value is string => value !== null && value !== undefined)
        .join(' ')
        .trim();
      return name === '' ? [`${element.tagName.toLowerCase()}[${index}]`] : [];
    }),
  );
}
