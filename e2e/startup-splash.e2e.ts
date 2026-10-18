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
    // Several lights flow along the artwork's grooves, each its own
    // animation; reduced motion must stop every one of them.
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
  await expect(page.locator('#app-splash')).toHaveCount(0, { timeout: 7000 });
});

test('paints the wood with the splash without a separate artwork request', async ({ page }) => {
  let artworkRequests = 0;
  await page.route(/\/startup-craft\.webp(?:\?|$)/, async (route) => {
    artworkRequests += 1;
    await route.abort();
  });
  const main = await holdRequest(page, /\/src\/ui\/app\/main\.tsx(?:\?|$)/);
  try {
    await page.goto('/', { waitUntil: 'commit' });
    await expect.poll(main.requested).toBe(true);
    const artwork = page.locator('.app-splash__art');
    await expect(artwork).toHaveAttribute('src', /^data:image\/webp;base64,/);
    await expect
      .poll(() =>
        artwork.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
      )
      .toBe(true);
    await expect(artwork).toHaveAttribute('decoding', 'sync');
    expect(artworkRequests).toBe(0);
    await expect(page.locator('#app-root')).toBeEmpty();
    await expect(page.locator('#app-splash')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('splash-before-workspace.png') });
    await main.release();
    await expect(page.locator('canvas[aria-label="KerfDesk workspace"]')).toHaveAttribute(
      'data-workspace-painted',
      'true',
    );
    await expect(page.locator('#app-splash')).toHaveCount(0, { timeout: 7000 });
  } finally {
    await main.release();
  }
});

for (const edition of ['browser', 'desktop']) {
  test.describe(`${edition} splash timing`, () => {
    test.use({
      userAgent: `Mozilla/5.0 Chrome/142.0.0.0${edition === 'desktop' ? ' Electron/44.8.0' : ''}`,
    });

    test('retains a full hold after a slow entry and uses the longer fade', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      const main = await holdRequest(page, /\/src\/ui\/app\/main\.tsx(?:\?|$)/);
      try {
        await page.goto('/', { waitUntil: 'commit' });
        await expect.poll(main.requested).toBe(true);
        // Reproduce navigation consuming the old two-second minimum before
        // the workspace module can even install the splash dismissal.
        await page.waitForFunction(() => performance.now() >= 2500);
        const releasedAt = await page.evaluate(() => performance.now());
        await page.evaluate(() => {
          const splash = document.getElementById('app-splash');
          if (splash === null) throw new Error('Missing startup splash');
          new MutationObserver(() => {
            if (splash.classList.contains('app-splash--hidden')) {
              document.documentElement.dataset.splashFadeAt = String(performance.now());
              document.documentElement.dataset.splashFadeDuration = splash.style.transitionDuration;
            }
          }).observe(splash, { attributes: true, attributeFilter: ['class'] });
        });
        await main.release();
        await expect(page.locator('canvas[data-workspace-painted="true"]')).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-splash-fade-at', /\d/, {
          timeout: 7000,
        });
        const fadedAt = Number(await page.locator('html').getAttribute('data-splash-fade-at'));
        expect(fadedAt - releasedAt).toBeGreaterThanOrEqual(4000);
        await expect(page.locator('html')).toHaveAttribute('data-splash-fade-duration', '750ms');
        await expect(page.locator('#app-splash')).toHaveCount(0, { timeout: 2000 });
      } finally {
        await main.release();
      }
    });
  });
}

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
  // DOMContentLoaded precedes the dynamically attached workspace module.
  // Observe its load separately from canvas paint and splash dismissal.
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
