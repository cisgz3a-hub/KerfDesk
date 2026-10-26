// The prepublication probe and live page check must use the same provisioned browser.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function launchPublicDeliveryBrowser({ env = process.env, chromium } = {}) {
  const browserType = chromium ?? (await import('@playwright/test')).chromium;
  return browserType.launch({
    ...(env.KERFDESK_TEST_BROWSER === 'chromium' ? {} : { channel: 'chrome' }),
    headless: true,
    timeout: 30_000,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const browser = await launchPublicDeliveryBrowser();
  try {
    console.log(`Public delivery browser ready: ${browser.version()}.`);
  } finally {
    await browser.close();
  }
}
