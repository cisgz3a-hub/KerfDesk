import { expect, test } from '@playwright/test';
import { RENDERER_SMOKE_SOURCE } from '../electron/native-smoke-renderer';

// The packaged desktop smoke (scripts/verify-windows-packaged-native-smoke.mjs)
// evaluates this exact script in the Electron window, but only weekly, only on
// Windows, and only against a packaged build. PR #797 moved "Save As..." into
// the toolbar's More popover, and the script's missing-button error surfaced a
// week later on an unrelated commit. Running the same script against the real
// UI here fails the pull request that strands it instead.
//
// Plain Playwright, not the app fixture: the packaged window has no picker
// stubs of its own, and the script installs the same two stubs this relies on.
test('the packaged smoke script imports and saves through the real toolbar', async ({ page }) => {
  // electron/main.ts opens the BrowserWindow at 1280 x 800; its content area is
  // no larger, so this is the widest layout the packaged smoke can meet.
  await page.setViewportSize({ width: 1280, height: 800 });
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.goto('/');
  await expect(page.locator('#app-splash')).toHaveCount(0, { timeout: 30_000 });

  const result: unknown = await page.evaluate(RENDERER_SMOKE_SOURCE);

  expect(result).toMatchObject({ readyToShow: true, imported: true, saved: true });
  expect((result as { savedBytes: number }).savedBytes).toBeGreaterThan(0);
  // The packaged harness fails on any console error (level >= 3).
  expect(consoleErrors).toEqual([]);
});
