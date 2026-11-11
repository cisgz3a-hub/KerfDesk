import { expect, type Page } from '@playwright/test';

// Covers a cold dev-server module graph plus the four visible seconds and
// fade of the startup hold (ADR-049 Amendment 2). A fresh browser context is
// the first launch of this version, so its first navigation holds in full;
// later navigations in the same context reveal on paint (Amendment 3).
const STARTUP_SPLASH_TIMEOUT_MS = 45_000;

/**
 * Wait until the startup splash has been removed and the workspace is no longer
 * inert. Until then the app deliberately ignores focus and keyboard input, so
 * specs that type or press keys must not start before the real reveal.
 * Pages without the app splash (fixture harnesses, the licence page) pass once parsed.
 */
export async function waitForStartupSplash(
  page: Page,
  timeout = STARTUP_SPLASH_TIMEOUT_MS,
): Promise<void> {
  // Polling evaluate, not waitForFunction, so an app-initiated navigation retries.
  await expect(async () => {
    const state = await page.evaluate(() => ({
      parsed: document.readyState !== 'loading',
      splash: document.getElementById('app-splash') !== null,
      inert: document.getElementById('app-root')?.hasAttribute('inert') === true,
    }));
    expect(state).toEqual({ parsed: true, splash: false, inert: false });
  }).toPass({ timeout });
}
