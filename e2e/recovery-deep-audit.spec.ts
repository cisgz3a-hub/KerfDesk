// Deep audit of interrupted-job recovery and the completion offer (ADR-341) in
// real Chrome against the fake Web Serial fixture. What a recovered job burns
// is read from the bytes actually written to the controller and judged by an
// independent interpreter, never by the resume builder's own output.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  burnGeometryKey,
  burnGeometryKeyAt,
  oracleBurns,
} from '../src/core/controllers/grbl/laser-burn-oracle.test-helper';
import { expect, test, type KerfDeskFixture, type Page } from './fixtures/kerfdesk-test';
import {
  acknowledgeExactly,
  capsuleProbe,
  collectRefusals,
  confirmJobReview,
  connectAndHome,
  dismissNotifications,
  drainHeldSerialWrites,
  frameCurrentJob,
  IDLE,
  programLinesSince,
  queuedJobLines,
  reopenProject,
  runMenuCommand,
  selectAll,
  serialWriteBytes,
  serialWriteLineCount,
  serialWrites,
  type CapsuleProbe,
  type FixtureEvents,
} from './fixtures/recovery-flow';
import { selectWorkspacePanel, toolbarCommand } from './fixtures/workspace-ui';

const RECONNECTED_HEAD = { x: 777.7, y: 666.6 };

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open...' }).click();
  await expect(page).toHaveTitle(/project-basic\.lf2/);
  await dismissNotifications(page);
});

/** Start the framed job with acknowledgements held; return the line baseline.
 * `status` is the fresh report the controller answers Start with. */
async function startHeld(page: Page, kerfdesk: KerfDeskFixture, status = IDLE): Promise<number> {
  await frameCurrentJob(page, kerfdesk);
  await kerfdesk.setAutoAcknowledge(false);
  const baselineLines = serialWriteLineCount(await kerfdesk.events());
  await page.getByRole('button', { name: 'Start framed job', exact: true }).click();
  await confirmJobReview(
    page,
    kerfdesk,
    page
      .getByRole('dialog', { name: 'Review job before starting' })
      .getByRole('button', { name: 'Start job' }),
    status,
  );
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  return baselineLines;
}

