import { expect, test, type Page } from './fixtures/kerfdesk-test';
import type { Project } from '../src/core/scene';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('/');
  await expect(page.locator('#app-splash')).toHaveCount(0, { timeout: 20_000 });
  await page.getByRole('button', { name: 'Open...' }).click();
  await expect(page).toHaveTitle(/project-basic\.lf2/);
  await page.getByRole('button', { name: 'Fit to selection', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Job start', exact: true })).toHaveAttribute(
    'aria-disabled',
    'false',
  );
});

test('drags both starts, saves and reopens exact selections, and applies relative defaults to New', async ({
  page,
  kerfdesk,
}) => {
  const before = await currentProject(page);
  await drag(page, 'Frame start', -65, -20);
  await expect.poll(async () => (await currentProject(page)).startPoints?.frame).toBeDefined();
  await drag(page, 'Job start', 75, 40);
  await expect.poll(async () => (await currentProject(page)).startPoints?.job).toBeDefined();
  const selected = await currentProject(page);
  expect(selected.scene).toEqual(before.scene);
  expect(selected.startPoints?.job?.relative).toBeUndefined();

  await page.getByRole('button', { name: 'Start points', exact: true }).click();
  const saveDefault = page.getByRole('button', { name: 'Use as defaults for new jobs' });
  await expect(saveDefault).toBeEnabled();
  await saveDefault.click();
  await expect(page.getByText('Saved for new jobs on this device.', { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('start-points-settings.png') });

  await page.keyboard.press('Control+Shift+s');
  await expect.poll(async () => Object.keys(await kerfdesk.savedFiles()).length).toBeGreaterThan(0);
  const saved = Object.values(await kerfdesk.savedFiles())[0];
  if (saved === undefined) throw new Error('Project save must produce a file');
  expect((JSON.parse(saved) as Project).startPoints).toEqual(selected.startPoints);

  await page.keyboard.press('Control+n');
  await expect.poll(async () => (await currentProject(page)).scene.objects.length).toBe(0);
  const fresh = await currentProject(page);
  expect(fresh.startPoints?.frame).toEqual(selected.startPoints?.frame);
  expect(fresh.startPoints?.job?.relative).toBe(true);
  await kerfdesk.setOpenFiles([{ name: 'chosen-starts.lf2', text: saved }]);
  await page.getByRole('button', { name: 'Open...' }).click();
  await expect
    .poll(async () => (await currentProject(page)).startPoints)
    .toEqual(selected.startPoints);
  await expect(page.getByRole('button', { name: 'Job start', exact: true })).toHaveAttribute(
    'aria-disabled',
    'false',
  );
});

test('cancelled drags do not edit the project, and one drag has one undo step', async ({
  page,
}) => {
  const before = await currentProject(page);
  const job = page.getByRole('button', { name: 'Job start', exact: true });
  const bounds = await job.boundingBox();
  if (bounds === null) throw new Error('Job start must be visible');
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 90, bounds.y + 20, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await currentProject(page)).toEqual(before);

  await drag(page, 'Job start', 70, 35);
  await expect.poll(async () => (await currentProject(page)).startPoints?.job).toBeDefined();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await currentProject(page)).startPoints).toBeUndefined();
  expect((await currentProject(page)).scene).toEqual(before.scene);
  await expect(page.getByRole('button', { name: 'Job start', exact: true })).toHaveAttribute(
    'aria-disabled',
    'false',
  );
  await page.screenshot({ path: test.info().outputPath('compact-start-handles.png') });
});

async function currentProject(page: Page): Promise<Project> {
  return page.evaluate(async () => {
    const path = '/src/ui/state/store.ts';
    const { useStore } = (await import(/* @vite-ignore */ path)) as {
      useStore: { getState: () => { project: Project } };
    };
    return useStore.getState().project;
  });
}

async function drag(page: Page, name: string, dx: number, dy: number): Promise<void> {
  const handle = page.getByRole('button', { name, exact: true });
  await expect(handle).toHaveAttribute('aria-disabled', 'false');
  const bounds = await handle.boundingBox();
  if (bounds === null) throw new Error(`${name} must be visible`);
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}
