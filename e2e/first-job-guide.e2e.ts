// ADR-698: the guided first job against the simulated GRBL controller. The
// guide only points; every step here is the operator pressing the real control,
// and the guide moves on because the app's state changed.
import { test, expect, type Page } from './fixtures/kerfdesk-test';
import {
  confirmJobReview,
  frameCurrentJob,
  runMenuCommand,
  serialWrites,
} from './fixtures/recovery-flow';
import {
  connectMachineThroughToolbar,
  machineJogAction,
  selectWorkspacePanel,
} from './fixtures/workspace-ui';

function guide(page: Page) {
  return page.getByRole('complementary', { name: 'Guided first job', exact: true });
}

async function highlighted(page: Page): Promise<string | undefined> {
  return page.evaluate(() => document.body.dataset['firstJobTarget']);
}

test('the guided first job follows connect, machine, artwork, material, Frame and Start', async ({
  page,
  kerfdesk,
}, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await runMenuCommand(page, 'Help', 'Guided first job…');
  const panel = guide(page);
  await expect(panel).toContainText('Step 1 of 6: Connect your laser');
  expect(await highlighted(page)).toBe('connect');
  await page.screenshot({ path: testInfo.outputPath('guide-1-connect.png') });

  // 1 and 2: the real Connect opens Machine Setup for a new profile; saving it
  // is the machine step. The guide pressed neither.
  expect((await kerfdesk.events()).filter((event) => event.kind === 'serial-open')).toHaveLength(0);
  await connectMachineThroughToolbar(page);
  const setup = page.getByRole('dialog', { name: 'Machine Setup', exact: true });
  await expect(setup).toBeVisible();
  // The modal hides the workspace, the guide with it, from assistive tech.
  await expect(
    page.getByRole('complementary', { name: 'Guided first job', includeHidden: true }),
  ).toContainText('Step 2 of 6: Choose your machine');
  expect(await highlighted(page)).toBe('machine-setup');
  await setup.getByRole('button', { name: 'Go to step 3: Review & save', exact: true }).click();
  await setup.getByRole('button', { name: 'Save machine setup', exact: true }).click();
  await expect(setup).toHaveCount(0);

  // 3: artwork, by the operator's own click on the sample.
  await expect(panel).toContainText('Step 3 of 6: Put something on the canvas');
  await panel.getByRole('button', { name: 'Add a sample circle', exact: true }).click();

  // 4: material. "Show me" opens the Artwork panel at Materials, highlighted.
  await expect(panel).toContainText('Step 4 of 6: Pick a material preset');
  expect(await highlighted(page)).toBe('materials-tab');
  await panel.getByRole('button', { name: 'Show me Materials', exact: true }).click();
  const materials = page.locator('[data-search-target="materials-tab"]');
  await expect(materials).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('guide-4-material.png') });
  // The simulated machine has no preset library; the operator uses the
  // maker's settings and says so.
  await panel.getByRole('button', { name: 'Skip this step', exact: true }).click();

  // 5: Frame. The saved profile has homing off, so the operator sets the
  // origin where the head is, as the step says, then frames. Nothing has moved
  // before that: the guide sent no jog.
  await expect(panel).toContainText('Step 5 of 6: Frame it');
  await expect(panel).toContainText('press Set origin here');
  expect(await highlighted(page)).toBe('frame-job');
  await selectWorkspacePanel(page, 'Machine');
  await expect(page.getByText('State: Idle', { exact: true })).toBeVisible();
  expect(serialWrites(await kerfdesk.events())).not.toContain('$J=');
  await machineJogAction(page, 'Set origin here').click();
  await frameCurrentJob(page, kerfdesk);

  // 6: Start, Job Review, Start job: the ordinary gate, unchanged.
  await expect(panel).toContainText('Step 6 of 6: Start and stay with it');
  expect(await highlighted(page)).toBe('start-job');
  await page.screenshot({ path: testInfo.outputPath('guide-6-start.png') });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Review job before starting' })).toBeVisible();
  await confirmJobReview(page, kerfdesk);
  // The 40 mm circle finishes at once; the guide stays finished after the
  // operator dismisses Job complete.
  const complete = page.getByRole('dialog', { name: 'Job complete', exact: true });
  await expect(complete).toBeVisible();
  await complete.getByRole('button', { name: 'Not now', exact: true }).click();
  await expect(panel).toContainText('Your first job is under way');
  expect(await highlighted(page)).toBeUndefined();
  await panel.screenshot({ path: testInfo.outputPath('guide-done.png') });
});
