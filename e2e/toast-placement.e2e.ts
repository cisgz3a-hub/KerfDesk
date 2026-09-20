import { expect, test, type Page } from '@playwright/test';

async function notify(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const path = '/src/ui/state/toast-store.ts';
    const { useToastStore } = await import(/* @vite-ignore */ path);
    useToastStore.getState().pushToast('Check the fixture before continuing.', 'warning');
  });
}

test('notifications stay inside the available canvas and clear of the laptop job dock', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto('/');
  await expect(page.locator('#app-splash')).toHaveCount(0, { timeout: 10_000 });
  await notify(page);
  const notice = page.getByRole('button', {
    name: /Dismiss warning notification: Check the fixture/,
  });
  await expect(notice).toBeInViewport({ ratio: 1 });
  const noticeBounds = await notice.boundingBox();
  const canvasBounds = await page.locator('[data-toast-workspace]').boundingBox();
  const dockBounds = await page.getByRole('region', { name: 'Job actions' }).boundingBox();
  expect(noticeBounds).not.toBeNull();
  expect(canvasBounds).not.toBeNull();
  expect(dockBounds).not.toBeNull();
  expect(noticeBounds?.x ?? 0).toBeGreaterThanOrEqual(canvasBounds?.x ?? 0);
  expect((noticeBounds?.x ?? 0) + (noticeBounds?.width ?? 0)).toBeLessThanOrEqual(
    dockBounds?.x ?? 0,
  );
  expect((noticeBounds?.y ?? 0) + (noticeBounds?.height ?? 0)).toBeLessThanOrEqual(
    (canvasBounds?.y ?? 0) + (canvasBounds?.height ?? 0),
  );
});

test('Machine Setup reserves space for notices without covering its controls or losing focus', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Machine', exact: true }).click();
  await page.getByRole('button', { name: 'Machine Setup', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Machine Setup', exact: true });
  await expect(dialog.locator(':focus')).toHaveCount(1);
  await notify(page);
  const notice = dialog.getByRole('button', {
    name: /Dismiss warning notification: Check the fixture/,
  });
  await expect(notice).toBeInViewport({ ratio: 1 });
  await expect(dialog.locator(':focus')).toHaveCount(1);
  await notice.click();
  await expect(notice).toHaveCount(0);
  await expect(dialog.locator(':focus')).toHaveCount(1);
  const next = dialog.getByRole('button', { name: 'Next', exact: true });
  await next.scrollIntoViewIfNeeded();
  await expect(next).toBeInViewport({ ratio: 1 });
  await next.click();
  await expect(dialog).toContainText('Step 2 of 6 — Choose your machine');
});
