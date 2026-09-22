// Adversarial browser-level checks for two operator promises (ADR-341):
// an interrupted engraving is saved at exactly its acknowledged line and can
// be resumed from there after reconnecting, and a cleanly finished engraving
// offers "darken selected areas" once. Runs in real Chrome against the fake
// Web Serial fixture; acknowledgements are held so the disconnect lands at a
// chosen line.

import {
  expandMachineUtilities,
  selectWorkspacePanel,
  toolbarCommand,
} from './fixtures/workspace-ui';
import {
  expect,
  test,
  type KerfDeskFixture,
  type Locator,
  type Page,
} from './fixtures/kerfdesk-test';

const IDLE = '<Idle|MPos:0.000,0.000,0.000|WCO:0.000,0.000,0.000|FS:0,0>';
const REALTIME_BYTES = new Set([
  '?',
  '!',
  '~',
  ...[0x18, 0x84, 0x85].map((code) => String.fromCharCode(code)),
]);

type FixtureEvents = readonly Readonly<Record<string, unknown>>[];

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
    await page.getByRole('button', { name: 'Start framed job', exact: true }).click();
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
  await page.getByRole('button', { name: 'Start framed job', exact: true }).click();
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
      await page.getByRole('button', { name: 'Start framed job', exact: true }).click();
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
  await page.getByRole('button', { name: 'Start framed job', exact: true }).click();
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
  await complete.getByRole('button', { name: 'Done', exact: true }).click();
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
  await page.getByRole('button', { name: 'Start framed job', exact: true }).click();
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
  await page.getByRole('button', { name: 'Start framed job', exact: true }).click();
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

// ---------------------------------------------------------------------------
// Probes into the live stores (same module instances the app uses).

async function streamProbe(page: Page): Promise<{
  readonly completed: number | null;
  readonly total: number | null;
  readonly status: string | null;
  readonly operation: string | null;
}> {
  return page.evaluate(async () => {
    const moduleUrl = '/src/ui/state/laser-store.ts';
    const { useLaserStore } = (await import(moduleUrl)) as {
      useLaserStore: {
        getState: () => {
          streamer: { completed: number; total: number; status: string } | null;
          controllerOperation: { kind: string } | null;
        };
      };
    };
    const state = useLaserStore.getState();
    return {
      completed: state.streamer?.completed ?? null,
      total: state.streamer?.total ?? null,
      status: state.streamer?.status ?? null,
      operation: state.controllerOperation?.kind ?? null,
    };
  });
}

interface CapsuleProbe {
  readonly runId: string;
  readonly ackedLines: number;
  readonly sendableLines: number;
  readonly interruption: string;
  readonly resumeLine: number;
  readonly resumeChain: number;
  readonly expectedSent: readonly string[];
}

async function capsuleProbe(page: Page): Promise<CapsuleProbe | null> {
  return page.evaluate(async () => {
    const recoveryUrl = '/src/ui/state/recovery/index.ts';
    const coreUrl = '/src/core/recovery/index.ts';
    const resumeUrl = '/src/ui/laser/laser-resume-program.ts';
    const { recoveryRepository } = (await import(recoveryUrl)) as {
      recoveryRepository: {
        getSnapshot: () => {
          recoveryCapsule: {
            runId: string;
            ackedLines: number;
            sendableLines: number;
            interruption: { kind: string };
            artifact: { kind: string; gcode?: string; laserResumeChain?: readonly unknown[] };
          } | null;
        };
      };
    };
    const { rawResumeLine } = (await import(coreUrl)) as {
      rawResumeLine: (gcode: string, acked: number) => number;
    };
    const { buildLaserResumeProgram } = (await import(resumeUrl)) as {
      buildLaserResumeProgram: (
        gcode: string,
        fromLine: number,
      ) => { kind: 'ok'; lines: readonly string[] } | { kind: 'error'; reason: string };
    };
    const capsule = recoveryRepository.getSnapshot().recoveryCapsule;
    if (capsule === null || capsule.artifact.kind !== 'exact-execution') return null;
    const gcode = capsule.artifact.gcode ?? '';
    const resumeLine = rawResumeLine(gcode, capsule.ackedLines);
    const program = buildLaserResumeProgram(gcode, resumeLine);
    const sendable = (line: string): boolean => line.trim() !== '' && !line.trim().startsWith(';');
    return {
      runId: capsule.runId,
      ackedLines: capsule.ackedLines,
      sendableLines: capsule.sendableLines,
      interruption: capsule.interruption.kind,
      resumeLine,
      resumeChain: capsule.artifact.laserResumeChain?.length ?? 0,
      expectedSent: program.kind === 'ok' ? program.lines.filter(sendable) : [],
    };
  });
}

