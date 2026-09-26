import type { Page, TestInfo } from '@playwright/test';
import { expect } from '@playwright/test';

/** Inspect the presented pixels without asking WebGL to draw or capture again. */
export async function expectVisibleViewerToolpath(page: Page, testInfo: TestInfo): Promise<void> {
  const path = testInfo.outputPath('initial-visible-toolpath.png');
  const png = await page.getByLabel('3D G-code toolpath', { exact: true }).screenshot({ path });
  await testInfo.attach('initial-visible-toolpath', { path, contentType: 'image/png' });
  const bluePixels = await page.evaluate(
    async (dataUrl) => {
      const image = new Image();
      image.src = dataUrl;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('Screenshot decoder unavailable');
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let count = 0;
      for (let offset = 0; offset < data.length; offset += 4) {
        const red = data[offset] ?? 0;
        const green = data[offset + 1] ?? 0;
        const blue = data[offset + 2] ?? 0;
        // This fixture's shallow cutting moves are blue in the depth/pass lens;
        // exclude neutral furniture, text, background and copper controls.
        if (blue > red + 20 && blue > green + 8) count += 1;
      }
      return count;
    },
    `data:image/png;base64,${png.toString('base64')}`,
  );
  expect(bluePixels, 'the first visible frame contains the actual blue toolpath').toBeGreaterThan(
    500,
  );
}
