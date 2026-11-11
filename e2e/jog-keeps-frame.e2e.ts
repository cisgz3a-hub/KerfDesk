// ADR-565 Amendment 1 (user annoyance audit A2-D-2): after a Frame, a plain jog
// keeps Start enabled when the job is placed by a fixed origin, and the job
// then burns where it was framed. A Current Position job still needs a new
// Frame. The controller is the in-page journey GRBL, which moves its head
// (fixtures/journey-grbl-serial.js).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from './fixtures/kerfdesk-test';
import { dismissNotifications, reopenProject } from './fixtures/recovery-flow';
import {
  connectMachineThroughToolbar,
  machineJogAction,
  selectWorkspacePanel,
} from './fixtures/workspace-ui';

const journeyGrbl = readFileSync(
  fileURLToPath(new URL('./fixtures/journey-grbl-serial.js', import.meta.url)),
  'utf8',
);

interface HeadPosition {
  readonly wx: number;
  readonly wy: number;
  readonly ox: number;
  readonly oy: number;
}
interface JourneyWindow {
  readonly __JOURNEY_GRBL__: {
    readonly wire: string[];
    readonly position: () => HeadPosition;
    readonly place: (x: number, y: number) => void;
  };
}
type StartFrom = 'absolute' | 'user-origin' | 'current-position';
interface Box {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

const wire = (page: Page): Promise<string[]> =>
  page.evaluate(() => [...(window as unknown as JourneyWindow).__JOURNEY_GRBL__.wire]);

const head = (page: Page): Promise<HeadPosition> =>
  page.evaluate(() => (window as unknown as JourneyWindow).__JOURNEY_GRBL__.position());

async function setPlacement(page: Page, startFrom: StartFrom): Promise<void> {
  await page.evaluate(async (mode) => {
    const modulePath = '/src/ui/state/store.ts';
    const { useStore } = (await import(/* @vite-ignore */ modulePath)) as {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the app store, read in the page
      useStore: any;
    };
    const state = useStore.getState();
    state.setProject({
      ...state.project,
      jobSetup: {
        ...state.project.jobSetup,
        placement: { ...state.project.jobSetup.placement, startFrom: mode },
      },
    });
  }, startFrom);
}

/** The X and Y extent of the absolute motion lines `keep` selects. */
function extent(lines: readonly string[], keep: (line: string) => boolean): Box {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const line of lines.filter(keep)) {
    const x = /X(-?\d+(?:\.\d+)?)/.exec(line);
    const y = /Y(-?\d+(?:\.\d+)?)/.exec(line);
    if (x !== null) xs.push(Number(x[1]));
    if (y !== null) ys.push(Number(y[1]));
  }
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

async function openConnectedAndFrame(page: Page, startFrom: StartFrom): Promise<Box> {
  await page.addInitScript({
    content: 'window.__JOURNEY_GRBL_CONFIG__ = { blocksPerSecond: 200 };',
  });
  await page.addInitScript({ content: journeyGrbl });
  await page.goto('/');
  await reopenProject(page);
  await connectMachineThroughToolbar(page);
  const setup = page.getByRole('dialog', { name: 'Machine Setup', exact: true });
  if (
    await setup.waitFor({ timeout: 10_000 }).then(
      () => true,
      () => false,
    )
  ) {
    await setup.getByRole('button', { name: 'Cancel without saving', exact: true }).click();
    await expect(setup).not.toBeVisible();
  }
  await selectWorkspacePanel(page, 'Machine');
  await expect(page.getByText('State: Idle', { exact: true })).toBeVisible({ timeout: 30_000 });
  await setPlacement(page, startFrom);
  if (startFrom === 'user-origin') {
    // A work origin away from machine zero, so work and machine numbers differ.
    await page.evaluate(() => (window as unknown as JourneyWindow).__JOURNEY_GRBL__.place(60, 40));
    await page.waitForTimeout(2_500);
    await machineJogAction(page, 'Set origin here').click();
    await expect.poll(() => head(page).then((at) => at.ox)).toBeCloseTo(60, 3);
  }
  await dismissNotifications(page);
  const before = (await wire(page)).length;
  const start = page.getByRole('button', { name: 'Start', exact: true });
  await expect(start).toBeDisabled();
  await page.getByRole('button', { name: 'Frame job', exact: true }).click();
  await expect(start).toBeEnabled({ timeout: 120_000 });
  await expect(page.getByText('Ready to start — framed placement unchanged')).toBeVisible();
  const corners = (await wire(page))
    .slice(before)
    .filter((line) => line.startsWith('$J=G90'))
    .slice(0, 5);
  expect(corners).toHaveLength(5);
  return extent(corners, () => true);
}

/** One step press on the jog pad's +X arrow, waited to its settled end. */
async function jogAway(page: Page): Promise<void> {
  const from = await head(page);
  await page
    .getByRole('region', { name: 'Jog and positioning', exact: true })
    .getByRole('button', { name: /^Jog \+X \d/ })
    .click();
  await expect.poll(() => head(page).then((at) => at.wx)).toBeGreaterThan(from.wx);
  await expect(page.getByText('State: Idle', { exact: true })).toBeVisible({ timeout: 30_000 });
}

test.use({ viewport: { width: 1440, height: 1000 } });

for (const startFrom of ['absolute', 'user-origin'] as const) {
  test(`${startFrom}: Frame, jog away, and Start burns where the Frame traced`, async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const framed = await openConnectedAndFrame(page, startFrom);
    const start = page.getByRole('button', { name: 'Start', exact: true });

    await jogAway(page);
    await jogAway(page);
    // The Frame is kept: no new Frame, and Start is ready again at once.
    await expect(start).toBeEnabled({ timeout: 30_000 });
    await expect(page.getByText('Ready to start — framed placement unchanged')).toBeVisible();

    const beforeStart = (await wire(page)).length;
    await start.click();
    const review = page.getByRole('dialog', { name: 'Review job before starting' });
    await expect(review).toBeVisible({ timeout: 120_000 });
    await review.getByRole('button', { name: 'Start job' }).click();
    await expect(page.getByRole('dialog', { name: 'Job complete', exact: true })).toBeVisible({
      timeout: 120_000,
    });
    const program = (await wire(page)).slice(beforeStart);
    expect(program.some((line) => line.startsWith('$J='))).toBe(false);
    expect(program).toContain('G90');
    // Every cutting move lies on the outline the Frame traced, in the same
    // work coordinates, although the head started the job from elsewhere.
    const burned = extent(program, (line) => /^G0?1\b/.test(line) && /[XY]/.test(line));
    expect(burned).toEqual(framed);
  });
}

test('current-position: a jog after the Frame still needs a new Frame', async ({ page }) => {
  test.setTimeout(300_000);
  await openConnectedAndFrame(page, 'current-position');
  const start = page.getByRole('button', { name: 'Start', exact: true });

  await jogAway(page);
  await expect(start).toBeDisabled();
  await expect(page.getByText('Ready to start — framed placement unchanged')).toHaveCount(0);
  await page.waitForTimeout(1_500);
  await expect(start).toBeDisabled();

  await page.getByRole('button', { name: /^Frame (job|again)$/ }).click();
  await expect(start).toBeEnabled({ timeout: 120_000 });
});
