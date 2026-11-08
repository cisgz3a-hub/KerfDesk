// Rolling audit v10 V2-P2-2 (ADR-637 Amendment 8): KerfDesk 1.0.29's first
// Connect to a stock GRBL with laser mode off saved the laser starter as a CNC.
// This build restores that machine, connects the simulated GRBL at `$32=0`,
// and must not let a job start until the operator says whether it is a laser.
// The simulated controller only: nothing here streams a job.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from './fixtures/kerfdesk-test';
import { expectControllerSettingsRead } from './fixtures/controller-settings-read';
import { applicationHeader } from './fixtures/workspace-ui';

const LAST_MACHINE_KEY = 'kerfdesk.last-machine.v1';
const CONFIGURED_KEY = 'laserforge.device-setup.configured.v1';
const ANSWER_KEY = 'kerfdesk.converted-laser-answer.v1';
const SAVED_BY_1_0_29 = readFileSync(
  fileURLToPath(
    new URL(
      '../src/__fixtures__/returning-user/1.0.29-laser-made-cnc-last-machine.json',
      import.meta.url,
    ),
  ),
  'utf8',
);

test('the CNC 1.0.29 made from a laser cannot start until the operator answers', async ({
  page,
  kerfdesk,
}, testInfo) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await expect(applicationHeader(page)).toContainText('KerfDesk');
  // What 1.0.29 left in browser storage: the last machine and its setup record.
  await page.evaluate(
    async ({ document, lastMachineKey, configuredKey, answerKey }) => {
      const nudgeUrl = '/src/ui/laser/device-setup/device-setup-nudge.ts';
      const { deviceProfileSignature } = (await import(nudgeUrl)) as {
        deviceProfileSignature: (profile: unknown, kind: 'cnc') => string;
      };
      const parsed = JSON.parse(document) as { profile: unknown };
      localStorage.setItem(lastMachineKey, document);
      localStorage.setItem(
        configuredKey,
        JSON.stringify([deviceProfileSignature(parsed.profile, 'cnc')]),
      );
      localStorage.removeItem(answerKey);
    },
    {
      document: SAVED_BY_1_0_29,
      lastMachineKey: LAST_MACHINE_KEY,
      configuredKey: CONFIGURED_KEY,
      answerKey: ANSWER_KEY,
    },
  );
  await page.reload();
  expect(await machineKind(page)).toBe('cnc');

  // At startup, before any Connect: the canvas asks.
  const banner = page.getByRole('status', { name: 'Is this machine a laser?', exact: true });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('turns the laser on at full power');

  // Stock GRBL 1.1h: `$30=1000`, `$32=0`.
  await kerfdesk.setSerialSetting(32, '0');
  const toolbar = page.getByRole('region', {
    name: 'Machine toolbar',
    exact: true,
    includeHidden: true,
  });
  await toolbar.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(
    toolbar.getByRole('button', { name: 'Disconnect', exact: true, includeHidden: true }),
  ).toBeEnabled();
  await expectControllerSettingsRead(page);
  await expect(banner).toContainText('Your controller reports laser mode off ($32=0)');
  await expect(banner).toContainText('$30=1000 (the power scale lasers use)');

  await openStartReview(page);
  const review = page.getByRole('dialog', { name: 'Review job before starting', exact: true });
  const question = review.getByRole('region', { name: 'Is this machine a laser?', exact: true });
  await expect(question).toBeVisible();
  await expect(question).toContainText('laser mode off ($32=0)');
  const start = review.getByRole('button', { name: 'Start job', exact: true });
  await expect(start).toBeDisabled();
  await expect(start).toHaveAttribute(
    'title',
    'Answer whether this machine is a laser before starting.',
  );
  // The review shows the spindle program the question exists for.
  expect(await reviewedProgram(page)).toMatch(/M3 S12000[\s\S]*G4 P3\.000/);
  // Nothing past the button either: the store refuses a confirm.
  expect(await confirmFromStore(page)).toBeNull();
  await review.screenshot({ path: testInfo.outputPath('converted-laser-review.png') });

  await question.getByRole('button', { name: 'This is a CNC router', exact: true }).click();
  await expect(question).toHaveCount(0);
  await expect(start).not.toHaveAttribute(
    'title',
    'Answer whether this machine is a laser before starting.',
  );
  expect(await page.evaluate((key) => localStorage.getItem(key), ANSWER_KEY)).toBe('cnc-router');
  await review.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(review).toHaveCount(0);
  await expect(banner).toHaveCount(0);

  // No spindle or laser command ever reached the simulated controller.
  const writes = (await kerfdesk.events())
    .filter((event) => event.kind === 'serial-write')
    .map((event) => String(event['text']));
  expect(writes.some((text) => /\bM[34]\b/.test(text))).toBe(false);
});

