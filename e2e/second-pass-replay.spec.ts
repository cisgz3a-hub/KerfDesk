import { test, expect } from './fixtures/kerfdesk-test';
import { recoveryExecutionLinesSince } from './fixtures/recovery-execution-lines';
import {
  IDLE,
  capsuleProbe,
  collectRefusals,
  confirmJobReview,
  connectAndHome,
  dismissNotifications,
  drainHeldSerialWrites,
  frameCurrentJob,
  queuedJobLines,
  serialWriteLineCount,
  streamProbe,
} from './fixtures/recovery-flow';

test('a new painted pass seals writer 3 and resumes its exact interrupted program', async ({
  page,
  kerfdesk,
}) => {
  test.setTimeout(180_000);
  const refusals = collectRefusals(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open...' }).click();
  await expect(page).toHaveTitle(/project-basic\.lf2/);
  await dismissNotifications(page);
  await connectAndHome(page, kerfdesk);
  await frameCurrentJob(page, kerfdesk);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await confirmJobReview(page, kerfdesk);
  await page
    .getByRole('dialog', { name: 'Job complete', exact: true })
    .getByRole('button', { name: 'Darken selected areas…' })
    .click();

  const workbench = page.getByRole('dialog', { name: 'Paint a second pass', exact: true });
  const canvas = workbench.getByRole('img', {
    name: 'Paint second-pass areas on the saved engraving',
  });
  await expect(canvas).toBeVisible();
  await dismissNotifications(page);
  await workbench.getByLabel('Brush diameter (mm)').fill('100');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Second-pass canvas did not open.');
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await workbench.getByRole('button', { name: 'Preview second pass', exact: true }).click();
  await workbench.getByRole('button', { name: 'Frame second pass', exact: true }).click();
  await expect(
    workbench.getByRole('button', { name: 'Start second pass', exact: true }),
  ).toBeEnabled();
  await kerfdesk.setAutoAcknowledge(false);
  await workbench.getByRole('button', { name: 'Start second pass', exact: true }).click();
  await confirmJobReview(
    page,
    kerfdesk,
    page
      .getByRole('dialog', { name: 'Review painted second pass' })
      .getByRole('button', { name: 'Start second pass', exact: true }),
  );
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  const originalSent = await queuedJobLines(page);
  expect(originalSent.length).toBeGreaterThan(5);
  await kerfdesk.acknowledgeSerial(1);
  await kerfdesk.disconnectSerial();
  const recovery = page.locator('details[aria-label="Interrupted job recovery"]');
  await expect(recovery.getByText('Interrupted job saved', { exact: true })).toBeVisible();
  const capsule = await capsuleProbe(page);
  if (!capsule) throw new Error('Interrupted second pass was not archived.');
  expect(
    capsule.gcode
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith(';')),
  ).toEqual(originalSent);
  const writerVersion = await page.evaluate(async () => {
    const { recoveryRepository } = (await import('/src/ui/state/recovery/index.ts' as string)) as {
      recoveryRepository: {
        getSnapshot: () => {
          recoveryCapsule: {
            artifact: { laserSecondPassChain?: readonly { writerVersion?: number }[] };
          } | null;
        };
      };
    };
    return recoveryRepository.getSnapshot().recoveryCapsule?.artifact.laserSecondPassChain?.at(-1)
      ?.writerVersion;
  });
  expect(writerVersion).toBe(3);

  await kerfdesk.setAutoAcknowledge(true);
  await connectAndHome(page, kerfdesk, { closeRecoveryReview: true });
  await recovery.getByText('Interrupted job saved', { exact: true }).click();
  await recovery.getByRole('button', { name: 'Review recovery', exact: true }).click();
  await kerfdesk.setAutoAcknowledge(false);
  const baseline = serialWriteLineCount(await kerfdesk.events());
  const mark = (await kerfdesk.events()).length;
  const review = page.getByRole('dialog', { name: 'Review interrupted laser job' });
  await confirmJobReview(
    page,
    kerfdesk,
    review.getByRole('button', { name: 'Start supervised recovery', exact: true }),
  );
  await expect(review).not.toBeVisible();
  await drainHeldSerialWrites(page, kerfdesk, baseline, 400);
  expect(recoveryExecutionLinesSince(kerfdesk, await kerfdesk.events(), mark)).toEqual([
    ...capsule.expectedSent,
    'G4 P0.01',
  ]);
  await kerfdesk.emitSerialLine(IDLE);
  await expect.poll(async () => (await streamProbe(page)).status).toBeNull();
  expect(refusals()).toEqual([]);
});
