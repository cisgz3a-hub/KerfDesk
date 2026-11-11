// Annoyance audit A2 B4-P1-1 (ADR-416 Amendment 4), in the real workspace: a
// multi-bit CNC job is opened, zeroed, framed, reviewed and started with the
// app's own buttons, and each bit change is worked on the Machine rail and the
// Live Motion bar. Before the fix the rail's Zero Z recorded Work Z for the
// project's Default bit, Continue stayed off at every bit change, and only
// Abort ended the job.
//
// The controller is the scripted GRBL simulator of the unit suites, loaded in
// the page and connected through the store, because it models Z, work offsets
// and a planner; the specs' serial fixtures do not move Z.

import { test, expect, type KerfDeskFixture, type Page } from './fixtures/kerfdesk-test';
import { dismissNotifications } from './fixtures/recovery-flow';
import { selectWorkspacePanel, toolbarCommand } from './fixtures/workspace-ui';
import { multiBitCncProject, starterBitName } from '../src/__fixtures__/cnc-multi-bit-project';

test.use({ viewport: { width: 1440, height: 1000 } });

const FIRST = 'em-3175'; // the project's Default bit
const SECOND = 'em-6350';
const THIRD = 'em-9525';
const JOB_TIMEOUT_MS = 120_000;

interface RunFacts {
  readonly streaming: boolean;
  readonly status: string | null;
  readonly workZToolId: string | null;
  readonly pendingToolId: string | null;
  readonly defaultBit: string | null;
  readonly projectDirty: boolean;
  readonly machine: string;
  readonly spindle: number;
  readonly spindleStarts: number;
  readonly problems: string[];
}

/** Opens the project, then connects the in-page GRBL simulator. */
async function openAndConnect(
  page: Page,
  kerfdesk: KerfDeskFixture,
  bits: readonly string[],
): Promise<void> {
  // CNC Start asks its setup attestation in a native box; the operator accepts it.
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/');
  await kerfdesk.setOpenFiles([
    { name: 'bit-change.lf2', text: JSON.stringify(multiBitCncProject(bits)) },
  ]);
  await (await toolbarCommand(page, 'Open...')).click();
  await expect(page).toHaveTitle(/bit-change\.lf2/);
  await page.evaluate(async () => {
    const simulatorUrl = '/src/__fixtures__/controllers/index.ts';
    const laserUrl = '/src/ui/state/laser-store.ts';
    const { createGrblSimulator } = (await import(/* @vite-ignore */ simulatorUrl)) as {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the unit suites' simulator, built in the page
      createGrblSimulator: (options: unknown) => any;
    };
    const { useLaserStore } = (await import(/* @vite-ignore */ laserUrl)) as {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the app store, read in the page
      useLaserStore: any;
    };
    // Stock GRBL 1.1 with laser mode off: a 15-block planner, 5 ms a block.
    const simulator = createGrblSimulator({
      plannerBlocks: 15,
      motionMs: 5,
      settings: [[32, '0']],
    });
    (window as unknown as { __BIT_CHANGE_SIM__: unknown }).__BIT_CHANGE_SIM__ = simulator;
    await useLaserStore.getState().connect(simulator.adapter);
  });
  await selectWorkspacePanel(page, 'Machine');
  await expect(page.getByText('State: Idle', { exact: true })).toBeVisible({ timeout: 30_000 });
  await dismissNotifications(page);
}

function facts(page: Page): Promise<RunFacts> {
  return page.evaluate(async () => {
    const laserUrl = '/src/ui/state/laser-store.ts';
    const stateUrl = '/src/ui/state/store.ts';
    const { useLaserStore } = (await import(/* @vite-ignore */ laserUrl)) as {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the app store, read in the page
      useLaserStore: any;
    };
    const { useStore } = (await import(/* @vite-ignore */ stateUrl)) as {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the app store, read in the page
      useStore: any;
    };
    const laser = useLaserStore.getState();
    const app = useStore.getState();
    const simulator = (
      window as unknown as {
        __BIT_CHANGE_SIM__: {
          state: () => { machine: string; spindle: number };
          outbound: () => readonly string[];
        };
      }
    ).__BIT_CHANGE_SIM__;
    const sentLines = simulator.outbound().join('').split('\n');
    return {
      streaming: laser.streamer !== null,
      status: laser.streamer?.status ?? null,
      workZToolId: laser.workZZeroEvidence?.toolId ?? null,
      pendingToolId: laser.pendingToolId ?? null,
      defaultBit: app.project.machine?.toolId ?? null,
      projectDirty: app.dirty === true,
      machine: simulator.state().machine,
      spindle: simulator.state().spindle,
      spindleStarts: sentLines.filter((line: string) => /M3\b/.test(line)).length,
      problems: [
        ...(laser.alarmCode === null ? [] : [`ALARM:${String(laser.alarmCode)}`]),
        ...(laser.safetyNotice === null ? [] : [String(laser.safetyNotice.message)]),
        ...(laser.log as string[]).filter((line) => /error:|ALARM/i.test(line)),
      ],
    };
  });
}

const zeroZButton = (page: Page) =>
  page.getByRole('button', { name: 'Zero work Z at current bit height', exact: true });

const continueButton = (page: Page) =>
  page
    .getByRole('group', { name: 'Live machine controls', exact: true })
    .getByRole('button', { name: 'Continue', exact: true });

const spindleBit = (page: Page) =>
  page.getByRole('combobox', { name: 'Bit in the spindle', exact: true });

