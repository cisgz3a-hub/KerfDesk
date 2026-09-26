// Adversarial browser-level checks for two operator promises (ADR-341):
// an interrupted engraving is saved at exactly its acknowledged line and can
// be resumed from there after reconnecting, and a cleanly finished engraving
// offers "darken selected areas" once. Runs in real Chrome against the fake
// Web Serial fixture; acknowledgements are held so the disconnect lands at a
// chosen line.

import { selectWorkspacePanel, toolbarCommand } from './fixtures/workspace-ui';
import { expect, test } from './fixtures/kerfdesk-test';
import {
  acknowledgeExactly,
  acknowledgeJobLinesOnly,
  capsuleProbe,
  collectRefusals,
  confirmJobReview,
  connectAndHome,
  dismissNotifications,
  drainHeldSerialWrites,
  frameCurrentJob,
  IDLE,
  programLinesSince,
  reopenProject,
  runMenuCommand,
  selectAll,
  serialWriteLineCount,
  streamProbe,
} from './fixtures/recovery-flow';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open...' }).click();
  await expect(page).toHaveTitle(/project-basic\.lf2/);
  await dismissNotifications(page);
});

for (const acked of [0, 1, 3, 5]) {
  test(`saves a disconnect at ${acked} acknowledged lines, survives reload, resumes exactly there and offers darkening`, async ({
    page,
    kerfdesk,
  }, testInfo) => {
    test.setTimeout(120_000);
    const refusals = collectRefusals(page);
    await connectAndHome(page, kerfdesk);
    await frameCurrentJob(page, kerfdesk);
    await kerfdesk.setAutoAcknowledge(false);
    const baselineLines = serialWriteLineCount(await kerfdesk.events());
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await confirmJobReview(page, kerfdesk);
    await expect
      .poll(async () => serialWriteLineCount(await kerfdesk.events()))
      .toBeGreaterThan(baselineLines);
    if (acked > 0) await kerfdesk.acknowledgeSerial(acked);
    await expect.poll(async () => (await streamProbe(page)).completed).toBe(acked);
    const total = (await streamProbe(page)).total;
    if (total === null || total <= acked) throw new Error('Expected an unfinished stream.');
    await kerfdesk.disconnectSerial();

    const recovery = page.locator('details[aria-label="Interrupted job recovery"]');
    await expect(recovery.getByText('Interrupted job saved', { exact: true })).toBeVisible();
    await expect(recovery.locator('summary')).toContainText(
      `${acked} of ${total} lines acknowledged`,
    );
    await expect(page.getByRole('dialog', { name: 'Job complete', exact: true })).toHaveCount(0);
    const saved = await capsuleProbe(page);
    if (saved === null) throw new Error('Expected the sealed capsule.');
    expect(saved.ackedLines).toBe(acked);
    expect(saved.sendableLines).toBe(total);
    expect(saved.interruption).toBe('disconnect');

    // The capsule is durable: a reload shows the same record, still no completion.
    await page.reload();
    await expect(page.getByRole('button', { name: 'Open...' })).toBeVisible();
    await selectWorkspacePanel(page, 'Machine');
    await expect(recovery.getByText('Interrupted job saved', { exact: true })).toBeVisible();
    await expect(recovery.locator('summary')).toContainText(
      `${acked} of ${total} lines acknowledged`,
    );
    await expect(page.getByRole('dialog', { name: 'Job complete', exact: true })).toHaveCount(0);
    const hydrated = await capsuleProbe(page);
    expect(hydrated).toEqual(saved);

    // The capsule outlives the project session; reopen the design as an
    // operator would, then resume from the sealed bytes.
    await reopenProject(page);
    await kerfdesk.setAutoAcknowledge(true);
    await connectAndHome(page, kerfdesk);
    await kerfdesk.setAutoAcknowledge(false);
    await recovery.getByText('Interrupted job saved', { exact: true }).click();
    await recovery.getByRole('button', { name: 'Review recovery', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Review interrupted laser job' });
    await expect(review).toContainText('Exact job artifact saved');
    await expect(review.getByRole('img', { name: /^Laser recovery canvas:/ })).toBeVisible();
    const resumeBaselineLines = serialWriteLineCount(await kerfdesk.events());
    const resumeMark = (await kerfdesk.events()).length;
    await confirmJobReview(
      page,
      kerfdesk,
      review.getByRole('button', { name: 'Start supervised recovery', exact: true }),
    );
    await expect(review).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    const burst = programLinesSince(await kerfdesk.events(), resumeMark);
    expect(burst.length).toBeGreaterThan(0);
    expect(saved.expectedSent.slice(0, burst.length)).toEqual(burst);

    await drainHeldSerialWrites(page, kerfdesk, resumeBaselineLines, 400);
    expect(programLinesSince(await kerfdesk.events(), resumeMark)).toEqual([
      ...saved.expectedSent,
      'G4 P0.01',
    ]);
    await kerfdesk.emitSerialLine(IDLE);
    const complete = page.getByRole('dialog', { name: 'Job complete', exact: true });
    await expect(complete).toContainText('Would you like to darken selected areas?');
    await expect(recovery).toHaveCount(0);
    await complete.screenshot({
      path: testInfo.outputPath(`resumed-after-${acked}-acks-offer.png`),
    });
    await complete.getByRole('button', { name: 'Darken selected areas…' }).click();
    const workbench = page.getByRole('dialog', { name: 'Paint a second pass', exact: true });
    await expect(
      workbench.getByRole('img', { name: 'Paint second-pass areas on the saved engraving' }),
    ).toBeVisible();
    await workbench.getByRole('button', { name: 'Close', exact: true }).click();
    expect(refusals()).toEqual([]);
  });
}

test('records a disconnect during post-job settle as an interruption of every line, never a completion', async ({
  page,
  kerfdesk,
}) => {
  test.setTimeout(120_000);
  const refusals = collectRefusals(page);
  await connectAndHome(page, kerfdesk);
  await frameCurrentJob(page, kerfdesk);
  await kerfdesk.setAutoAcknowledge(false);
  const baselineLines = serialWriteLineCount(await kerfdesk.events());
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await confirmJobReview(page, kerfdesk);
  await acknowledgeJobLinesOnly(page, kerfdesk, baselineLines);
  const settling = await streamProbe(page);
  expect(settling.status).toBe('done');
  expect(settling.operation).toBe('post-job-settle');
  const total = settling.total ?? 0;
  expect(settling.completed).toBe(total);
  await kerfdesk.disconnectSerial();

  const recovery = page.locator('details[aria-label="Interrupted job recovery"]');
  await expect(recovery.getByText('Interrupted job saved', { exact: true })).toBeVisible();
  await expect(recovery.locator('summary')).toContainText(
    `${total} of ${total} lines acknowledged`,
  );
  await page.waitForTimeout(1_000);
  await expect(page.getByRole('dialog', { name: 'Job complete', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Paint a second pass…', exact: true })).toHaveCount(
    0,
  );
  const saved = await capsuleProbe(page);
  expect(saved?.interruption).toBe('disconnect');
  expect(saved?.ackedLines).toBe(total);

  await page.reload();
  await expect(page.getByRole('button', { name: 'Open...' })).toBeVisible();
  await selectWorkspacePanel(page, 'Machine');
  await expect(recovery.locator('summary')).toContainText(
    `${total} of ${total} lines acknowledged`,
  );
  await expect(page.getByRole('dialog', { name: 'Job complete', exact: true })).toHaveCount(0);

  // The operator can still finish the job: recovery replays the final line.
  await reopenProject(page);
  await kerfdesk.setAutoAcknowledge(true);
  await connectAndHome(page, kerfdesk);
  await kerfdesk.setAutoAcknowledge(false);
  await recovery.getByText('Interrupted job saved', { exact: true }).click();
  await recovery.getByRole('button', { name: 'Review recovery', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review interrupted laser job' });
  const resumeBaselineLines = serialWriteLineCount(await kerfdesk.events());
  const resumeMark = (await kerfdesk.events()).length;
  await confirmJobReview(
    page,
    kerfdesk,
    review.getByRole('button', { name: 'Start supervised recovery', exact: true }),
  );
  await expect(review).not.toBeVisible();
  await drainHeldSerialWrites(page, kerfdesk, resumeBaselineLines, 400);
  expect(programLinesSince(await kerfdesk.events(), resumeMark)).toEqual([
    ...(saved?.expectedSent ?? []),
    'G4 P0.01',
  ]);
  await kerfdesk.emitSerialLine(IDLE);
  await expect(page.getByRole('dialog', { name: 'Job complete', exact: true })).toContainText(
    'Would you like to darken selected areas?',
  );
  expect(refusals()).toEqual([]);
});

test('chains three disconnect-and-resume cycles from the same engraving', async ({
  page,
  kerfdesk,
}) => {
  test.setTimeout(180_000);
  const refusals = collectRefusals(page);
  await connectAndHome(page, kerfdesk);
  await frameCurrentJob(page, kerfdesk);
  await kerfdesk.setAutoAcknowledge(false);
  const recovery = page.locator('details[aria-label="Interrupted job recovery"]');
  const review = page.getByRole('dialog', { name: 'Review interrupted laser job' });
  for (let cycle = 0; cycle < 3; cycle += 1) {
    const baselineLines = serialWriteLineCount(await kerfdesk.events());
    if (cycle === 0) {
      await page.getByRole('button', { name: 'Start', exact: true }).click();
      await confirmJobReview(page, kerfdesk);
    } else {
      await recovery.getByText('Interrupted job saved', { exact: true }).click();
      await recovery.getByRole('button', { name: 'Review recovery', exact: true }).click();
      await expect(review).toContainText('Exact job artifact saved');
      await confirmJobReview(
        page,
        kerfdesk,
        review.getByRole('button', { name: 'Start supervised recovery', exact: true }),
      );
      await expect(review).not.toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await expect
      .poll(async () => serialWriteLineCount(await kerfdesk.events()))
      .toBeGreaterThan(baselineLines);
    await kerfdesk.acknowledgeSerial(1);
    await expect.poll(async () => (await streamProbe(page)).completed).toBe(1);
    await kerfdesk.disconnectSerial();
    await expect(recovery.getByText('Interrupted job saved', { exact: true })).toBeVisible();
    const saved = await capsuleProbe(page);
    expect(saved?.ackedLines).toBe(1);
    expect(saved?.resumeChain).toBe(cycle);
    expect(saved?.interruption).toBe('disconnect');
    await expect(page.getByRole('dialog', { name: 'Job complete', exact: true })).toHaveCount(0);
    await kerfdesk.setAutoAcknowledge(true);
    await connectAndHome(page, kerfdesk);
    await kerfdesk.setAutoAcknowledge(false);
  }
  await recovery.getByText('Interrupted job saved', { exact: true }).click();
  await expect(
    recovery.getByRole('button', { name: 'Review recovery', exact: true }),
  ).toBeVisible();
  expect(refusals()).toEqual([]);
});

test('offers darkening once per completion, closes on Escape, re-offers after Run Again and stays quiet after reload', async ({
  page,
  kerfdesk,
}, testInfo) => {
  test.setTimeout(120_000);
  const refusals = collectRefusals(page);
  await connectAndHome(page, kerfdesk);
  await frameCurrentJob(page, kerfdesk);
  await kerfdesk.setAutoAcknowledge(false);
  const complete = page.getByRole('dialog', { name: 'Job complete', exact: true });
  const paint = page.getByRole('button', { name: 'Paint a second pass…', exact: true });

  let baselineLines = serialWriteLineCount(await kerfdesk.events());
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await confirmJobReview(page, kerfdesk);
  await expect(complete).toHaveCount(0);
  await drainHeldSerialWrites(page, kerfdesk, baselineLines, 400);
  await kerfdesk.emitSerialLine(IDLE);
  await expect(complete).toContainText('Would you like to darken selected areas?');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await complete.screenshot({ path: testInfo.outputPath('first-completion-offer.png') });
  await page.keyboard.press('Escape');
  await expect(complete).toHaveCount(0);
  // Trailing status traffic must not bring the prompt back.
  await kerfdesk.emitSerialLine(IDLE);
  await page.waitForTimeout(750);
  await expect(complete).toHaveCount(0);
  await expect(paint).toBeEnabled();

  const runAgain = page.getByRole('button', { name: 'Run same job again from start', exact: true });
  // Run again needs a fresh Frame, like Start (ADR-372 Amendment 1): the first
  // run spent its permit.
  await expect(runAgain).toBeDisabled();
  await kerfdesk.setAutoAcknowledge(true);
  await frameCurrentJob(page, kerfdesk);
  await kerfdesk.setAutoAcknowledge(false);
  await expect(runAgain).toBeEnabled();
  baselineLines = serialWriteLineCount(await kerfdesk.events());
  await runAgain.click();
  await confirmJobReview(
    page,
    kerfdesk,
    page.getByRole('dialog', { name: /^Review/ }).getByRole('button', { name: /^Start/ }),
  );
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await expect(complete).toHaveCount(0);
  await drainHeldSerialWrites(page, kerfdesk, baselineLines, 400);
  await kerfdesk.emitSerialLine(IDLE);
  await expect(complete).toContainText('Would you like to darken selected areas?');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await complete.getByRole('button', { name: 'Not now', exact: true }).click();
  await expect(complete).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('button', { name: 'Open...' })).toBeVisible();
  await page.waitForTimeout(1_000);
  await expect(complete).toHaveCount(0);
  await selectWorkspacePanel(page, 'Machine');
  await expect(paint).toBeVisible();
  expect(refusals()).toEqual([]);
});

test('holds the completion offer behind an open dialog and shows it once that dialog closes', async ({
  page,
  kerfdesk,
}) => {
  test.setTimeout(120_000);
  const refusals = collectRefusals(page);
  await connectAndHome(page, kerfdesk);
  await frameCurrentJob(page, kerfdesk);
  await kerfdesk.setAutoAcknowledge(false);
  const baselineLines = serialWriteLineCount(await kerfdesk.events());
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await confirmJobReview(page, kerfdesk);
  await runMenuCommand(page, 'Tools', 'Labs...');
  const labs = page.getByRole('dialog', { name: 'Labs', exact: true });
  await expect(labs).toBeVisible();
  await drainHeldSerialWrites(page, kerfdesk, baselineLines, 400);
  await kerfdesk.emitSerialLine(IDLE);
  await expect.poll(async () => (await streamProbe(page)).status).toBeNull();
  await page.waitForTimeout(1_000);
  const complete = page.getByRole('dialog', { name: 'Job complete', exact: true });
  await expect(complete).toHaveCount(0);
  await expect(labs).toBeVisible();
  await labs.getByRole('button', { name: 'Done' }).click();
  await expect(complete).toContainText('Would you like to darken selected areas?');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  expect(refusals()).toEqual([]);
});

test('opens the finished job from the Machine panel and withdraws it once a later job is aborted', async ({
  page,
  kerfdesk,
}) => {
  test.setTimeout(120_000);
  const refusals = collectRefusals(page);
  page.on('dialog', (dialog) => void dialog.accept());
  await connectAndHome(page, kerfdesk);
  await frameCurrentJob(page, kerfdesk);
  await kerfdesk.setAutoAcknowledge(false);
  const complete = page.getByRole('dialog', { name: 'Job complete', exact: true });
  const paint = page.getByRole('button', { name: 'Paint a second pass…', exact: true });
  const workbench = page.getByRole('dialog', { name: 'Paint a second pass', exact: true });
  const baselineLines = serialWriteLineCount(await kerfdesk.events());
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await confirmJobReview(page, kerfdesk);
  await drainHeldSerialWrites(page, kerfdesk, baselineLines, 400);
  await kerfdesk.emitSerialLine(IDLE);
  await complete.getByRole('button', { name: 'Not now', exact: true }).click();
  await expect(complete).toHaveCount(0);
  // No history picker: the button opens the job that just finished.
  await expect(page.getByLabel('Completed job for a second pass')).toHaveCount(0);
  await paint.click();
  await expect(
    workbench.getByRole('img', { name: 'Paint second-pass areas on the saved engraving' }),
  ).toBeVisible();
  await workbench.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(workbench).toHaveCount(0);

  // A later job that does not finish leaves no job to darken. The earlier
  // completion is not offered in its place.
  await kerfdesk.setAutoAcknowledge(true);
  await frameCurrentJob(page, kerfdesk);
  await kerfdesk.setAutoAcknowledge(false);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await confirmJobReview(page, kerfdesk);
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await kerfdesk.setAutoAcknowledge(true);
  await page.getByRole('button', { name: 'ABORT JOB', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  await kerfdesk.emitSerialLine(IDLE);
  await expect(paint).toHaveCount(0);
  await expect(complete).toHaveCount(0);
  expect(refusals()).toEqual([]);
});

test('resumes an image engraving interrupted 150 lines in, finishes it and offers darkening of the original image', async ({
  page,
  kerfdesk,
}, testInfo) => {
  test.setTimeout(240_000);
  const refusals = collectRefusals(page);
  await selectAll(page);
  await runMenuCommand(page, 'Edit', 'Delete');
  await kerfdesk.setOpenFiles([
    { name: 'stress-image.png', kind: 'png-fixture', width: 200, height: 200 },
  ]);
  await (await toolbarCommand(page, 'Import...')).click();
  await expect(page.getByRole('spinbutton', { name: 'Selection width' })).toHaveValue('20');
  await connectAndHome(page, kerfdesk);
  await frameCurrentJob(page, kerfdesk);
  await kerfdesk.setAutoAcknowledge(false);
  const baselineLines = serialWriteLineCount(await kerfdesk.events());
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await confirmJobReview(page, kerfdesk);
  await acknowledgeExactly(page, kerfdesk, baselineLines, 150);
  const probe = await streamProbe(page);
  expect(probe.completed).toBe(150);
  const total = probe.total ?? 0;
  expect(total).toBeGreaterThan(150);
  await kerfdesk.disconnectSerial();

  const recovery = page.locator('details[aria-label="Interrupted job recovery"]');
  await expect(recovery.getByText('Interrupted job saved', { exact: true })).toBeVisible();
  await expect(recovery.locator('summary')).toContainText(`150 of ${total} lines acknowledged`);
  const saved = await capsuleProbe(page);
  if (saved === null) throw new Error('Expected the sealed image capsule.');
  expect(saved.ackedLines).toBe(150);

  await kerfdesk.setAutoAcknowledge(true);
  await connectAndHome(page, kerfdesk);
  await kerfdesk.setAutoAcknowledge(false);
  await recovery.getByText('Interrupted job saved', { exact: true }).click();
  await recovery.getByRole('button', { name: 'Review recovery', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review interrupted laser job' });
  await expect(review.getByRole('img', { name: /^Laser recovery canvas:/ })).toBeVisible({
    timeout: 30_000,
  });
  await review.screenshot({ path: testInfo.outputPath('image-resume-review.png') });
  const resumeBaselineLines = serialWriteLineCount(await kerfdesk.events());
  const resumeMark = (await kerfdesk.events()).length;
  await confirmJobReview(
    page,
    kerfdesk,
    review.getByRole('button', { name: 'Start supervised recovery', exact: true }),
  );
  await expect(review).not.toBeVisible();
  const burst = programLinesSince(await kerfdesk.events(), resumeMark);
  expect(burst.length).toBeGreaterThan(0);
  expect(saved.expectedSent.slice(0, burst.length)).toEqual(burst);
  await drainHeldSerialWrites(page, kerfdesk, resumeBaselineLines, 2_000);
  expect(programLinesSince(await kerfdesk.events(), resumeMark)).toEqual([
    ...saved.expectedSent,
    'G4 P0.01',
  ]);
  await kerfdesk.emitSerialLine(IDLE);
  const complete = page.getByRole('dialog', { name: 'Job complete', exact: true });
  await expect(complete).toContainText('Would you like to darken selected areas?');
  await complete.getByRole('button', { name: 'Darken selected areas…' }).click();
  const workbench = page.getByRole('dialog', { name: 'Paint a second pass', exact: true });
  const canvas = workbench.getByRole('img', {
    name: 'Paint second-pass areas on the saved engraving',
  });
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  // The suggested brush is a readable number, not floating-point noise.
  await expect(workbench.getByLabel('Brush diameter (mm)')).toHaveValue(/^\d+(\.\d{1,2})?$/);
  await workbench.screenshot({ path: testInfo.outputPath('image-resumed-darken.png') });
  await workbench.getByRole('button', { name: 'Close', exact: true }).click();
  expect(refusals()).toEqual([]);
});