function collectRefusals(page: Page): () => string[] {
  const messages: string[] = [];
  page.on('dialog', (dialog) => {
    if (/^Cannot|Could not|could not be/i.test(dialog.message())) messages.push(dialog.message());
    void dialog.accept();
  });
  return () => messages;
}

function programLinesSince(events: FixtureEvents, fromEventIndex: number): string[] {
  return events
    .slice(fromEventIndex)
    .filter((event) => event['kind'] === 'serial-write')
    .flatMap((event) =>
      [...String(event['text'])]
        .filter((character) => !REALTIME_BYTES.has(character))
        .join('')
        .split('\n'),
    )
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** Acknowledge job lines until the streamer reports done, leaving the settle
 * marker unacknowledged so the controller is still settling. */
async function acknowledgeJobLinesOnly(
  page: Page,
  kerfdesk: KerfDeskFixture,
  baselineLines: number,
): Promise<void> {
  let acknowledged = 0;
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const probe = await streamProbe(page);
    if (probe.status === 'done') {
      await expect.poll(async () => (await streamProbe(page)).operation).toBe('post-job-settle');
      return;
    }
    const written = serialWriteLineCount(await kerfdesk.events()) - baselineLines;
    const pending = written - acknowledged;
    if (pending > 0) {
      await kerfdesk.acknowledgeSerial(pending);
      acknowledged += pending;
    }
    await page.waitForTimeout(25);
  }
  throw new Error('The job did not reach done while acknowledging its lines.');
}

/** Acknowledge exactly `target` job lines, re-filling the window as needed. */
async function acknowledgeExactly(
  page: Page,
  kerfdesk: KerfDeskFixture,
  baselineLines: number,
  target: number,
): Promise<void> {
  let acknowledged = 0;
  for (let attempt = 0; attempt < 400 && acknowledged < target; attempt += 1) {
    const written = serialWriteLineCount(await kerfdesk.events()) - baselineLines;
    const pending = Math.min(written - acknowledged, target - acknowledged);
    if (pending > 0) {
      await kerfdesk.acknowledgeSerial(pending);
      acknowledged += pending;
    }
    await page.waitForTimeout(25);
  }
  await expect.poll(async () => (await streamProbe(page)).completed).toBe(target);
}

// ---------------------------------------------------------------------------
// Helpers mirrored from production-workflows.spec.ts.

async function selectAll(page: Page): Promise<void> {
  await runMenuCommand(page, 'Edit', 'Select All');
}

async function frameCurrentJob(page: Page, kerfdesk: KerfDeskFixture): Promise<void> {
  const writesBeforeFrame = serialWrites(await kerfdesk.events()).length;
  await page.getByRole('button', { name: 'Frame job', exact: true }).click();
  await expect
    .poll(async () => serialWrites(await kerfdesk.events()).slice(writesBeforeFrame))
    .toContain('$J=G90 G21');
  await expect(page.getByRole('button', { name: 'Start framed job', exact: true })).toBeEnabled();
}

async function confirmJobReview(
  page: Page,
  kerfdesk: KerfDeskFixture,
  startButton: Locator = page
    .getByRole('dialog', { name: 'Review job before starting' })
    .getByRole('button', { name: 'Start job' }),
): Promise<void> {
  const before = await reviewStartBoundary(page);
  const statusQueriesBefore = serialWriteBytes(await kerfdesk.events()).filter(
    (byte) => byte === 0x3f,
  ).length;
  await startButton.click();
  await expect
    .poll(
      async () => serialWriteBytes(await kerfdesk.events()).filter((byte) => byte === 0x3f).length,
    )
    .toBeGreaterThan(statusQueriesBefore);
  await expect
    .poll(async () => {
      const current = await reviewStartBoundary(page);
      return current.streamerEpoch !== before.streamerEpoch || current.awaitingFreshReport;
    })
    .toBe(true);
  await kerfdesk.emitSerialLine(IDLE);
}

