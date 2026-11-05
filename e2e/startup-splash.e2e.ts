import { expect, test, type Page } from './fixtures/kerfdesk-test';
import type { Route } from '@playwright/test';
import { createServer } from 'node:http';
import { once } from 'node:events';

// These specs observe the splash itself, so navigation must not wait it out.
test.use({ startupSplash: 'manual' });

// Anything the app mounts waits for main.tsx's whole dev-server module graph
// (about 1,240 modules). On a busy CI shard, or a loaded PC, that graph can
// take far longer than the default expect timeout to arrive: a loaded PC
// was still fetching it 65 s after navigation. Tests that wait on it take
// MODULE_GRAPH_TEST_TIMEOUT_MS.
const DESKTOP_MODULE_GRAPH_TIMEOUT_MS = 60_000;
const MODULE_GRAPH_TEST_TIMEOUT_MS = 120_000;

test('paints the splash before the bundle and honours reduced motion', async ({ page }) => {
  test.setTimeout(MODULE_GRAPH_TEST_TIMEOUT_MS);
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
  test.setTimeout(MODULE_GRAPH_TEST_TIMEOUT_MS);
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
  // The stubbed App is served at once, but it mounts only after the rest of
  // main.tsx's graph has loaded (458 modules were still pending at 10 s).
  await expect(canvas).toBeVisible({ timeout: DESKTOP_MODULE_GRAPH_TIMEOUT_MS });
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
    // This first-paint case finishes with the workspace bundle held. Its
    // successful paint and splash dismissal are covered by the adjacent cases.
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
      if (edition === 'desktop')
        await page.addInitScript(() => {
          // This browser uses the desktop UA; simulate its native visibility signal.
          document.addEventListener('DOMContentLoaded', () => {
            document.documentElement.dataset.desktopWindowVisible = 'true';
            window.dispatchEvent(new Event('kerfdesk:window-visibility'));
          });
        });
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      const waitForDesktopModule = await observeDesktopModule(page);
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
        await waitForDesktopModule();
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

test('blocks pointer and keyboard input behind the opaque splash, then releases it', async ({
  page,
}) => {
  const waitForDesktopModule = await observeDesktopModule(page);
  await page.route(/\/src\/ui\/app\/main\.tsx(?:\?|$)/, (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      // Exercise the real HTML and dismissal lifecycle with a small painted
      // workspace, independently of the full app's cold dependency graph.
      body: `import { dismissStartupSplash } from '/src/ui/app/startup-splash.ts';
        document.getElementById('app-root').innerHTML = '<button id="under-splash" style="position:fixed;left:20px;top:20px;width:150px;height:40px">Hidden control</button><canvas data-workspace-painted="true"></canvas>';
        document.getElementById('under-splash').onclick = () => document.documentElement.dataset.splashClick = 'true';
        window.onkeydown = () => document.documentElement.dataset.splashKey = 'true';
        dismissStartupSplash();`,
    }),
  );
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForDesktopModule();
  await expect(page.locator('#under-splash')).toHaveCount(1);
  await expect(page.locator('#app-root')).toHaveAttribute('inert', '');
  await page.locator('#under-splash').evaluate((button: HTMLButtonElement) => button.focus());
  await page.keyboard.press('Space');
  await page.mouse.click(40, 35);
  expect(await page.locator('html').getAttribute('data-splash-click')).toBeNull();
  expect(await page.locator('html').getAttribute('data-splash-key')).toBeNull();
  await expect(page.locator('#app-splash')).toHaveCount(0, { timeout: 7000 });
  await page.locator('#under-splash').click();
  await page.keyboard.press('x');
  await expect(page.locator('html')).toHaveAttribute('data-splash-click', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-splash-key', 'true');
});

test('does not paint a partial splash while embedded HTML artwork is still streaming', async ({
  page,
}) => {
  const response = await page.request.get('/');
  const html = (await response.text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  const split = html.indexOf('data:image/webp;base64,') + 40_000;
  expect(split).toBeGreaterThan(40_000);
  let release: () => void = () => undefined;
  const continuation = new Promise<void>((resolve) => {
    release = resolve;
  });
  const server = createServer(async (request, reply) => {
    if (request.url !== '/') {
      reply.writeHead(204).end();
      return;
    }
    reply.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    reply.write(html.slice(0, split));
    await continuation;
    reply.end(html.slice(split));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('missing stream fixture port');
  try {
    await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'commit' });
    await expect(page.locator('#app-splash')).toHaveCount(1);
    await expect(page.locator('#app-splash')).toBeHidden();
    release();
    await expect(page.locator('#app-splash')).toBeVisible();
    await expect(page.getByText('Created by Ons Houtkombuis', { exact: true })).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator('.app-splash__art')
          .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
      )
      .toBe(true);
    await page.screenshot({ path: test.info().outputPath('complete-streamed-splash.png') });
  } finally {
    release();
    server.closeAllConnections();
    server.close();
  }
});

test('reveals the actual root error boundary without waiting for a canvas', async ({ page }) => {
  const waitForDesktopModule = await observeDesktopModule(page);
  // Replace only App: the real entry point and ErrorBoundary still run.
  await page.route(/\/src\/ui\/app\/App\.tsx(?:\?|$)/, (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: 'export function App() { throw new Error("Startup fixture crash"); }',
    }),
  );
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForDesktopModule();
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
      timeout: DESKTOP_MODULE_GRAPH_TIMEOUT_MS,
    });
}

async function holdRequest(page: Page, url: RegExp) {
  let requested = false;
  let resume: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const held = new Set<Promise<void>>();
  const handler = (route: Route): Promise<void> => {
    requested = true;
    const continued = gate.then(() => route.continue());
    held.add(continued);
    return continued;
  };
  await page.route(url, handler);
  return {
    requested: () => requested,
    release: async (): Promise<void> => {
      resume?.();
      // Unrouting with a request still held lets Playwright fall it back first,
      // and the handler's own continue then fails as already handled.
      await Promise.all(held);
      held.clear();
      await page.unroute(url, handler);
    },
  };
}
