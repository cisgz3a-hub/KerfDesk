import { applicationHeader, machineJogAction, toolbarCommand } from './fixtures/workspace-ui';
import { test, expect } from './fixtures/kerfdesk-test';

test('routine controls stay visible while setup, history, and Learn remain reachable', async ({
  page,
  kerfdesk,
}, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(applicationHeader(page)).toContainText('KerfDesk', { timeout: 90_000 });
  await expect(page.locator('#app-splash')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Machine', exact: true }).click();
  await expect(page.getByLabel('Laser controls', { exact: true })).toBeVisible();
  const rail = page.getByLabel('Laser controls', { exact: true });
  const homing = machineJogAction(page, 'Set up homing');
  await expect(homing).toBeVisible();
  await expect(homing).toBeEnabled();
  await expect(machineJogAction(page, 'Set up auto-focus')).toBeVisible();
  await homing.focus();
  await page.keyboard.press('Enter');
  const setup = page.getByRole('dialog', { name: 'Machine Setup', exact: true });
  await expect(setup.getByRole('checkbox', { name: 'Homing enabled', exact: true })).toBeVisible();
  await setup.getByRole('button', { name: 'Cancel without saving', exact: true }).click();
  await expect(setup).not.toBeVisible();
  await expect(homing).toBeFocused();
  const history = rail.locator('summary').filter({ hasText: /^History & recovery$/ });
  await history.focus();
  await page.keyboard.press('Enter');
  await rail
    .locator('summary')
    .filter({ hasText: /^Execution archive/ })
    .click();
  await expect(rail.getByText('No archived executions yet.', { exact: false })).toBeVisible();
  await history.click();
  const learn = page.getByRole('button', { name: 'Learn', exact: true });
  await learn.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.lf-learn-library')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(learn).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('machine-after.png') });
  await page.setViewportSize({ width: 640, height: 450 });
  const start = page.getByRole('button', { name: 'Start', exact: true });
  await expect(start).toBeVisible();
  const bounds = await start.boundingBox();
  expect((bounds?.y ?? 450) + (bounds?.height ?? 1)).toBeLessThanOrEqual(450);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(641);
  await page.screenshot({ path: testInfo.outputPath('machine-compact.png') });
  expect((await kerfdesk.events()).filter((event) => event.kind === 'serial-write')).toEqual([]);
  expect(errors).toEqual([]);
});

test('Done clears a simulated completed run while keeping the project and job controls', async ({
  page,
  kerfdesk,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(applicationHeader(page)).toContainText('KerfDesk');
  await expect(page.locator('#app-splash')).toHaveCount(0);
  await (await toolbarCommand(page, 'Open...')).click();
  await expect(page.getByLabel('Current project')).not.toContainText('Untitled project');
  const before = await page.evaluate(async () => {
    const fixturePath = '/src/ui/laser/CompletedJobNotice.test-support.ts';
    const storePath = '/src/ui/state/store.ts';
    const fixture = await import(/* @vite-ignore */ fixturePath);
    const { useStore } = await import(/* @vite-ignore */ storePath);
    fixture.showCompletedRun();
    return JSON.stringify(useStore.getState().project);
  });
  await expect(page.getByRole('region', { name: 'Completed job', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('completed-simulated-laptop.png') });
  await page.setViewportSize({ width: 640, height: 450 });
  const done = page.getByRole('button', { name: 'Done', exact: true });
  const start = page.getByRole('button', { name: 'Start', exact: true });
  await expect(done).toBeVisible();
  await expect(start).toBeVisible();
  // With the import-machine banner in a very short window, the dock can scroll
  // locally. Both actions must remain reachable without scrolling the page.
  await done.scrollIntoViewIfNeeded();
  const doneBounds = await done.boundingBox();
  await start.scrollIntoViewIfNeeded();
  const startBounds = await start.boundingBox();
  expect((doneBounds?.y ?? 450) + (doneBounds?.height ?? 1)).toBeLessThanOrEqual(450);
  expect((startBounds?.y ?? 450) + (startBounds?.height ?? 1)).toBeLessThanOrEqual(450);
  await page.screenshot({ path: testInfo.outputPath('completed-simulated-compact.png') });
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(451);
  const eventsBefore = await kerfdesk.events();
  await done.click();
  await expect(page.getByRole('region', { name: 'Completed job', exact: true })).toHaveCount(0);
  const after = await page.evaluate(async () => {
    const storePath = '/src/ui/state/store.ts';
    const laserPath = '/src/ui/state/laser-store.ts';
    const { useStore } = await import(/* @vite-ignore */ storePath);
    const { useLaserStore } = await import(/* @vite-ignore */ laserPath);
    return {
      project: JSON.stringify(useStore.getState().project),
      runCleared: useLaserStore.getState().liveCanvasRun === null,
    };
  });
  expect(after.project).toBe(before);
  expect(after.runCleared).toBe(true);
  expect(await kerfdesk.events()).toEqual(eventsBefore);
});