/** Reconnect, start the saved recovery, acknowledge everything; return the lines sent. */
async function recoverAndDrain(page: Page, kerfdesk: KerfDeskFixture): Promise<string[]> {
  await kerfdesk.setAutoAcknowledge(true);
  await connectAndHome(page, kerfdesk);
  await kerfdesk.setAutoAcknowledge(false);
  const recovery = page.locator('details[aria-label="Interrupted job recovery"]');
  if (!(await recovery.getByRole('button', { name: 'Review recovery', exact: true }).isVisible()))
    await recovery.getByText('Interrupted job saved', { exact: true }).click();
  await recovery.getByRole('button', { name: 'Review recovery', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review interrupted laser job' });
  await expect(review).toContainText('Exact job artifact saved');
  const baseline = serialWriteLineCount(await kerfdesk.events());
  const mark = (await kerfdesk.events()).length;
  await confirmJobReview(
    page,
    kerfdesk,
    review.getByRole('button', { name: 'Start supervised recovery', exact: true }),
  );
  await expect(review).not.toBeVisible();
  await drainHeldSerialWrites(page, kerfdesk, baseline, 2_000);
  await kerfdesk.emitSerialLine(IDLE);
  return programLinesSince(await kerfdesk.events(), mark);
}

async function savedCapsule(page: Page): Promise<CapsuleProbe> {
  const recovery = page.locator('details[aria-label="Interrupted job recovery"]');
  await expect(recovery.getByText('Interrupted job saved', { exact: true })).toBeVisible();
  const saved = await capsuleProbe(page);
  if (saved === null) throw new Error('Expected the sealed capsule.');
  return saved;
}

async function importRowsImage(page: Page, kerfdesk: KerfDeskFixture): Promise<void> {
  await selectAll(page);
  await runMenuCommand(page, 'Edit', 'Delete');
  await kerfdesk.setOpenFiles([{ name: 'rows.png', kind: 'png-fixture', width: 120, height: 120 }]);
  await (await toolbarCommand(page, 'Import...')).click();
  await expect(page.getByRole('spinbutton', { name: 'Selection width' })).toHaveValue('12');
}

/** A second window on the same origin, with its own fake serial port and pickers. */
async function secondWindow(page: Page): Promise<{
  readonly page: Page;
  readonly events: () => Promise<FixtureEvents>;
  readonly fixture: KerfDeskFixture;
}> {
  const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
  const source = readFileSync(`${fixtures}browser-apis.js`, 'utf8').replace(
    "'__KERFDESK_E2E_PROJECT_FIXTURE__'",
    JSON.stringify(readFileSync(`${fixtures}project-basic.lf2`, 'utf8')),
  );
  const other = await page.context().newPage();
  await other.addInitScript({ content: source });
  await other.goto('/');
  await other.getByRole('button', { name: 'Open...' }).click();
  await expect(other).toHaveTitle(/project-basic\.lf2/);
  await dismissNotifications(other);
  const events = () =>
    other.evaluate(
      () =>
        structuredClone(
          (window as unknown as { __KERFDESK_E2E__: { events: unknown[] } }).__KERFDESK_E2E__
            .events,
        ) as FixtureEvents,
    );
  const emitSerialLine = (line: string) =>
    other.evaluate((value) => {
      (
        window as unknown as { __KERFDESK_E2E__: { emitSerialLine: (line: string) => void } }
      ).__KERFDESK_E2E__.emitSerialLine(value);
    }, line);
  // connectAndHome only needs the event log and the serial line emitter.
  const fixture = { events, emitSerialLine } as unknown as KerfDeskFixture;
  return { page: other, events, fixture };
}

/** project-basic with sixteen stripes cut with air assist (M8) on. */
function airCutProjectText(): string {
  const path = fileURLToPath(new URL('./fixtures/project-basic.lf2', import.meta.url));
  const basic = JSON.parse(readFileSync(path, 'utf8')) as {
    device: Record<string, unknown>;
    scene: { layers: Record<string, unknown>[]; objects: Record<string, unknown>[] };
  };
  const [layer] = basic.scene.layers;
  const [square] = basic.scene.objects;
  const objects = Array.from({ length: 16 }, (_, index) => ({
    ...square,
    id: `stripe-${index}`,
    source: `stripe-${index}.svg`,
    bounds: { minX: 10, minY: 10 + index * 2, maxX: 40, maxY: 10 + index * 2 },
    paths: [
      {
        color: layer?.['color'],
        polylines: [
          {
            points: [
              { x: 10, y: 10 + index * 2 },
              { x: 40, y: 10 + index * 2 },
            ],
            closed: false,
          },
        ],
      },
    ],
  }));
  return JSON.stringify({
    ...basic,
    device: { ...basic.device, airAssistCommand: 'M8' },
    scene: { ...basic.scene, layers: [{ ...layer, airAssist: true }], objects },
  });
}

test('an image interrupted mid-row recovers every remaining raster segment', async ({
  page,
  kerfdesk,
}) => {
  test.setTimeout(180_000);
  const refusals = collectRefusals(page);
  await importRowsImage(page, kerfdesk);
  await connectAndHome(page, kerfdesk);
  const baselineLines = await startHeld(page, kerfdesk);
  const lines = await queuedJobLines(page);
  // Land the interruption just before a burning raster continuation line: axis
  // and power words only, relying on the modal G1 set earlier in the row.
  const target = lines.findIndex(
    (line, index) => index >= 30 && /^X-?\d[\d.]*S[1-9]\d*(?:\.\d+)?$/.test(line),
  );
  expect(target).toBeGreaterThan(0);
  await acknowledgeExactly(page, kerfdesk, baselineLines, target);
  await kerfdesk.disconnectSerial();
  const saved = await savedCapsule(page);
  expect(saved.ackedLines).toBe(target);
  expect(saved.gcode.split('\n')[saved.resumeLine - 1]?.trim()).toBe(lines[target]);

  const sent = await recoverAndDrain(page, kerfdesk);
  const expected = oracleBurns(saved.gcode)
    .filter((burn) => burn.line >= saved.resumeLine)
    .map(burnGeometryKeyAt(3));
  const burned = oracleBurns(sent.join('\n'), RECONNECTED_HEAD).map(burnGeometryKeyAt(3));
  expect(expected.length).toBeGreaterThan(0);
  expect(expected.filter((key) => !burned.includes(key))).toEqual([]);
  expect(refusals()).toEqual([]);
});

test('an air-assisted cut interrupted mid-layer recovers with air assist on', async ({
  page,
  kerfdesk,
}) => {
  test.setTimeout(180_000);
  const refusals = collectRefusals(page);
  await kerfdesk.setOpenFiles([{ name: 'air-cut.lf2', text: airCutProjectText() }]);
  await reopenProject(page, 'air-cut.lf2');
  await connectAndHome(page, kerfdesk);
  const baselineLines = await startHeld(page, kerfdesk);
  await acknowledgeExactly(page, kerfdesk, baselineLines, 14);
  await kerfdesk.disconnectSerial();
  const saved = await savedCapsule(page);
  const original = oracleBurns(saved.gcode).filter((burn) => burn.line >= saved.resumeLine);
  expect(original.length).toBeGreaterThan(0);
  expect(new Set(original.map((burn) => burn.air))).toEqual(new Set(['M8']));

  const sent = await recoverAndDrain(page, kerfdesk);
  const recovered = oracleBurns(sent.join('\n'), RECONNECTED_HEAD);
  expect(recovered.map(burnGeometryKey)).toEqual(original.map(burnGeometryKey));
  expect(recovered.map((burn) => burn.air)).toEqual(original.map((burn) => burn.air));
  expect(refusals()).toEqual([]);
});

test('a keystroke meant for a field does not answer the automatic completion offer', async ({
  page,
  kerfdesk,
}) => {
  test.setTimeout(120_000);
  await selectAll(page);
  await connectAndHome(page, kerfdesk);
  const baselineLines = await startHeld(page, kerfdesk);
  // The operator has a field focused, about to type, while the last lines run.
  const field = page.getByRole('spinbutton', { name: 'Selection X position' });
  await field.click();
  await field.press('End');
  await drainHeldSerialWrites(page, kerfdesk, baselineLines, 400);
  await kerfdesk.emitSerialLine(IDLE);
  const complete = page.getByRole('dialog', { name: 'Job complete', exact: true });
  await expect(complete).toBeVisible();
  // They keep typing: a digit, then a space, as they would in any text field.
  await page.keyboard.type('5');
  await page.keyboard.press('Space');
  await expect(page.getByRole('dialog', { name: 'Paint a second pass', exact: true })).toHaveCount(
    0,
  );
  await expect(complete).toBeVisible();
});

test('editing the design while a job runs still offers darkening when it completes', async ({
  page,
  kerfdesk,
}) => {
  test.setTimeout(120_000);
  await selectAll(page);
  await connectAndHome(page, kerfdesk);
  const baselineLines = await startHeld(page, kerfdesk);
  // The operator nudges the artwork for the next piece while this one burns.
  const field = page.getByRole('spinbutton', { name: 'Selection X position' });
  await field.fill('47');
  await field.press('Tab');
  await expect(field).toHaveValue('47');
  await drainHeldSerialWrites(page, kerfdesk, baselineLines, 400);
  await kerfdesk.emitSerialLine(IDLE);
  await expect(
    page.getByRole('button', { name: 'Paint a second pass…', exact: true }),
  ).toBeVisible();
  const complete = page.getByRole('dialog', { name: 'Job complete', exact: true });
  const offered = await complete
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  const diagnostics = await page.evaluate(async () => {
    const ui = (await import('/src/ui/state/laser-second-pass-ui-store.ts' as string)) as {
      useLaserSecondPassUiStore: { getState: () => Record<string, unknown> };
    };
    const recovery = (await import('/src/ui/state/recovery/index.ts' as string)) as {
      recoveryRepository: { getSnapshot: () => { lastCompletedReceipt: { runId: string } | null } };
    };
    const state = ui.useLaserSecondPassUiStore.getState();
    return {
      completionRunId: state['completionRunId'],
      lastOfferedRunId: state['lastOfferedRunId'],
      receipt: recovery.recoveryRepository.getSnapshot().lastCompletedReceipt?.runId ?? null,
    };
  });
  expect({ offered, diagnostics }).toMatchObject({ offered: true });
});

test('a page reload mid-job saves a recoverable capsule no older than one checkpoint', async ({
  page,
  kerfdesk,
}) => {
  test.setTimeout(180_000);
  const refusals = collectRefusals(page);
  await importRowsImage(page, kerfdesk);
  await connectAndHome(page, kerfdesk);
  const baselineLines = await startHeld(page, kerfdesk);
  await acknowledgeExactly(page, kerfdesk, baselineLines, 60);
  // Let the queued checkpoint write land, then lose the page as a crash would.
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Open...' })).toBeVisible();
  await selectWorkspacePanel(page, 'Machine');
  const saved = await savedCapsule(page);
  // A truthful cause: the app closing, when its stop request was saved before
  // the page went away, or the restart that found the job still active.
  const cause = `${saved.interruption}: ${saved.interruptionMessage}`;
  expect(cause).not.toContain('ended unexpectedly');
  expect(cause).toMatch(
    /^(?:cancelled: KerfDesk was closed or reloaded|unknown: The application restarted while this job was active)/,
  );
  expect(saved.ackedLines).toBeLessThanOrEqual(60);
  expect(saved.ackedLines).toBeGreaterThan(60 - 25);
  // The capsule outlives the project session: reopen the design's machine.
  await reopenProject(page);
  const sent = await recoverAndDrain(page, kerfdesk);
  expect(sent.length).toBeGreaterThan(0);
  await expect(page.getByRole('dialog', { name: 'Job complete', exact: true })).toContainText(
    'Would you like to darken selected areas?',
  );
  expect(refusals()).toEqual([]);
});

test('a job paused and then disconnected recovers from its acknowledged line', async ({
  page,
  kerfdesk,
}) => {
  test.setTimeout(120_000);
  const refusals = collectRefusals(page);
  await connectAndHome(page, kerfdesk);
  const baselineLines = await startHeld(page, kerfdesk);
  await acknowledgeExactly(page, kerfdesk, baselineLines, 2);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  // KerfDesk pauses a laser job with Safety Door (0x84), not feed hold.
  await expect.poll(async () => serialWriteBytes(await kerfdesk.events())).toContain(0x84);
  await kerfdesk.emitSerialLine('<Door:0|MPos:0.000,0.000,0.000|WCO:0.000,0.000,0.000|FS:0,0>');
  await kerfdesk.disconnectSerial();
  const saved = await savedCapsule(page);
  expect(saved.ackedLines).toBe(2);
  expect(saved.interruption).toBe('disconnect');
  // Reconnecting an Arduino-class controller resets it: it answers Idle, not Door.
  await kerfdesk.emitSerialLine(IDLE);
  const sent = await recoverAndDrain(page, kerfdesk);
  expect(sent.slice(0, saved.expectedSent.length)).toEqual(saved.expectedSent);
  await expect(page.getByRole('dialog', { name: 'Job complete', exact: true })).toContainText(
    'Would you like to darken selected areas?',
  );
  expect(refusals()).toEqual([]);
});

test('recovery after a controller reset warns when the work origin differs from the interrupted run', async ({
  page,
  kerfdesk,
}) => {
  test.setTimeout(180_000);
  const messages: string[] = [];
  page.on('dialog', (dialog) => {
    messages.push(dialog.message());
    void dialog.accept();
  });
  await connectAndHome(page, kerfdesk);
  await page.getByText('Placement & output', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Start from' }).selectOption('user-origin');
  await kerfdesk.emitSerialLine('<Idle|MPos:20.000,20.000,0.000|WCO:0.000,0.000,0.000|FS:0,0>');
  await page.getByRole('button', { name: 'Set origin here', exact: true }).click();
  await expect.poll(async () => serialWrites(await kerfdesk.events())).toContain('G92 X0 Y0');
  const atOrigin = '<Idle|MPos:20.000,20.000,0.000|WCO:20.000,20.000,0.000|FS:0,0>';
  await kerfdesk.emitSerialLine(atOrigin);
  const baselineLines = await startHeld(page, kerfdesk, atOrigin);
  await acknowledgeExactly(page, kerfdesk, baselineLines, 2);
  await kerfdesk.disconnectSerial();
  await savedCapsule(page);

  // Reconnecting resets the controller: G92 is gone and the head reads machine 20,20.
  await kerfdesk.emitSerialLine('<Idle|MPos:20.000,20.000,0.000|WCO:0.000,0.000,0.000|FS:0,0>');
  await kerfdesk.setAutoAcknowledge(true);
  await connectAndHome(page, kerfdesk);
  // The operator re-creates an origin by eye, 15 mm away from the original one.
  await kerfdesk.emitSerialLine('<Idle|MPos:35.000,35.000,0.000|WCO:0.000,0.000,0.000|FS:0,0>');
  await page.getByRole('button', { name: 'Set origin here', exact: true }).click();
  await kerfdesk.emitSerialLine('<Idle|MPos:35.000,35.000,0.000|WCO:35.000,35.000,0.000|FS:0,0>');
  const recovery = page.locator('details[aria-label="Interrupted job recovery"]');
  if (!(await recovery.getByRole('button', { name: 'Review recovery', exact: true }).isVisible()))
    await recovery.getByText('Interrupted job saved', { exact: true }).click();
  await recovery.getByRole('button', { name: 'Review recovery', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review interrupted laser job' });
  await expect(review).toContainText('Exact job artifact saved');
  // The review names the interrupted run's work origin (machine 20, 20) or warns
  // that the live origin differs from it; boilerplate mentioning "origin" or a
  // timestamp containing "20" does not count.
  const shown = (await review.textContent()) ?? '';
  const namesSavedOrigin =
    /origin[^.]{0,80}?\b20(?:\.0+)?\s*(?:mm)?\s*[,×x/]\s*(?:Y\s*)?20(?:\.0+)?\b/i.test(shown);
  const warnsOfMove = [shown, ...messages].some((text) =>
    /origin[^.]{0,80}(?:differs|moved|changed|does not match)/i.test(text),
  );
  expect({ namesSavedOrigin, warnsOfMove }).not.toEqual({
    namesSavedOrigin: false,
    warnsOfMove: false,
  });
});

test('two windows cannot both resume one interrupted job', async ({ page, kerfdesk }) => {
  test.setTimeout(180_000);
  const refusalsA = collectRefusals(page);
  await connectAndHome(page, kerfdesk);
  const baselineLines = await startHeld(page, kerfdesk);
  await acknowledgeExactly(page, kerfdesk, baselineLines, 2);
  await kerfdesk.disconnectSerial();
  await savedCapsule(page);

  // A second window opens on the same browser profile and sees the same capsule.
  const other = await secondWindow(page);
  const dialogsB: string[] = [];
  other.page.on('dialog', (dialog) => {
    dialogsB.push(dialog.message());
    void dialog.accept();
  });
  await selectWorkspacePanel(other.page, 'Machine');
  const cardB = other.page.locator('details[aria-label="Interrupted job recovery"]');
  await expect(cardB.getByText('Interrupted job saved', { exact: true })).toBeVisible();
  await connectAndHome(other.page, other.fixture);

  // Window A resumes first. Chrome holds a background tab's native confirm until
  // the tab is shown, so each window is brought forward before it acts.
  await page.bringToFront();
  const sent = await recoverAndDrain(page, kerfdesk);
  expect(sent.length).toBeGreaterThan(0);
  expect(refusalsA()).toEqual([]);

  // Window B refreshes when window A changes the shared recovery record, so the
  // consumed card disappears there too instead of lingering until reload
  // (ADR-341 Amendment 3), and nothing streams from window B.
  await other.page.bringToFront();
  await expect(cardB.getByText('Interrupted job saved', { exact: true })).toHaveCount(0);
  const programB = programLinesSince(await other.events(), 0);
  expect(programB.filter((line) => /^G[01]\b/.test(line))).toEqual([]);
  await other.page.close();
});

test('a recovery review open in another window closes when this window resumes the job', async ({
  page,
  kerfdesk,
}) => {
  test.setTimeout(180_000);
  await connectAndHome(page, kerfdesk);
  const baselineLines = await startHeld(page, kerfdesk);
  await acknowledgeExactly(page, kerfdesk, baselineLines, 2);
  await kerfdesk.disconnectSerial();
  await savedCapsule(page);
  const other = await secondWindow(page);
  other.page.on('dialog', (dialog) => void dialog.accept());
  await selectWorkspacePanel(other.page, 'Machine');
  await connectAndHome(other.page, other.fixture);
  // Window B opens its review first; window A then resumes the same capsule.
  const cardB = other.page.locator('details[aria-label="Interrupted job recovery"]');
  if (!(await cardB.getByRole('button', { name: 'Review recovery', exact: true }).isVisible()))
    await cardB.getByText('Interrupted job saved', { exact: true }).click();
  await cardB.getByRole('button', { name: 'Review recovery', exact: true }).click();
  const reviewB = other.page.getByRole('dialog', { name: 'Review interrupted laser job' });
  await expect(reviewB).toBeVisible();
  await page.bringToFront();
  expect((await recoverAndDrain(page, kerfdesk)).length).toBeGreaterThan(0);
  // The stale review cannot be started: it closes with the record it showed.
  await other.page.bringToFront();
  await expect(reviewB).toHaveCount(0);
  const programB = programLinesSince(await other.events(), 0);
  expect(programB.filter((line) => /^G[01]\b/.test(line))).toEqual([]);
  await other.page.close();
});