test('"It\'s a laser" opens Machine Setup, where Laser and Save make it a laser', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.evaluate(
    ({ document, lastMachineKey, answerKey }) => {
      localStorage.setItem(lastMachineKey, document);
      localStorage.removeItem(answerKey);
    },
    { document: SAVED_BY_1_0_29, lastMachineKey: LAST_MACHINE_KEY, answerKey: ANSWER_KEY },
  );
  await page.reload();
  expect(await machineKind(page)).toBe('cnc');

  const banner = page.getByRole('status', { name: 'Is this machine a laser?', exact: true });
  await banner.getByRole('button', { name: "It's a laser: open Machine Setup" }).click();
  const setup = page.getByRole('dialog', { name: 'CNC Machine Setup', exact: true });
  await expect(setup).toBeVisible();
  await setup.getByRole('button', { name: "It's a laser", exact: true }).click();
  // Only Save changes the machine.
  expect(await machineKind(page)).toBe('cnc');
  const laserSetup = page.getByRole('dialog', { name: 'Machine Setup', exact: true });
  await saveSetup(laserSetup);
  expect(await machineKind(page)).toBe('laser');
  await expect(banner).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), ANSWER_KEY)).toBeNull();
});

async function machineKind(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const stateUrl = '/src/ui/state/index.ts';
    const { useStore } = (await import(stateUrl)) as {
      useStore: { getState: () => { project: { machine?: { kind: string } } } };
    };
    return useStore.getState().project.machine?.kind ?? 'laser';
  });
}

async function saveSetup(setup: Locator): Promise<void> {
  await setup.getByRole('button', { name: 'Go to step 3: Review & save', exact: true }).click();
  await expect(setup).toContainText('Step 3 of 3');
  await setup.getByRole('button', { name: 'Save machine setup', exact: true }).click();
  await expect(setup).toHaveCount(0);
}

// Opens the real Job Review gate on the current job, as Start does after a
// Frame, without a Frame or a stream: a square on the restored machine.
async function openStartReview(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const stateUrl = '/src/ui/state/index.ts';
    const laserUrl = '/src/ui/state/laser-store.ts';
    const cameraUrl = '/src/ui/state/camera-store.ts';
    const sourceUrl = '/src/ui/laser/start-job-source.ts';
    const gateUrl = '/src/ui/laser/job-review/job-review-gate.ts';
    const evidenceUrl = '/src/ui/state/laser-mode-start-evidence.ts';
    const { useStore } = (await import(stateUrl)) as {
      useStore: {
        getState: () => {
          importSvgFragment: (fragment: object) => void;
          project: object;
        };
        setState: (patch: object) => void;
      };
    };
    const { useLaserStore } = (await import(laserUrl)) as {
      useLaserStore: { getState: () => object };
    };
    const { useCameraStore } = (await import(cameraUrl)) as {
      useCameraStore: { getState: () => object };
    };
    const { prepareCurrentStartJob } = (await import(sourceUrl)) as {
      prepareCurrentStartJob: (...args: unknown[]) => Promise<{
        ok: boolean;
        gcode?: string;
        messages?: string[];
      }>;
    };
    const { runJobReviewGate } = (await import(gateUrl)) as {
      runJobReviewGate: (args: object) => Promise<unknown>;
    };
    const { captureLaserModeStartSnapshot } = (await import(evidenceUrl)) as {
      captureLaserModeStartSnapshot: (laser: object) => object;
    };
    const bounds = { minX: 0, minY: 0, maxX: 40, maxY: 40 };
    useStore.getState().importSvgFragment({
      source: 'square.svg',
      bounds,
      objects: [
        {
          kind: 'imported-svg',
          id: 'square',
          source: 'square.svg',
          bounds,
          transform: {
            x: 0,
            y: 0,
            scaleX: 1,
            scaleY: 1,
            rotationDeg: 0,
            mirrorX: false,
            mirrorY: false,
          },
          paths: [
            {
              color: '#000000',
              polylines: [
                {
                  points: [
                    { x: 0, y: 0 },
                    { x: 40, y: 0 },
                    { x: 40, y: 40 },
                    { x: 0, y: 40 },
                  ],
                  closed: true,
                },
              ],
            },
          ],
        },
      ],
    });
    useStore.setState({ jobPlacement: { startFrom: 'current-position', anchor: 'front-left' } });
    const app = useStore.getState();
    const laser = useLaserStore.getState();
    const prepared = await prepareCurrentStartJob(
      app,
      laser,
      useCameraStore.getState(),
      undefined,
      false,
    );
    if (!prepared.ok)
      throw new Error(`Preparation failed: ${(prepared.messages ?? []).join(' / ')}`);
    (window as typeof window & { __reviewedProgram?: string }).__reviewedProgram =
      prepared.gcode ?? '';
    void runJobReviewGate({
      initial: {
        app,
        project: app.project,
        laser,
        prepared,
        laserModeStartSnapshot: captureLaserModeStartSnapshot(laser),
      },
      completedReceipt: null,
      purpose: 'start',
    });
  });
}

async function reviewedProgram(page: Page): Promise<string> {
  return page.evaluate(
    () => (window as typeof window & { __reviewedProgram?: string }).__reviewedProgram ?? '',
  );
}

async function confirmFromStore(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const reviewUrl = '/src/ui/laser/job-review/job-review-store.ts';
    const { useJobReviewStore } = (await import(reviewUrl)) as {
      useJobReviewStore: { getState: () => { confirm: () => void; pendingSignal: string | null } };
    };
    useJobReviewStore.getState().confirm();
    return useJobReviewStore.getState().pendingSignal;
  });
}
