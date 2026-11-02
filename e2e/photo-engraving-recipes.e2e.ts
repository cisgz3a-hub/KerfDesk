import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from './fixtures/kerfdesk-test';
import { toolbarCommand } from './fixtures/workspace-ui';

const portrait = readFileSync(
  fileURLToPath(new URL('../src/__fixtures__/perceptual/assets/astronaut.png', import.meta.url)),
).toString('base64');

test.use({ viewport: { width: 1440, height: 1000 } });

// ADR-685: a material recipe and Auto tones in the real browser, with the
// worker's material view drawn in the recipe's colours.
test('a material recipe prepares a portrait and previews it on the material', async ({
  page,
  kerfdesk,
}, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await kerfdesk.setOpenFiles([{ name: 'portrait.png', base64: portrait, mimeType: 'image/png' }]);
  await (await toolbarCommand(page, 'Import...')).click();
  const photoButton = await toolbarCommand(page, 'Photo engraving...');
  await expect(photoButton).toBeEnabled({ timeout: 30_000 });
  await photoButton.click();
  const dialog = page.getByRole('dialog', { name: 'Photo engraving', exact: true });
  const canvas = dialog.getByLabel('Photo engraving preview', { exact: true });
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByRole('button', { name: 'Auto tones' })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('recipes-1-dots.png') });

  await dialog.getByRole('combobox', { name: 'Material recipe' }).selectOption('wood');
  await expect(dialog.getByRole('combobox', { name: 'Preview view' })).toHaveValue('material');
  await expect(dialog.getByText('On wood', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'Blue Noise', exact: true })).toBeChecked();
  await expect(dialog.getByRole('spinbutton', { name: 'Photo contrast' })).not.toHaveValue('0');
  await expect(dialog.getByRole('spinbutton', { name: 'Photo sharpen amount (%)' })).toHaveValue(
    '30',
  );
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  // The material view draws the wood surface colour, not white.
  await expect
    .poll(() =>
      canvas.evaluate((node) => {
        const context = (node as HTMLCanvasElement).getContext('2d');
        const pixel = context?.getImageData(1, 1, 1, 1).data;
        return pixel === undefined ? null : [pixel[0], pixel[1], pixel[2]];
      }),
    )
    .not.toEqual([255, 255, 255]);
  await page.screenshot({ path: testInfo.outputPath('recipes-2-wood.png') });

  await dialog.getByRole('combobox', { name: 'Material recipe' }).selectOption('slate');
  await expect(dialog.getByRole('combobox', { name: 'Material marking' })).toHaveValue('light');
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: testInfo.outputPath('recipes-3-slate.png') });

  await dialog.getByRole('button', { name: 'Apply photo settings' }).click();
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
});
