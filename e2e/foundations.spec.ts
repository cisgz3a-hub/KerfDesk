import { test, expect } from './fixtures/kerfdesk-test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('banner', { name: 'Toolbar' })).toContainText('KerfDesk');
});

test('opens and saves a deterministic project through the real file workflow', async ({
  page,
  kerfdesk,
}) => {
  await page.getByRole('button', { name: 'Open...' }).click();
  await expect(page).toHaveTitle(/project-basic\.lf2/);

  await page.getByRole('button', { name: 'Save As...' }).click();
  await expect
    .poll(async () => (await kerfdesk.events()).map((event) => event.kind))
    .toContain('file-saved');
  expect(Object.keys(await kerfdesk.savedFiles())).toContain('project-basic.lf2');
});

test('connects to deterministic GRBL serial and opens the deterministic USB camera', async ({
  page,
  kerfdesk,
}) => {
  await page.getByRole('button', { name: /^Connect/ }).click();
  await expect
    .poll(async () => (await kerfdesk.events()).map((event) => event.kind))
    .toContain('serial-open');
  await expect(page.getByText('State: Idle', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Camera' }).click();
  await page.getByRole('button', { name: 'Start USB camera' }).click();

  await expect
    .poll(async () => (await kerfdesk.events()).map((event) => event.kind))
    .toEqual(expect.arrayContaining(['serial-open', 'camera-open']));
  const serialOpen = (await kerfdesk.events()).find((event) => event.kind === 'serial-open');
  expect(serialOpen?.['baudRate']).toBe(115200);
});