/** Presses the rail's Zero Z and waits until Work Z is recorded for `toolId`. */
async function zeroZ(page: Page, toolId: string): Promise<void> {
  await expect(zeroZButton(page)).toBeEnabled({ timeout: 30_000 });
  await zeroZButton(page).click();
  await expect.poll(async () => (await facts(page)).workZToolId).toBe(toolId);
  await dismissNotifications(page);
}

/** Frame job, Start, Job Review's Start job, then the run to its first bit change. */
async function frameAndStartToHold(page: Page, awaited: string): Promise<void> {
  const start = page.getByRole('button', { name: 'Start', exact: true });
  await page.getByRole('button', { name: 'Frame job', exact: true }).click();
  await expect(start).toBeEnabled({ timeout: JOB_TIMEOUT_MS });
  await start.click();
  await page
    .getByRole('dialog', { name: 'Review job before starting' })
    .getByRole('button', { name: 'Start job' })
    .click();
  await expectHoldFor(page, awaited);
}

/** The job is held, settled, for `awaited`, and Continue is off until its Z zero. */
async function expectHoldFor(page: Page, awaited: string): Promise<void> {
  await expect(continueButton(page)).toBeVisible({ timeout: JOB_TIMEOUT_MS });
  await expect.poll(async () => (await facts(page)).pendingToolId).toBe(awaited);
  await expect(zeroZButton(page)).toBeEnabled({ timeout: 30_000 });
  await expect(
    page.getByText(`Load ${starterBitName(awaited)} and re-zero Z on the stock top`).first(),
  ).toBeVisible();
  await expect(spindleBit(page)).toHaveValue(awaited);
  await expect(continueButton(page)).toHaveAttribute('aria-disabled', 'true');
  await expect(continueButton(page)).toHaveAttribute('title', /establish its Z zero/);
}

async function pressContinue(page: Page): Promise<void> {
  await expect(continueButton(page)).not.toHaveAttribute('aria-disabled', 'true');
  await continueButton(page).click();
}

/** The job ran every bit's section to a clean end and did not edit the project. */
async function expectCompleted(page: Page, bits: readonly string[]): Promise<void> {
  await expect
    .poll(async () => (await facts(page)).streaming, { timeout: JOB_TIMEOUT_MS })
    .toBe(false);
  await expect.poll(async () => (await facts(page)).machine, { timeout: 30_000 }).toBe('Idle');
  const end = await facts(page);
  expect(end.problems).toEqual([]);
  expect(end.spindle).toBe(0);
  expect(end.spindleStarts).toBe(bits.length);
  expect(end.defaultBit).toBe(FIRST);
  expect(end.projectDirty).toBe(false);
}

test('a two-bit CNC job continues past its bit change and completes', async ({
  page,
  kerfdesk,
}) => {
  test.setTimeout(300_000);
  const bits = [FIRST, SECOND];
  await openAndConnect(page, kerfdesk, bits);
  await zeroZ(page, FIRST);
  await frameAndStartToHold(page, SECOND);
  await expect(
    page.getByText(
      `This job is waiting for ${starterBitName(SECOND)}. Zero Z and the probe now record Work Z for it.`,
    ),
  ).toBeVisible();
  await expect(page.getByText('Active bit')).toHaveCount(0);

  await zeroZ(page, SECOND);
  await pressContinue(page);
  await expectCompleted(page, bits);
  // The bit stays declared after the job: it is still in the spindle.
  await expect(spindleBit(page)).toHaveValue(SECOND);
});

test('a three-bit CNC job continues past both bit changes and completes', async ({
  page,
  kerfdesk,
}) => {
  test.setTimeout(300_000);
  const bits = [FIRST, SECOND, THIRD];
  await openAndConnect(page, kerfdesk, bits);
  await zeroZ(page, FIRST);
  await frameAndStartToHold(page, SECOND);
  await zeroZ(page, SECOND);
  await pressContinue(page);

  // The second hold asks for a bit that was never the project's Default bit.
  await expectHoldFor(page, THIRD);
  await zeroZ(page, THIRD);
  await pressContinue(page);
  await expectCompleted(page, bits);
});

test('Continue stays off while Z was zeroed with another bit declared', async ({
  page,
  kerfdesk,
}) => {
  test.setTimeout(300_000);
  const bits = [FIRST, SECOND];
  await openAndConnect(page, kerfdesk, bits);
  await zeroZ(page, FIRST);
  await frameAndStartToHold(page, SECOND);

  // The operator says the first bit is still in the spindle, and zeroes it.
  await spindleBit(page).selectOption(FIRST);
  await expect(
    page.getByText(
      `This job is waiting for ${starterBitName(SECOND)}, but ${starterBitName(FIRST)} is chosen here.`,
      { exact: false },
    ),
  ).toBeVisible();
  await zeroZ(page, FIRST);
  await expect(continueButton(page)).toHaveAttribute('aria-disabled', 'true');
  await expect(continueButton(page)).toHaveAttribute(
    'title',
    new RegExp(
      `Work Z belongs to a different bit\\. Load ${starterBitName(SECOND).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, choose it under Bit in the spindle`,
    ),
  );
  // A press on the blocked Continue leaves the job held.
  await continueButton(page).click();
  expect((await facts(page)).status).toBe('tool-change');

  // Choosing the right bit is not enough: the record keeps the bit it was taken with.
  await spindleBit(page).selectOption(SECOND);
  await expect(continueButton(page)).toHaveAttribute('aria-disabled', 'true');

  // Zeroing again with the right bit declared unlocks Continue.
  await zeroZ(page, SECOND);
  await pressContinue(page);
  await expectCompleted(page, bits);
});
