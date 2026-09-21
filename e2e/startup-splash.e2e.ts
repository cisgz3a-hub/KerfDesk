import { expect, test, type Page } from './fixtures/kerfdesk-test';

test('paints the splash before the bundle and honours reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const main = await holdRequest(page, /\/src\/ui\/app\/main\.tsx(?:\?|$)/);
  try {
    await page.goto('/', { waitUntil: 'commit' });
    await expect.poll(main.requested).toBe(true);
    const splash = page.locator('#app-splash');
    await expect(splash).toBeVisible();
    await expect(page.locator('#app-root')).toBeEmpty();
    await expect(splash.getByText('Created by Ons Houtkombuis', { exact: true })).toBeVisible();
    const beam = splash.locator('.app-splash__beam');
    await expect
      .poll(() => beam.evaluate((element) => element.getAnimations().length))
      .toBeGreaterThan(0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(() => beam.evaluate((element) => element.getAnimations().length)).toBe(0);

    await main.release();
    // Releasing the entry request starts its ES module graph; wait for those
    // scripts to execute before checking the mounted workspace's readiness.
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('canvas[aria-label="KerfDesk workspace"]')).toBeVisible();
    await expect(splash).toHaveCount(0);
  } finally {
    await main.release();
  }
});

test('reveals the workspace while the decorative artwork is still pending', async ({ page }) => {
  const artwork = await holdRequest(page, /\/startup-craft\.webp(?:\?|$)/);
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect.poll(artwork.requested).toBe(true);
    await expect(page.locator('canvas[aria-label="KerfDesk workspace"]')).toBeVisible();
    await expect(page.locator('#app-splash')).toHaveCount(0);
  } finally {
    await artwork.release();
  }
});

test('reveals the actual root error boundary without waiting for a canvas', async ({ page }) => {
  // Replace only App: the real entry point and ErrorBoundary still run.
  await page.route(/\/src\/ui\/app\/App\.tsx(?:\?|$)/, (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: 'export function App() { throw new Error("Startup fixture crash"); }',
    }),
  );
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#app-root > [role="alert"]')).toContainText('Startup fixture crash');
  await expect(page.locator('#app-root canvas')).toHaveCount(0);
  // A canvas-only implementation would leave the crash hidden for the five-second cap.
  await expect(page.locator('#app-splash')).toHaveCount(0, { timeout: 2000 });
});

test('eventually dismisses when the mounted app has neither canvas nor error screen', async ({
  page,
}) => {
  await page.route(/\/src\/ui\/app\/App\.tsx(?:\?|$)/, (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: 'export function App() { return null; }',
    }),
  );
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#app-splash')).toBeVisible();
  await expect(page.locator('#app-root')).toBeEmpty();
  await expect(page.locator('#app-splash')).toHaveCount(0, { timeout: 7000 });
});

async function holdRequest(page: Page, url: RegExp) {
  let requested = false;
  let resume: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  await page.route(url, async (route) => {
    requested = true;
    await gate;
    await route.continue();
  });
  return {
    requested: () => requested,
    release: async (): Promise<void> => {
      resume?.();
      await page.unrouteAll({ behavior: 'wait' });
    },
  };
}
