import {
  expandMachineUtilities,
  selectWorkspacePanel,
  toolbarCommand,
} from './fixtures/workspace-ui';
import { expect, test, type KerfDeskFixture, type Page } from './fixtures/kerfdesk-test';

// ADR-355, from an operator report: run a raster, nudge the live overrides,
// Abort, clear the canvas, import a new image, type new speed and power, and
// the new job burns like the old one. The program was always right; the
// controller still held the old override percentages. A laser Start must now
// reset them in front of the program's first write.

// Feed reset, rapid 100%, spindle (laser power) reset.
const OVERRIDE_RESET_BYTES = [0x90, 0x95, 0x99];

test('a new raster job after Abort resets leftover overrides and burns its own settings', async ({
  page,
  kerfdesk,
}) => {
  test.setTimeout(180_000);
  page.on('dialog', (dialog) => void dialog.accept());
  // Spacious layout: both rails visible, no ambiguous compact panel tabs.
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open...' }).click();
  await expect(page).toHaveTitle(/project-basic\.lf2/);
  await dismissNotifications(page);
  await clearCanvas(page);

  await importImage(page, kerfdesk, 'first.png', 120);
  await setPowerAndSpeed(page, '30', '1500');
  await connectAndHome(page, kerfdesk);

  // Job 1, with the operator's live Feed/Power adjustment reported mid-run.
  await frameCurrentJob(page, kerfdesk);
  await page.getByRole('button', { name: 'Start framed job', exact: true }).click();
  const eventsBeforeJob1 = writeEvents(await kerfdesk.events()).length;
  await page
    .getByRole('dialog', { name: 'Review job before starting' })
    .getByRole('button', { name: 'Start job' })
    .click();
  await answerStatusUntilProgramStarts(
    kerfdesk,
    eventsBeforeJob1,
    '<Idle|MPos:0.000,0.000,0.000|WCO:0.000,0.000,0.000|FS:0,0>',
  );
  const abort = page.getByRole('button', { name: 'ABORT JOB', exact: true });
  await expect(abort).toBeVisible({ timeout: 30_000 });
  await kerfdesk.emitSerialLine(
    '<Run|MPos:0.000,0.000,0.000|WCO:0.000,0.000,0.000|FS:900,240|Ov:60,100,80>',
  );
  await abort.click();
  await expect.poll(async () => serialWrites(await kerfdesk.events())).toContain('\u0018');
  // A controller whose reset keeps overrides ($676 bit 3 clear on grblHAL).
  await kerfdesk.emitSerialLine(
    '<Idle|MPos:0.000,0.000,0.000|WCO:0.000,0.000,0.000|FS:0,0|Ov:60,100,80>',
  );

  // Job 2: new image, new settings.
  await clearCanvas(page);
  await importImage(page, kerfdesk, 'second.png', 80);
  await setPowerAndSpeed(page, '70', '3000');
  await dismissNotifications(page);
  const home = page.getByRole('button', { name: 'Home', exact: true });
  if (await home.isVisible()) {
    await home.click();
    await kerfdesk.emitSerialLine(
      '<Idle|MPos:0.000,0.000,0.000|WCO:0.000,0.000,0.000|FS:0,0|Ov:60,100,80>',
    );
  }
  await frameCurrentJob(page, kerfdesk);
  await page.getByRole('button', { name: 'Start framed job', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review job before starting' });
  await expect(review).toContainText('overrides reset to 100% at Start');
  const eventsBeforeStart = writeEvents(await kerfdesk.events()).length;
  await review.getByRole('button', { name: 'Start job' }).click();
  await answerStatusUntilProgramStarts(
    kerfdesk,
    eventsBeforeStart,
    '<Idle|MPos:0.000,0.000,0.000|WCO:0.000,0.000,0.000|FS:0,0|Ov:60,100,80>',
  );

  // The reset goes out as its own write of three single raw bytes, since a
  // queued line may not carry a byte above 0x7F (ADR-361), immediately ahead
  // of the program's first line; only a status query may fall between them.
  // The fixture's text view decodes raw bytes as UTF-8, so assert on bytes.
  const job2Writes = writeEvents(await kerfdesk.events()).slice(eventsBeforeStart);
  const firstProgram = job2Writes.findIndex((event) => String(event['text']).includes('G21'));
  expect(firstProgram).toBeGreaterThan(0);
  const programBytes = (job2Writes[firstProgram]?.['bytes'] ?? []) as number[];
  expect(String.fromCharCode(...programBytes.slice(0, 4))).toBe('G21\n');
  const writtenBefore = job2Writes
    .slice(0, firstProgram)
    .map((event) => (event['bytes'] ?? []) as number[])
    .filter((bytes) => String.fromCharCode(...bytes) !== '?');
  expect(writtenBefore.at(-1)).toEqual(OVERRIDE_RESET_BYTES);

  // And the program carries the new settings: F3000, and 70% of the profile's
  // S1000 for the darkest pixels.
  await expect
    .poll(async () => serialWrites(writeEvents(await kerfdesk.events()).slice(eventsBeforeStart)))
    .toMatch(/S700/);
  const program = serialWrites(writeEvents(await kerfdesk.events()).slice(eventsBeforeStart));
  expect(distinct(program, /F(\d+)/g)).toEqual(['3000']);
  expect(Math.max(...[...program.matchAll(/S(\d+)/g)].map((match) => Number(match[1])))).toBe(700);
});

function distinct(text: string, pattern: RegExp): string[] {
  return [...new Set([...text.matchAll(pattern)].map((match) => match[1] ?? ''))];
}

async function clearCanvas(page: Page): Promise<void> {
  await runMenuCommand(page, 'Edit', 'Select All');
  await runMenuCommand(page, 'Edit', 'Delete');
  await expect(page.getByText('Objects: 0', { exact: true })).toBeVisible();
}

async function importImage(
  page: Page,
  kerfdesk: KerfDeskFixture,
  name: string,
  pixels: number,
): Promise<void> {
  await kerfdesk.setOpenFiles([{ name, kind: 'png-fixture', width: pixels, height: pixels }]);
  await (await toolbarCommand(page, 'Import...')).click();
  await fillAndCommit(page, 'Selection width', '10');
  await fillAndCommit(page, 'Selection height', '10');
}

async function setPowerAndSpeed(page: Page, power: string, speed: string): Promise<void> {
  const powerInput = page.getByRole('spinbutton', { name: /^Power for/ }).first();
  await powerInput.fill(power);
  await powerInput.press('Tab');
  const speedInput = page.getByRole('spinbutton', { name: /^Speed for/ }).first();
  await speedInput.fill(speed);
  await speedInput.press('Tab');
  await expect(powerInput).toHaveValue(power);
  await expect(speedInput).toHaveValue(speed);
}

async function frameCurrentJob(page: Page, kerfdesk: KerfDeskFixture): Promise<void> {
  await selectWorkspacePanel(page, 'Machine');
  const before = serialWrites(await kerfdesk.events()).length;
  await page.getByRole('button', { name: 'Frame job', exact: true }).click();
  await expect
    .poll(async () => serialWrites(await kerfdesk.events()).slice(before), { timeout: 60_000 })
    .toContain('$J=G90 G21');
  await kerfdesk.emitSerialLine('<Idle|MPos:0.000,0.000,0.000|WCO:0.000,0.000,0.000|FS:0,0>');
  await expect(page.getByRole('button', { name: 'Start framed job', exact: true })).toBeEnabled({
    timeout: 60_000,
  });
}

async function connectAndHome(page: Page, kerfdesk: KerfDeskFixture): Promise<void> {
  await selectWorkspacePanel(page, 'Machine');
  await page.getByRole('button', { name: /^Connect/ }).click();
  await expect(page.getByText('State: Idle', { exact: true })).toBeVisible();
  await expandMachineUtilities(page);
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect.poll(async () => serialWrites(await kerfdesk.events())).toContain('G4 P0.01');
  await kerfdesk.emitSerialLine('<Idle|MPos:0.000,0.000,0.000|WCO:0.000,0.000,0.000|FS:0,0>');
  await expect(page.getByRole('button', { name: 'Home', exact: true })).toBeEnabled();
}

async function runMenuCommand(page: Page, family: string, command: string): Promise<void> {
  const applicationMenu = page.getByRole('menubar', { name: 'Application menu' });
  await applicationMenu.getByRole('menuitem', { name: family, exact: true }).click();
  await applicationMenu.getByRole('menuitem').filter({ hasText: command }).first().click();
}

async function dismissNotifications(page: Page): Promise<void> {
  const notifications = page.getByRole('button', { name: /^Dismiss notification:/ });
  while ((await notifications.count()) > 0) await notifications.first().click();
}

async function fillAndCommit(page: Page, name: string, value: string): Promise<void> {
  const input = page.getByRole('spinbutton', { name });
  // A just-imported image can still be settling: its final bounds land after
  // the field first appears, and that re-render mid-fill appends the typed
  // value to the incoming one (CI saw "12" + "10" = "1210"). Retry until the
  // edit sticks; a field that never accepts the value still fails.
  await expect(async () => {
    await input.fill(value);
    await input.press('Tab');
    await expect(input).toHaveValue(value, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

// A framed laser Start writes a realtime '?' first and sends the program only
// after a status report newer than that query. Answer the way a controller
// does until the program is on the wire: one report emitted right after the
// click can land before the query, and the Start then waits for a fresh report
// that never comes. The query alone is not the job either.
async function answerStatusUntilProgramStarts(
  kerfdesk: KerfDeskFixture,
  writesBefore: number,
  statusLine: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const started = writeEvents(await kerfdesk.events())
          .slice(writesBefore)
          .some((event) => String(event['text']).includes('G21'));
        if (!started) await kerfdesk.emitSerialLine(statusLine);
        return started;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
}

function writeEvents(
  events: readonly Readonly<Record<string, unknown>>[],
): readonly Readonly<Record<string, unknown>>[] {
  return events.filter((event) => event['kind'] === 'serial-write');
}

function serialWrites(events: readonly Readonly<Record<string, unknown>>[]): string {
  return events
    .filter((event) => event['kind'] === 'serial-write')
    .map((event) => String(event['text']))
    .join('');
}