async function reviewStartBoundary(page: Page): Promise<{
  streamerEpoch: number;
  awaitingFreshReport: boolean;
}> {
  return page.evaluate(async () => {
    const moduleUrl = '/src/ui/state/laser-store.ts';
    const { useLaserStore } = (await import(moduleUrl)) as {
      useLaserStore: {
        getState: () => {
          streamerEpoch: number;
          controllerOperation: { kind: string; phase?: string } | null;
          pendingTransportWrites?: number;
        };
      };
    };
    const state = useLaserStore.getState();
    return {
      streamerEpoch: state.streamerEpoch,
      awaitingFreshReport:
        state.controllerOperation?.kind === 'start-arming' &&
        state.controllerOperation.phase === 'live-status' &&
        (state.pendingTransportWrites ?? 0) === 0,
    };
  });
}

async function reopenProject(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open...' }).click();
  await expect(page).toHaveTitle(/project-basic\.lf2/);
  await dismissNotifications(page);
}

async function dismissNotifications(page: Page): Promise<void> {
  const notifications = page.getByRole('button', { name: /^Dismiss notification:/ });
  while ((await notifications.count()) > 0) {
    await notifications.first().click();
  }
}

async function runMenuCommand(page: Page, family: string, command: string): Promise<void> {
  const applicationMenu = page.getByRole('menubar', { name: 'Application menu' });
  await applicationMenu.getByRole('menuitem', { name: family, exact: true }).click();
  await applicationMenu.getByRole('menuitem').filter({ hasText: command }).click();
}

async function connectAndHome(page: Page, kerfdesk: KerfDeskFixture): Promise<void> {
  await selectWorkspacePanel(page, 'Machine');
  await page.getByRole('button', { name: /^Connect/ }).click();
  await expect(page.getByText('State: Idle', { exact: true })).toBeVisible();
  await expandMachineUtilities(page);
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect.poll(async () => serialWrites(await kerfdesk.events())).toContain('G4 P0.01');
  await kerfdesk.emitSerialLine(IDLE);
  await expect(page.getByRole('button', { name: 'Home', exact: true })).toBeEnabled();
}

function serialWrites(events: FixtureEvents): string {
  return events
    .filter((event) => event['kind'] === 'serial-write')
    .map((event) => String(event['text']))
    .join('');
}

function serialWriteBytes(events: FixtureEvents): number[] {
  return events.flatMap((event) => {
    if (event['kind'] !== 'serial-write') return [];
    const bytes = event['bytes'];
    if (!Array.isArray(bytes)) return [];
    return bytes.filter((value): value is number => typeof value === 'number');
  });
}

function serialWriteLineCount(events: FixtureEvents): number {
  return events
    .filter((event) => event['kind'] === 'serial-write')
    .map((event) => String(event['text']))
    .reduce((count, text) => count + [...text].filter((character) => character === '\n').length, 0);
}

async function drainHeldSerialWrites(
  page: Page,
  kerfdesk: KerfDeskFixture,
  baselineLines: number,
  maxPasses: number,
): Promise<void> {
  let acknowledged = 0;
  let stablePasses = 0;
  for (let attempt = 0; attempt < maxPasses; attempt += 1) {
    const written = serialWriteLineCount(await kerfdesk.events()) - baselineLines;
    const pending = written - acknowledged;
    if (pending > 0) {
      await kerfdesk.acknowledgeSerial(pending);
      acknowledged += pending;
      stablePasses = 0;
    } else {
      stablePasses += 1;
      if (stablePasses >= 3) return;
    }
    await page.waitForTimeout(25);
  }
  throw new Error('Held serial writes did not drain.');
}
