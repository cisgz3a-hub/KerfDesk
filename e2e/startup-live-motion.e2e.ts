import { expect, test } from './fixtures/kerfdesk-test';

test.use({ startupSplash: 'manual' });

for (const edition of ['browser', 'desktop']) {
  test.describe(`${edition} startup with a connected controller`, () => {
    test.use({
      userAgent: `Mozilla/5.0 Chrome/142.0.0.0${edition === 'desktop' ? ' Electron/44.8.0' : ''}`,
    });

    test('keeps the pause panel behind the splash and restores its priority afterwards', async ({
      page,
    }) => {
      // Static artwork makes a pixel comparison independent of animation time.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.route(/\/src\/ui\/app\/main\.tsx(?:\?|$)/, (route) =>
        route.fulfill({
          contentType: 'text/javascript',
          // Mount the real connected-controller panel, without opening a serial
          // transport. Delay dismissal so screenshots cannot race the hold timer.
          body: `import '/e2e/fixtures/startup-live-motion.ts';`,
        }),
      );
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      const panel = page.locator('[aria-label="Live Motion"]');
      await expect(panel).toContainText('CONTROLLER HOLD', { timeout: 45000 });
      await expect(page.locator('#app-root')).toHaveAttribute('inert', '');
      const bounds = await panel.boundingBox();
      if (bounds === null) throw new Error('Expected mounted controller pause panel');

      // Inert elements are omitted from hit testing even when they paint on top.
      // Compare actual pixels with and without the panel to catch that overlap.
      const withPanel = await page.screenshot({ clip: bounds });
      await panel.evaluate((element: HTMLElement) => {
        element.style.visibility = 'hidden';
      });
      const withoutPanel = await page.screenshot({ clip: bounds });
      await panel.evaluate((element: HTMLElement) => {
        element.style.removeProperty('visibility');
      });
      expect(withPanel.equals(withoutPanel), 'The pause panel must not paint over the splash').toBe(
        true,
      );

      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.evaluate(async (desktop) => {
        const modulePath = '/src/ui/app/startup-splash.ts';
        const { dismissStartupSplash } = (await import(/* @vite-ignore */ modulePath)) as {
          dismissStartupSplash: (options: { desktop: boolean }) => void;
        };
        dismissStartupSplash({ desktop });
      }, edition === 'desktop');
      await expect(page.locator('#app-splash')).toHaveCount(0, { timeout: 7000 });
      await expect(panel).toBeVisible();
      // Body portals must still sit below the live controls after startup.
      await page.evaluate(() => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:white';
        document.body.append(overlay);
      });
      await panel.getByRole('button', { name: 'ABORT MOTION', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-abort-clicked', 'true');
    });
  });
}
