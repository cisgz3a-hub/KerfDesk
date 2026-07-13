import { expect, test, type KerfDeskFixture, type Page } from './fixtures/kerfdesk-test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open...' }).click();
  await expect(page).toHaveTitle(/project-basic\.lf2/);
});

test('edits a drawn rectangle as canonical geometry and undoes the edit', async ({
  page,
  kerfdesk,
}) => {
  await drawRectangle(page);
  const cornerRadius = page.getByRole('spinbutton', { name: 'Rectangle corner radius' });
  await expect(cornerRadius).toHaveValue('0');
  await cornerRadius.fill('6');
  await cornerRadius.press('Tab');
  await expect(cornerRadius).toHaveValue('6');

  await page.getByRole('button', { name: 'Save As...' }).click();
  const saved = await savedProject(kerfdesk);
  const rectangle = saved.scene.objects.find(
    (object) => object.kind === 'shape' && object.spec?.kind === 'rect',
  );
  expect(rectangle?.spec).toMatchObject({ cornerRadiusMm: 6 });
  expect(JSON.stringify(rectangle?.paths)).toContain('cubic');

  await page.keyboard.press('Control+z');
  await expect(cornerRadius).toHaveValue('0');
});

async function drawRectangle(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Draw rectangle' }).click();
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;
  const start = { x: box.x + box.width * 0.35, y: box.y + box.height * 0.35 };
  const end = { x: box.x + box.width * 0.55, y: box.y + box.height * 0.55 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole('spinbutton', { name: 'Rectangle width' })).toBeVisible();
}

async function savedProject(kerfdesk: KerfDeskFixture): Promise<SavedProject> {
  await expect.poll(async () => Object.keys(await kerfdesk.savedFiles()).length).toBeGreaterThan(0);
  const text = Object.values(await kerfdesk.savedFiles())[0];
  expect(text).toBeDefined();
  return JSON.parse(text ?? '{}') as SavedProject;
}

interface SavedProject {
  readonly scene: { readonly objects: readonly SavedObject[] };
}

interface SavedObject {
  readonly kind?: string;
  readonly spec?: { readonly kind?: string; readonly cornerRadiusMm?: number };
  readonly paths?: unknown;
}
