import { expect, test, type Page, type KerfDeskFixture } from './fixtures/kerfdesk-test';
import { createProject } from '../src/core/scene';
import {
  barcodeAcceptanceSnapshot as snapshot,
  barcodeAcceptanceHistory as history,
  saveBarcodeAcceptanceProject,
} from './fixtures/barcode-acceptance-browser';
import { toolbarCommand } from './fixtures/workspace-ui';
import { runMenuCommand } from './fixtures/recovery-flow';
import { saveTopologyGcode } from './fixtures/topology-repairs';

test.setTimeout(360_000);
test.use({ viewport: { width: 1440, height: 1000 }, actionTimeout: 30_000 });

async function openProject(
  page: Page,
  fixture: KerfDeskFixture,
  text: string,
  name: string,
): Promise<void> {
  await fixture.setOpenFiles([{ name, text }]);
  await (await toolbarCommand(page, 'Open...')).click();
  await expect(page).toHaveTitle(new RegExp(name.replaceAll('.', '\\.')), { timeout: 90_000 });
}

test.beforeEach(async ({ page, kerfdesk }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('menubar', { name: 'Application menu' })).toBeVisible({
    timeout: 180_000,
  });
  const project = createProject();
  await openProject(
    page,
    kerfdesk,
    JSON.stringify({
      ...project,
      device: { ...project.device, homing: { ...project.device.homing, enabled: true } },
    }),
    'focus-empty.lf2',
  );
});

test.afterEach(async ({ page, kerfdesk }, info) => {
  await info.attach('focus-workflow', { body: await page.screenshot(), contentType: 'image/png' });
  expect(
    (await kerfdesk.events()).filter(
      (event) => event.kind === 'serial-open' || event.kind === 'serial-write',
    ),
  ).toEqual([]);
});

test('Focus Test generates, previews exact Z output, saves, reopens and undoes', async ({
  page,
  kerfdesk,
}) => {
  await runMenuCommand(page, 'Tools', 'Focus Test...');
  const dialog = page.getByRole('dialog', { name: 'Focus Test', exact: true });
  await dialog.getByLabel('Samples', { exact: true }).fill('5');
  await dialog.getByLabel('Minimum Z offset (mm)', { exact: true }).fill('-1');
  await dialog.getByLabel('Maximum Z offset (mm)', { exact: true }).fill('1');
  await expect(dialog.getByRole('status')).toContainText('-1.000, -0.500, 0.000, 0.500, 1.000');
  await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(
    (await snapshot(page)).project.scene.layers.map((layer) => layer.focusTest?.offsetMm),
  ).toEqual([-1, -0.5, 0, 0.5, 1]);
  await history(page, false);
  await expect.poll(async () => (await snapshot(page)).project.scene.objects.length).toBe(0);
  await history(page, true);
  await expect.poll(async () => (await snapshot(page)).project.scene.objects.length).toBe(5);
  await runMenuCommand(page, 'File', 'Inspect G-code (3D)...');
  const inspector = page.getByRole('dialog', { name: /G-code Inspector: .*current canvas/ });
  await expect(inspector.getByLabel('Program health')).toBeVisible({ timeout: 120_000 });
  await expect(inspector.getByLabel('Program source')).toContainText('Focus Test', {
    timeout: 30_000,
  });
  await expect(inspector.locator('[data-viewer-state="ready"]')).toBeVisible({
    timeout: 120_000,
  });
  await expect(inspector.getByText('Preparing 3D view…', { exact: true })).toBeHidden();
  await expect(inspector.getByLabel('3D G-code toolpath', { exact: true })).toBeVisible();
  await test.info().attach('focus-exact-program-preview', {
    body: await page.screenshot({ path: test.info().outputPath('focus-rendered-3d.png') }),
    contentType: 'image/png',
  });
  await inspector.getByRole('button', { name: 'Close', exact: true }).click();
  const gcode = await saveTopologyGcode(page, kerfdesk);
  expect((gcode.match(/; Focus Test Z offset/g) ?? []).length).toBe(5);
  expect(gcode).toContain('G91\nG1 Z-1.000 F300 S0\nG90');
  expect(gcode).toContain('G91\nG1 Z1.000 F300 S0\nG90');
  const saved = await saveBarcodeAcceptanceProject(page, kerfdesk);
  expect(JSON.parse(saved).schemaVersion).toBe(18);
  await openProject(page, kerfdesk, saved, 'focus-reopened.lf2');
  expect(
    (await snapshot(page)).project.scene.layers.map((layer) => layer.focusTest?.offsetMm),
  ).toEqual([-1, -0.5, 0, 0.5, 1]);
  expect(await saveTopologyGcode(page, kerfdesk)).toContain('G91\nG1 Z-1.000 F300 S0\nG90');
});

test('Focus Test cancellation, invalid input and maximum sample boundary', async ({ page }) => {
  await runMenuCommand(page, 'Tools', 'Focus Test...');
  const dialog = page.getByRole('dialog', { name: 'Focus Test', exact: true });
  await dialog.getByLabel('Samples', { exact: true }).fill('102');
  await expect(dialog.getByRole('button', { name: 'Generate', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await snapshot(page)).project.scene.objects).toHaveLength(0);
  await runMenuCommand(page, 'Tools', 'Focus Test...');
  await dialog.getByLabel('Samples', { exact: true }).fill('101');
  await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).project.scene.layers.length).toBe(101);
  await history(page, false);
  await expect.poll(async () => (await snapshot(page)).project.scene.objects.length).toBe(0);
});
