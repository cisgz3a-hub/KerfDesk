import { applicationHeader } from './fixtures/workspace-ui';
import { expect, test } from './fixtures/kerfdesk-test';

test('docked properties, shape selection, layout and duplicate work in our studio', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(applicationHeader(page)).toContainText('KerfDesk');
  await expect(page.locator('#app-splash')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open Design Studio', exact: true }).click();
  const studio = page.getByRole('dialog', { name: 'Design Studio' });
  if (
    (await studio.getByRole('button', { name: '3D', exact: true }).getAttribute('aria-pressed')) ===
    'true'
  )
    await studio.getByRole('button', { name: '3D', exact: true }).click();
  await expect(studio.getByRole('button', { name: 'Desktop editors', exact: true })).toHaveCount(0);
  const canvas = studio.getByLabel('Design canvas, 0 entities');
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('Missing drawing surface');
  for (let index = 0; index < 3; index += 1) {
    await studio.getByRole('button', { name: 'Rectangle', exact: true }).click();
    const x = box.x + box.width * 0.22 + index * 130;
    const y = box.y + box.height * 0.32 + index * 40;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 70, y + 65, { steps: 8 });
    await page.mouse.up();
  }
  await expect(studio.getByLabel('Design canvas, 3 entities')).toBeVisible();
  const properties = studio.getByRole('region', { name: 'Artwork properties' });
  const shape = properties.getByRole('button', { name: /^Rectangle 1/ });
  await shape.click();
  await expect(studio.getByRole('button', { name: 'Select', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const inspector = properties.getByRole('complementary', { name: 'Rectangle properties' });
  await expect(inspector).toBeVisible();
  const inspectorBox = await inspector.boundingBox();
  if (inspectorBox === null) throw new Error('Missing docked inspector');
  expect(inspectorBox.x).toBeGreaterThanOrEqual(box.x + box.width);
  await properties.getByRole('button', { name: 'Select all', exact: true }).click();
  await expect(properties).toContainText('3 selected');
  await properties.getByRole('button', { name: 'Centre Y', exact: true }).click();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const saved = JSON.parse(
          localStorage.getItem('laserforge.design-studio-session.v1') ?? '{}',
        );
        const entities = saved.sketch?.entities ?? [];
        return (
          entities.length === 3 &&
          entities.every(
            (e: { origin: { y: number }; heightMm: number }) =>
              Math.abs(
                e.origin.y + e.heightMm / 2 - (entities[0].origin.y + entities[0].heightMm / 2),
              ) < 1e-8,
          )
        );
      }),
    )
    .toBe(true);
  await properties.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(studio.getByLabel('Design canvas, 6 entities')).toBeVisible();
  await studio.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(studio.getByLabel('Design canvas, 3 entities')).toBeVisible();
  await properties.getByRole('button', { name: 'Select all', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('kerfdesk-own-studio.png') });
  await page.setViewportSize({ width: 1024, height: 700 });
  await expect(properties).toBeVisible();
  await expect(studio.getByRole('button', { name: 'Apply', exact: true })).toBeInViewport();
  await expect(studio.getByRole('button', { name: 'Rectangle', exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('kerfdesk-own-studio-small.png') });
  await studio.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Open Design Studio', exact: true }).click();
  await expect(studio.getByLabel('Design canvas, 3 entities')).toBeVisible();
});
