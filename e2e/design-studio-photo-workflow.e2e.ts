import { expect, test } from './fixtures/kerfdesk-test';
import { saveProjectAs } from './fixtures/project-save';
import { applicationHeader, toolbarCommand } from './fixtures/workspace-ui';

test('one studio preserves vector drafts and photo edits through Apply and project save/reopen', async ({
  page,
  kerfdesk,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(applicationHeader(page)).toContainText('KerfDesk');
  await expect(page.locator('#app-splash')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open Design Studio', exact: true }).click();
  const studio = page.getByRole('dialog', { name: 'Design Studio', exact: true });
  if (
    (await studio.getByRole('button', { name: '3D', exact: true }).getAttribute('aria-pressed')) ===
    'true'
  )
    await studio.getByRole('button', { name: '3D', exact: true }).click();
  await studio.getByRole('button', { name: 'Rectangle', exact: true }).click();
  const canvas = await studio.getByLabel('Design canvas, 0 entities').boundingBox();
  if (canvas === null) throw new Error('No drawing canvas');
  await page.mouse.move(canvas.x + 200, canvas.y + 160);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 320, canvas.y + 220, { steps: 6 });
  await page.mouse.up();
  await expect(studio.getByLabel('Design canvas, 1 entities')).toBeVisible();
  await studio.getByRole('button', { name: /^Rectangle 1/ }).click();
  const width = studio.getByRole('textbox', { name: 'Width in mm', exact: true });
  const height = studio.getByRole('textbox', { name: 'Height in mm', exact: true });
  const originalWidth = await width.inputValue();
  const originalHeight = await height.inputValue();
  await studio.getByRole('button', { name: '↷ 90° right', exact: true }).click();
  await expect(width).toHaveValue(originalHeight);
  await expect(height).toHaveValue(originalWidth);
  await studio.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(width).toHaveValue(originalWidth);
  await expect(height).toHaveValue(originalHeight);
  await studio.getByRole('button', { name: 'Photos', exact: true }).click();
  await expect(studio.getByRole('region', { name: 'Project photos' })).toBeVisible();
  await kerfdesk.setOpenFiles([
    { name: 'studio-photo.png', kind: 'png-fixture', width: 128, height: 64 },
  ]);
  await studio.getByRole('button', { name: 'Import photo', exact: true }).click();
  const photo = studio.getByRole('region', { name: /^Image Studio/ });
  await expect(photo).toBeVisible();
  await page.keyboard.press('c');
  await expect(photo.getByRole('button', { name: /^Crop —/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('b');
  await expect(page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(1);
  await expect(photo.getByRole('region', { name: 'Layers panel' })).toBeVisible();
  await photo.getByRole('button', { name: 'Clean up white paper', exact: true }).click();
  const cleanup = photo.getByRole('dialog', { name: 'Remove white background', exact: true });
  await cleanup.getByRole('button', { name: 'OK', exact: true }).click();
  const layers = photo.getByRole('region', { name: 'Layers panel' });
  await layers.getByTitle('Add a transparent layer above the active one', { exact: true }).click();
  await expect(layers.getByRole('button', { name: 'Layer 1', exact: true })).toBeVisible();
  const photoCanvas = await photo.getByLabel('Image Studio document canvas').boundingBox();
  if (photoCanvas === null) throw new Error('Missing photo canvas');
  await page.mouse.move(
    photoCanvas.x + photoCanvas.width / 2,
    photoCanvas.y + photoCanvas.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    photoCanvas.x + photoCanvas.width / 2 + 16,
    photoCanvas.y + photoCanvas.height / 2,
    { steps: 4 },
  );
  await page.mouse.up();
  await layers.getByLabel('Active layer blend mode').selectOption('multiply');
  await layers.getByLabel('Active layer opacity').focus();
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  await layers.getByTitle('Hide this layer', { exact: true }).first().click();
  await layers
    .getByTitle('Delete the active layer (the last layer always stays)', { exact: true })
    .click();
  await expect(layers.getByRole('button', { name: 'Layer 1', exact: true })).toHaveCount(0);
  await photo.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(layers.getByRole('button', { name: 'Layer 1', exact: true })).toBeVisible();
  await photo.getByRole('button', { name: 'Resize pixels', exact: true }).click();
  const resize = page.getByRole('dialog', { name: 'Image Size', exact: true });
  await resize.getByRole('spinbutton', { name: 'Width (px)', exact: true }).fill('64');
  await resize.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(photo.getByLabel('Image Studio actions')).toContainText('64×32 px');
  // The shared shell routes keyboard Undo to photos rather than the hidden sketch.
  await page.keyboard.press('Control+z');
  await expect(photo.getByLabel('Image Studio actions')).toContainText('128×64 px');
  await page.keyboard.press('Control+Shift+z');
  await expect(photo.getByLabel('Image Studio actions')).toContainText('64×32 px');
  await studio.getByRole('button', { name: 'Vectors', exact: true }).click();
  await expect(studio.getByLabel('Design canvas, 1 entities')).toBeVisible();
  await studio.getByRole('button', { name: 'Apply', exact: true }).click();
  await studio.getByRole('button', { name: 'Photos', exact: true }).click();
  await studio.getByRole('button', { name: 'Edit photo studio-photo.png', exact: true }).click();
  await expect(photo.getByLabel('Image Studio actions')).toContainText('64×32 px');
  await expect(photo.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
  await photo.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(photo.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  await studio.getByRole('button', { name: 'Back to canvas', exact: true }).click();
  await expect(studio.getByLabel('Design canvas, 1 entities')).toBeVisible();
  await studio.getByRole('button', { name: 'Select photo studio-photo.png', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('shared-photo-vector-canvas.png') });
  await studio.getByRole('button', { name: 'Edit selected photo', exact: true }).click();
  await expect(layers.getByRole('button', { name: 'Layer 1', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('unified-studio-photo.png') });
  await page.setViewportSize({ width: 1024, height: 700 });
  await photo.getByRole('button', { name: 'Fit photo', exact: true }).click();
  await expect(studio.getByRole('button', { name: 'Vectors', exact: true })).toBeInViewport();
  await expect(photo.getByRole('button', { name: 'Apply', exact: true })).toBeInViewport();
  await expect(
    photo.getByRole('button', { name: 'Clean up white paper', exact: true }),
  ).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('unified-studio-photo-small.png') });
  await studio.getByRole('button', { name: 'Close studio', exact: true }).click();
  await saveProjectAs(page, kerfdesk);
  const savedFiles = await kerfdesk.savedFiles();
  const saved = Object.entries(savedFiles).find(([name]) => name.endsWith('.lf2'));
  if (saved === undefined) throw new Error('Project was not saved');
  const project = JSON.parse(saved[1]);
  const raster = project.scene.objects.find(
    (object: { kind: string }) => object.kind === 'raster-image',
  );
  expect(raster).toMatchObject({ pixelWidth: 64, pixelHeight: 32, source: 'studio-photo.png' });
  expect(project.scene.objects.length).toBeGreaterThanOrEqual(2);
  expect(raster.dataUrl).toMatch(/^data:image\/png;base64,/);
  expect(raster.editorDocument.layers).toHaveLength(2);
  expect(raster.editorDocument.layers[1]).toMatchObject({
    name: 'Layer 1',
    blend: 'multiply',
    opacity: 0.99,
    isVisible: false,
  });
  const savedInk = Buffer.from(raster.editorDocument.layers[1].rgbaBase64, 'base64');
  expect([...savedInk].some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
  expect(project.designStudioDocument.sketch.entities).toHaveLength(1);
  // Clear profile recovery: the project itself must own both editable sources.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#app-splash')).toHaveCount(0);
  await kerfdesk.setOpenFiles([{ name: saved[0], text: saved[1] }]);
  await (await toolbarCommand(page, 'Open...')).click();
  await expect(page).toHaveTitle(new RegExp(saved[0].replaceAll('.', '\\.')));
  await page.getByRole('button', { name: 'Open Design Studio', exact: true }).click();
  await expect(studio.getByLabel('Design canvas, 1 entities')).toBeVisible();
  await studio.getByRole('button', { name: 'Photos', exact: true }).click();
  await studio.getByRole('button', { name: 'Edit photo studio-photo.png', exact: true }).click();
  await expect(photo.getByLabel('Image Studio actions')).toContainText('64×32 px');
  await expect(photo.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await expect(layers.getByRole('button', { name: 'Layer 1', exact: true })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(layers.getByLabel('Active layer blend mode')).toHaveValue('multiply');
  await expect(layers.getByLabel('Active layer opacity')).toHaveValue('99');
  await expect(layers.getByTitle('Show this layer', { exact: true })).toBeVisible();
  await layers.getByTitle('Show this layer', { exact: true }).click();
  await photo.getByRole('button', { name: 'Apply & Trace', exact: true }).click();
  await expect(studio).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Trace image', exact: true })).toBeVisible();
});
