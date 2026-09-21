import { applicationHeader } from './fixtures/workspace-ui';
import { test, expect, type Locator, type Page } from './fixtures/kerfdesk-test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(applicationHeader(page)).toContainText('KerfDesk');
  await expect(page.locator('#app-splash')).toHaveCount(0, { timeout: 10_000 });
});

test.describe('workspace shell acceptance', () => {
  test('supports keyboard focus and disclosure controls at laptop size', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 700 });

    const openButton = page.getByRole('button', { name: 'Open...', exact: true });
    const importButton = page.getByRole('button', { name: 'Import...', exact: true });
    await openButton.focus();
    await page.keyboard.press('Tab');
    await expect(importButton).toBeFocused();
    await expectFocusRing(importButton);

    const collapseLayers = page.getByRole('button', {
      name: 'Collapse Artwork / Operations panel',
      exact: true,
    });
    await collapseLayers.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Artwork / Operations panel collapsed')).toBeVisible();

    const expandLayers = page.getByRole('button', {
      name: 'Expand Artwork / Operations panel',
      exact: true,
    });
    await expandLayers.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Artwork / Operations panel', { exact: true })).toBeVisible();

    await page.getByRole('tab', { name: 'Machine', exact: true }).click();
    await expect(page.getByLabel('Laser controls', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Collapse Laser panel', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Laser controls collapsed')).toBeVisible();
    const expandMachine = page.getByRole('button', {
      name: 'Expand Laser panel',
      exact: true,
    });
    await expandMachine.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Laser controls', { exact: true })).toBeVisible();

    const consoleSummary = page.locator('aside[aria-label="Laser controls"] summary', {
      hasText: /^Console$/,
    });
    const consoleDetails = consoleSummary.locator('..');
    await expect(consoleDetails).not.toHaveAttribute('open', '');
    await consoleSummary.focus();
    await page.keyboard.press('Enter');
    await expect(consoleDetails).toHaveAttribute('open', '');

    // Maintainer constraint (ADR-225 amendment): the start and Frame actions must
    // render above the fold at laptop height without scrolling the rail —
    // placement sits below the job cluster precisely to protect this.
    await expectInsideViewport(page, page.getByRole('button', { name: 'Frame job', exact: true }));
    await expectInsideViewport(
      page,
      page.getByRole('button', { name: 'Set up & Frame', exact: true }),
    );
    await expectInsideViewport(page, page.getByRole('contentinfo', { name: 'Status bar' }));
    await page.getByRole('button', { name: 'Collapse Laser panel', exact: true }).click();
  });

  test('keeps a usable overflow-free canvas at compact sizes', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 450 });

    await expect(page.getByLabel('Artwork / Operations panel', { exact: true })).toBeVisible();
    await expectNoPageOverflow(page);
    await expectInsideViewport(page, page.getByRole('contentinfo', { name: 'Status bar' }));
    await expectUsableToolbarRows(page);

    const canvas = page.locator('canvas[aria-label="KerfDesk workspace"]');
    const compactBox = await canvas.boundingBox();
    expect(compactBox?.width ?? 0).toBeGreaterThan(300);
    expect(compactBox?.height ?? 0).toBeGreaterThan(200);

    await page.getByRole('tab', { name: 'Machine', exact: true }).click();
    await expect(page.getByLabel('Laser controls', { exact: true })).toBeVisible();
    expect((await canvas.boundingBox())?.width ?? 0).toBeGreaterThan(150);

    await page.getByRole('button', { name: 'Collapse Laser panel', exact: true }).click();
    const panels = page.getByRole('region', { name: 'Workspace side panels' });
    expect((await panels.boundingBox())?.width ?? 0).toBeLessThanOrEqual(49);
    await expect(page.getByRole('region', { name: 'Job actions' })).toHaveCount(0);
    expect((await canvas.boundingBox())?.width ?? 0).toBeGreaterThan(500);
    await page.setViewportSize({ width: 1024, height: 700 });
    await page.setViewportSize({ width: 640, height: 450 });
    await expect(page.getByLabel('Laser controls collapsed')).toBeVisible();
    expect((await panels.boundingBox())?.width ?? 0).toBeLessThanOrEqual(49);
    await expectNoPageOverflow(page);
    await page.getByRole('tab', { name: 'Machine', exact: true }).click();
    await expect(page.getByLabel('Laser controls', { exact: true })).toBeVisible();
    await expectInsideViewport(page, page.getByRole('region', { name: 'Job actions' }));
  });

  test('collapsed laptop rails return canvas space and restore through tabs, F12 and reset', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const panels = page.getByRole('region', { name: 'Workspace side panels' });
    const canvas = page.getByLabel('KerfDesk workspace', { exact: true });
    const expandedWidth = (await canvas.boundingBox())?.width ?? 0;
    await page
      .getByRole('button', { name: 'Collapse Artwork / Operations panel', exact: true })
      .click();
    expect((await panels.boundingBox())?.width ?? 0).toBeLessThanOrEqual(49);
    expect((await canvas.boundingBox())?.width ?? 0).toBeGreaterThan(expandedWidth + 250);
    await expect(page.getByRole('region', { name: 'Job actions' })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Artwork', exact: true }).click();
    await expect(page.getByLabel('Artwork / Operations panel', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Job actions' })).toBeVisible();

    await page.keyboard.press('F12');
    expect((await panels.boundingBox())?.width ?? 0).toBeLessThanOrEqual(49);
    await page.keyboard.press('F12');
    await expect(page.getByLabel('Artwork / Operations panel', { exact: true })).toBeVisible();
    await page.keyboard.press('F12');
    await page.getByRole('menuitem', { name: 'Window', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Reset Workspace Layout', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Job actions' })).toBeVisible();
    expect((await canvas.boundingBox())?.width ?? 0).toBeCloseTo(expandedWidth, 0);

    await page.setViewportSize({ width: 1024, height: 700 });
    await page.getByRole('button', { name: 'Workspace layout', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Spacious', exact: true }).click();
    await expect(panels).toHaveAttribute('data-layout', 'spacious');
    expect((await canvas.boundingBox())?.width ?? 0).toBeGreaterThan(300);
    await expectNoPageOverflow(page);
  });

  test('toggles and resets the workspace layout with familiar controls', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 700 });

    await page.keyboard.press('F12');
    await expect(page.getByLabel('Artwork / Operations panel collapsed')).toBeVisible();
    await page.keyboard.press('F12');
    await expect(page.getByLabel('Artwork / Operations panel', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Machine', exact: true }).click();
    await expect(page.getByLabel('Laser controls', { exact: true })).toBeVisible();
    await page.keyboard.press('F12');
    await expect(page.getByLabel('Laser controls collapsed')).toBeVisible();
    await page.keyboard.press('F12');
    await expect(page.getByLabel('Laser controls', { exact: true })).toBeVisible();

    await page.getByRole('tab', { name: 'Artwork', exact: true }).click();
    await expect(page.getByLabel('Artwork / Operations panel', { exact: true })).toBeVisible();
    await page
      .getByRole('button', { name: 'Collapse Artwork / Operations panel', exact: true })
      .click();
    await page.getByRole('tab', { name: 'Machine', exact: true }).click();
    await page.getByRole('button', { name: 'Collapse Laser panel', exact: true }).click();
    await page.getByText('Window', { exact: true }).click();
    await page.getByRole('menuitem', { name: 'Reset Workspace Layout', exact: true }).click();

    await expect(page.getByRole('tab', { name: 'Artwork', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByLabel('Artwork / Operations panel', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Workspace side panels' })).toHaveAttribute(
      'data-layout',
      'compact',
    );
    await expect(page.getByRole('button', { name: 'Workspace layout', exact: true })).toHaveText(
      'Auto layout',
    );
    await expect(page.getByRole('region', { name: 'Job actions' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Window', exact: true }).click();
    for (const name of ['Cuts / Layers Panel', 'Machine Controls Panel']) {
      await expect(page.getByRole('menuitemcheckbox', { name, exact: true })).toBeChecked();
    }
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: 'Machine', exact: true }).click();
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
    await expect(
      page.getByRole('menuitem', { name: "Can't connect? (Troubleshooting)", exact: true }),
    ).toBeVisible();
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

async function expectUsableToolbarRows(page: Page): Promise<void> {
  // Below 520px utilities have their own row; neither group may wrap or clip.
  for (const selector of ['.lf-toolbar-command-groups', '.lf-toolbar-utilities']) {
    const row = page.getByLabel('Toolbar', { exact: true }).locator(selector);
    const geometry = await row.evaluate((node) => ({
      bounds: node.getBoundingClientRect().toJSON() as {
        left: number;
        right: number;
        top: number;
        bottom: number;
      },
      buttons: Array.from(node.querySelectorAll('button'))
        .filter((button) => button.getClientRects().length > 0)
        .map((button) => {
          const rect = button.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            centre: rect.top + rect.height / 2,
          };
        }),
    }));
    expect(geometry.buttons.length).toBeGreaterThan(0);
    const centres = geometry.buttons.map((button) => button.centre);
    expect(Math.max(...centres) - Math.min(...centres)).toBeLessThanOrEqual(1);
    expect(geometry.bounds.left).toBeGreaterThanOrEqual(0);
    expect(geometry.bounds.right).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
    await expectInsideViewport(page, row);
    for (const button of geometry.buttons) {
      expect(button.left).toBeGreaterThanOrEqual(geometry.bounds.left - 1);
      expect(button.right).toBeLessThanOrEqual(geometry.bounds.right + 1);
      expect(button.top).toBeGreaterThanOrEqual(geometry.bounds.top - 1);
      expect(button.bottom).toBeLessThanOrEqual(geometry.bounds.bottom + 1);
    }
  }
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
          ? Array.from(element.labels ?? [])
              .map((label) => label.textContent ?? '')
              .join(' ')
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
