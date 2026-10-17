import { expect, test, type Page } from './fixtures/kerfdesk-test';

test('paints the splash before the bundle and honours reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const waitForDesktopModule = await observeDesktopModule(page);
  const main = await holdRequest(page, /\/src\/ui\/app\/main\.tsx(?:\?|$)/);
  try {
    await page.goto('/', { waitUntil: 'commit' });
    await expect.poll(main.requested).toBe(true);
    const splash = page.locator('#app-splash');
    await expect(splash).toBeVisible();
    await expect(page.locator('#app-root')).toBeEmpty();
    await expect(splash.getByText('Created by Ons Houtkombuis', { exact: true })).toBeVisible();
    // The pulse is several layered animations (beam, glow, flare, sparks);
    // reduced motion must stop every one of them.
    const splashAnimations = () =>
      splash.evaluate((element) => element.getAnimations({ subtree: true }).length);
    await expect.poll(splashAnimations).toBeGreaterThan(0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(splashAnimations).toBe(0);

    await main.release();
    // The desktop module is attached dynamically after DOMContentLoaded. Its
    // own load event includes the graph released by the held entry request.
    await waitForDesktopModule();
    await expect(page.locator('canvas[aria-label="KerfDesk workspace"]')).toBeVisible();
    await expect(page.locator('canvas[aria-label="KerfDesk workspace"]')).toHaveAttribute(
      'data-workspace-painted',
      'true',
    );
    await expect(splash).toHaveCount(0);
  } finally {
    await main.release();
  }
});

test('waits for a successful workspace paint after a canvas mounts', async ({ page }) => {
  await page.route(/\/src\/ui\/app\/App\.tsx(?:\?|$)/, (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      // A minimal React 18 element keeps the real entry point/splash running
      // while deliberately mounting a canvas with no painter attached.
      body: 'export function App() { return { $$typeof: Symbol.for("react.element"), type: "canvas", key: null, ref: null, props: { "aria-label": "Unpainted fixture" }, _owner: null }; }',
    }),
  );
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const canvas = page.getByLabel('Unpainted fixture');
  await expect(canvas).toBeVisible();
  await expect(page.locator('#app-splash')).toBeVisible();
  await canvas.evaluate((element) => {
    element.setAttribute('data-workspace-painted', 'true');
  });
  await expect(page.locator('#app-splash')).toHaveCount(0, { timeout: 2000 });
});

test('reveals the workspace while the decorative artwork is still pending', async ({ page }) => {
  const waitForDesktopModule = await observeDesktopModule(page);
  const artwork = await holdRequest(page, /\/startup-craft\.webp(?:\?|$)/);
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect.poll(artwork.requested).toBe(true);
    await waitForDesktopModule();
    await expect(page.locator('canvas[aria-label="KerfDesk workspace"]')).toBeVisible();
    await expect(page.locator('canvas[aria-label="KerfDesk workspace"]')).toHaveAttribute(
      'data-workspace-painted',
      'true',
    );
    await expect(page.locator('#app-splash')).toHaveCount(0, { timeout: 2000 });
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
  // The mobile router now loads the desktop module after the entry document.
  // Wait for that module before measuring the mounted app's splash deadline;
  // DOMContentLoaded can fire while its cold dependency graph is still loading.
  await page.goto('/', { waitUntil: 'load' });
  await expect(page.locator('#app-splash')).toBeVisible();
  await expect(page.locator('#app-root')).toBeEmpty();
  await expect(page.locator('#app-splash')).toHaveCount(0, { timeout: 7000 });
});

async function observeDesktopModule(page: Page) {
  // DOMContentLoaded precedes the dynamically attached desktop module. A held
  // image prevents waiting for the page's load event, so observe the module's
  // own load separately from workspace paint and splash dismissal.
  await page.addInitScript(() => {
    document.addEventListener(
      'load',
      (event) => {
        const target = event.target;
        if (
          target instanceof HTMLScriptElement &&
          target.src !== '' &&
          new URL(target.src).pathname === '/src/ui/app/main.tsx'
        ) {
          document.documentElement.dataset.workspaceModuleLoaded = 'true';
        }
      },
      true,
    );
  });
  return () =>
    expect(page.locator('html')).toHaveAttribute('data-workspace-module-loaded', 'true', {
      timeout: 45_000,
    });
}

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
