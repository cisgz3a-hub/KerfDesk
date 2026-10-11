// Renders app/static/icon.svg to the PNG sizes install prompts require. Run after changing the icon.
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const svg = await readFile(new URL('../app/static/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch(
  process.env.KERFDESK_TEST_BROWSER === 'chromium' ? {} : { channel: 'chrome' },
);
try {
  for (const size of [192, 512]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<html><body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`,
    );
    await page.screenshot({
      path: new URL(`../public/app/icon-${size}.png`, import.meta.url).pathname.replace(
        /^\/([A-Za-z]:)/,
        '$1',
      ),
      omitBackground: true,
    });
    await page.close();
  }
} finally {
  await browser.close();
}
console.log('KerfDesk Remote icons: rendered.');
