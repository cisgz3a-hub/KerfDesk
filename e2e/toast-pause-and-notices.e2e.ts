// ADR-708 in a real browser: what jsdom cannot show. A toast waits while the
// pointer is over it without becoming a pointer target, and the status bar's
// Notices list brings back a warning whose toast is gone, without covering
// the job controls.
import { expect, test, type Page } from '@playwright/test';

const WARNING = 'Check the fixture before continuing.';

async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.locator('#app-splash')).toHaveCount(0, { timeout: 20_000 });
}

async function warn(page: Page): Promise<void> {
  await page.evaluate(async (message) => {
    const path = '/src/ui/state/toast-store.ts';
    const { useToastStore } = await import(/* @vite-ignore */ path);
    useToastStore.getState().pushToast(message, 'warning');
  }, WARNING);
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

test('a toast waits under the pointer, lets a press through to the canvas, then leaves', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await open(page);
  await warn(page);
  const toast = page.locator('.lf-toast');
  await expect(toast).toHaveCount(1);
  const box = await toast.boundingBox();
  if (box === null) throw new Error('The toast has no box');
  const point = { x: box.x + 40, y: box.y + box.height / 2 };
  await page.mouse.move(point.x, point.y);

  // Its eight seconds pass while the pointer rests on it.
  await page.waitForTimeout(9_500);
  await expect(toast).toHaveCount(1);
  // The body is still not a pointer target: the canvas is what is under the pointer.
  const underPointer = await page.evaluate(({ x, y }) => {
    const hit = document.elementFromPoint(x, y);
    return {
      inToast: document.querySelector('.lf-toast')?.contains(hit) === true,
      inCanvas: document.querySelector('[data-toast-workspace]')?.contains(hit) === true,
    };
  }, point);
  expect(underPointer).toEqual({ inToast: false, inCanvas: true });

  await page.mouse.move(5, 5);
  await expect(toast).toHaveCount(0, { timeout: 20_000 });
});

test('Notices brings back a dismissed warning, inside the canvas area, and Escape closes it', async ({
  page,
}) => {
  await open(page);
  await expect(page.getByRole('button', { name: /^Notices/ })).toHaveCount(0);
  await warn(page);
  await page
    .getByRole('button', { name: /Dismiss warning notification: Check the fixture/ })
    .click();
  await expect(page.locator('.lf-toast')).toHaveCount(0);

  await page.getByRole('button', { name: 'Notices (1 new)', exact: true }).click();
  const list = page.getByRole('region', { name: 'Notices from this session', exact: true });
  await expect(list).toContainText(WARNING);
  await expect(list).toBeFocused();
  const control = page.getByRole('button', { name: 'Notices', exact: true });
  await expect(control).toHaveAttribute('aria-expanded', 'true');

  const listBox = await list.boundingBox();
  const canvas = await page.locator('[data-toast-workspace]').boundingBox();
  if (listBox === null || canvas === null) throw new Error('The list or the canvas has no box');
  expect(listBox.x).toBeGreaterThanOrEqual(canvas.x);
  expect(listBox.x + listBox.width).toBeLessThanOrEqual(canvas.x + canvas.width);
  expect(listBox.y).toBeGreaterThanOrEqual(canvas.y);
  expect(listBox.y + listBox.height).toBeLessThanOrEqual(canvas.y + canvas.height);
  for (const name of ['Frame job', 'Start']) {
    for (const button of await page.getByRole('button', { name, exact: true }).all()) {
      const buttonBox = await button.boundingBox();
      if (buttonBox !== null) expect(overlaps(listBox, buttonBox), name).toBe(false);
    }
  }
  await page.screenshot({ path: test.info().outputPath('notices-list.png') });

  await page.keyboard.press('Escape');
  await expect(list).toHaveCount(0);
  await expect(control).toBeFocused();
});
