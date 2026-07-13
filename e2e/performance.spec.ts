import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from './fixtures/kerfdesk-test';

const BASIC_PROJECT_PATH = fileURLToPath(new URL('./fixtures/project-basic.lf2', import.meta.url));

interface FixtureObject {
  id: string;
  transform: {
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
  };
}

interface FixtureProject {
  scene: { objects: FixtureObject[] };
}

test('opens and previews a 2,000-object project inside browser budgets', async ({
  page,
  kerfdesk,
}) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await expect(page.locator('#app-splash')).toHaveCount(0, { timeout: 10_000 });
  await kerfdesk.setOpenFiles([
    { name: 'large-project.lf2', kind: 'text', text: largeProjectFixture(2_000) },
  ]);

  const openStarted = Date.now();
  await page.getByRole('button', { name: 'Open...', exact: true }).click();
  await expect(page.getByText('Objects: 2000', { exact: true })).toBeVisible({ timeout: 15_000 });
  expect(Date.now() - openStarted).toBeLessThan(15_000);

  const previewStarted = Date.now();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Preview options' })).toBeVisible({
    timeout: 20_000,
  });
  expect(Date.now() - previewStarted).toBeLessThan(20_000);

  await expect(page.locator('canvas[aria-label="KerfDesk workspace"]')).toBeVisible();
  await expectAnimationFrame(page);
});

function largeProjectFixture(objectCount: number): string {
  const project = JSON.parse(readFileSync(BASIC_PROJECT_PATH, 'utf8')) as FixtureProject;
  const template = project.scene.objects[0];
  if (template === undefined) throw new Error('Basic project fixture has no object template');
  project.scene.objects = Array.from({ length: objectCount }, (_unused, index) => {
    const object = structuredClone(template);
    object.id = `large-${index}`;
    object.transform.x = (index % 50) * 5;
    object.transform.y = Math.floor(index / 50) * 5;
    object.transform.scaleX = 0.2;
    object.transform.scaleY = 0.2;
    return object;
  });
  return JSON.stringify(project);
}

async function expectAnimationFrame(page: import('@playwright/test').Page): Promise<void> {
  const elapsed = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const started = performance.now();
        requestAnimationFrame(() =>
          requestAnimationFrame(() => resolve(performance.now() - started)),
        );
      }),
  );
  expect(elapsed).toBeLessThan(1_000);
}
