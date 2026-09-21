import { mkdirSync } from 'node:fs';
import { test, expect } from './fixtures/kerfdesk-test';
import { applicationHeader, selectWorkspacePanel, toolbarCommand } from './fixtures/workspace-ui';

test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(applicationHeader(page)).toContainText('KerfDesk', { timeout: 90_000 });
  await expect(page.locator('#app-splash')).toHaveCount(0);
});

test('material wizard Back preserves changed settings and details through final Save', async ({
  page,
  kerfdesk,
}) => {
  await selectWorkspacePanel(page, 'Artwork');
  await page.getByRole('tab', { name: 'Materials', exact: true }).click();
  await page.getByRole('button', { name: 'Create new material library', exact: true }).click();
  await page.getByRole('button', { name: 'New material preset', exact: true }).click();
  const wizard = page.getByRole('dialog', { name: 'New material preset', exact: true });
  await wizard.getByLabel('Material name', { exact: true }).fill('Audit birch');
  await wizard.getByLabel('Material thickness millimeters', { exact: true }).fill('3');
  await wizard.getByLabel('Preset description', { exact: true }).fill('Cut');
  await wizard.getByRole('button', { name: 'Next', exact: true }).click();
  await wizard.getByRole('spinbutton', { name: 'Power', exact: true }).fill('67');
  await wizard.getByRole('checkbox', { name: 'Recipe uses air assist', exact: true }).check();
  await wizard.getByRole('button', { name: 'Back', exact: true }).click();
  await wizard.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(wizard.getByRole('spinbutton', { name: 'Power', exact: true })).toHaveValue('67');
  await expect(
    wizard.getByRole('checkbox', { name: 'Recipe uses air assist', exact: true }),
  ).toBeChecked();
  await wizard.getByRole('button', { name: 'Next', exact: true }).click();
  await wizard.getByRole('checkbox', { name: 'Enable tabs', exact: true }).check();
  await wizard.getByRole('button', { name: 'Back', exact: true }).click();
  await wizard.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(wizard.getByRole('checkbox', { name: 'Enable tabs', exact: true })).toBeChecked();
  await wizard.getByRole('button', { name: 'Next', exact: true }).click();
  await wizard.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(wizard).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit selected material preset', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit material preset', exact: true });
  await expect(edit.getByLabel('Material name', { exact: true })).toHaveValue('Audit birch');
  await expect(edit.getByLabel('Material thickness millimeters', { exact: true })).toHaveValue('3');
  await edit.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(edit.getByRole('spinbutton', { name: 'Power', exact: true })).toHaveValue('67');
  await expect(
    edit.getByRole('checkbox', { name: 'Recipe uses air assist', exact: true }),
  ).toBeChecked();
  await edit.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(edit.getByRole('checkbox', { name: 'Enable tabs', exact: true })).toBeChecked();
  await edit.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await kerfdesk.events()).filter((event) => event.kind === 'serial-write')).toEqual([]);
});

test('Image Studio stack-edge buttons stay inert and become available at the correct layer', async ({
  page,
  kerfdesk,
}) => {
  await kerfdesk.setOpenFiles([
    { name: 'audit-layers.png', kind: 'png-fixture', width: 32, height: 32 },
  ]);
  await (await toolbarCommand(page, 'Import...')).click();
  await expect(page.getByText('Objects: 1', { exact: true })).toBeVisible();
  await (await toolbarCommand(page, 'Image Studio...')).click();
  const studio = page.getByRole('dialog', { name: /Image Studio/ });
  await expect(studio).toBeVisible();
  await studio.getByRole('button', { name: 'Panels', exact: true }).click();
  const layers = studio.getByRole('region', { name: 'Layers panel', exact: true });
  const up = layers.getByTitle('Move the active layer up', { exact: true });
  const down = layers.getByTitle('Move the active layer down', { exact: true });
  const merge = layers.getByTitle('Merge the active layer into the one below it', { exact: true });
  await expect(up).toBeDisabled();
  await expect(down).toBeDisabled();
  await expect(merge).toBeDisabled();
  await layers.getByTitle('Add a transparent layer above the active one', { exact: true }).click();
  await expect(up).toBeDisabled();
  await expect(down).toBeEnabled();
  await down.click();
  await expect(down).toBeDisabled();
  await expect(merge).toBeDisabled();
  await expect(up).toBeEnabled();
  await up.click();
  await expect(merge).toBeEnabled();
  await merge.click();
  await expect(up).toBeDisabled();
  await expect(down).toBeDisabled();
  await expect(merge).toBeDisabled();
  await expect(
    layers.getByTitle(
      'Make this the active paint layer (undo follows your strokes across layers); drag rows to reorder',
      { exact: true },
    ),
  ).toHaveCount(1);
  mkdirSync('docs/audits/2026-09-21-interface', { recursive: true });
  await page.screenshot({ path: 'docs/audits/2026-09-21-interface/image-layer-buttons.png' });
  expect((await kerfdesk.events()).filter((event) => event.kind === 'serial-write')).toEqual([]);
});
