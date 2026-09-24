// Shared browser helpers for interrupted-job recovery and completion-offer
// workflows (ADR-341). They drive the real app against the fake Web Serial
// fixture, hold acknowledgements so a disconnect lands at a chosen line, and
// probe the live stores through the same module instances the app uses.

import { expandMachineUtilities, selectWorkspacePanel } from './workspace-ui';
import { expect, type KerfDeskFixture, type Locator, type Page } from './kerfdesk-test';

export const IDLE = '<Idle|MPos:0.000,0.000,0.000|WCO:0.000,0.000,0.000|FS:0,0>';
const ASCII_REALTIME_BYTES = new Set(['?', '!', '~', String.fromCharCode(0x18)]);

/** GRBL takes these out of the stream before its line buffer: the ASCII
 * realtime commands and every extended-ASCII byte (0x80 and up), which covers
 * door, jog cancel, and the feed/rapid/spindle override resets a laser Start
 * sends ahead of its first line (ADR-355). Program lines compare without them. */
function isRealtimeByte(character: string): boolean {
  return ASCII_REALTIME_BYTES.has(character) || character.charCodeAt(0) >= 0x80;
}

export type FixtureEvents = readonly Readonly<Record<string, unknown>>[];

export async function streamProbe(page: Page): Promise<{
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

/** The streamed program, one sendable line per entry, as the controller receives it. */
export async function queuedJobLines(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const moduleUrl = '/src/ui/state/laser-store.ts';
    const { useLaserStore } = (await import(moduleUrl)) as {
      useLaserStore: { getState: () => { streamer: { queued: readonly string[] } | null } };
    };
    return (useLaserStore.getState().streamer?.queued ?? []).map((line) => line.trim());
  });
}

export interface CapsuleProbe {
  readonly runId: string;
  readonly ackedLines: number;
  readonly sendableLines: number;
  readonly interruption: string;
  readonly interruptionMessage: string;
  readonly resumeLine: number;
  readonly resumeChain: number;
  readonly expectedSent: readonly string[];
  /** The sealed program the capsule would resume. */
  readonly gcode: string;
}

export async function capsuleProbe(page: Page): Promise<CapsuleProbe | null> {
  return page.evaluate(async () => {
    const recoveryUrl = '/src/ui/state/recovery/index.ts';
    const restartUrl = '/src/core/recovery/automatic-restart-line.ts';
    const resumeUrl = '/src/ui/laser/laser-resume-program.ts';
    const { recoveryRepository } = (await import(recoveryUrl)) as {
      recoveryRepository: {
        getSnapshot: () => {
          recoveryCapsule: {
            runId: string;
            ackedLines: number;
            sendableLines: number;
            interruption: { kind: string; message: string };
            artifact: {
              kind: string;
              gcode?: string;
              laserResumeChain?: readonly unknown[];
              prepared?: { project: { device: unknown } };
            };
          } | null;
        };
      };
    };
    // The same automatic restart line the recovery flow uses.
    const { automaticRestart } = (await import(restartUrl)) as {
      automaticRestart: (
        gcode: string,
        acked: number,
        interruption: { kind: string; message: string },
      ) => { line: number };
    };
    const { buildLaserResumeProgram } = (await import(resumeUrl)) as {
      buildLaserResumeProgram: (
        gcode: string,
        fromLine: number,
        device: unknown,
      ) => { kind: 'ok'; lines: readonly string[] } | { kind: 'error'; reason: string };
    };
    const capsule = recoveryRepository.getSnapshot().recoveryCapsule;
    if (capsule === null || capsule.artifact.kind !== 'exact-execution') return null;
    const gcode = capsule.artifact.gcode ?? '';
    const resumeLine = automaticRestart(gcode, capsule.ackedLines, capsule.interruption).line;
    // The recovery flow resumes in the power commands of the archived profile (ADR-364).
    const device = capsule.artifact.prepared?.project.device;
    const program = buildLaserResumeProgram(gcode, resumeLine, device);
    const sendable = (line: string): boolean => line.trim() !== '' && !line.trim().startsWith(';');
    return {
      runId: capsule.runId,
      ackedLines: capsule.ackedLines,
      sendableLines: capsule.sendableLines,
      interruption: capsule.interruption.kind,
      interruptionMessage: capsule.interruption.message,
      resumeLine,
      resumeChain: capsule.artifact.laserResumeChain?.length ?? 0,
      expectedSent: program.kind === 'ok' ? program.lines.filter(sendable) : [],
      gcode,
    };
  });
}

/** Accept every native dialog; return the ones that refused or failed an action. */
export function collectRefusals(page: Page): () => string[] {
  const messages: string[] = [];
  page.on('dialog', (dialog) => {
    if (/^Cannot|Could not|could not be/i.test(dialog.message())) messages.push(dialog.message());
    void dialog.accept();
  });
  return () => messages;
}

export function programLinesSince(events: FixtureEvents, fromEventIndex: number): string[] {
  return events
    .slice(fromEventIndex)
    .filter((event) => event['kind'] === 'serial-write')
    .flatMap((event) =>
      [...String(event['text'])]
        .filter((character) => !isRealtimeByte(character))
        .join('')
        .split('\n'),
    )
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** Acknowledge job lines until the streamer reports done, leaving the settle
 * marker unacknowledged so the controller is still settling. */
export async function acknowledgeJobLinesOnly(
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
export async function acknowledgeExactly(
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

export async function selectAll(page: Page): Promise<void> {
  await runMenuCommand(page, 'Edit', 'Select All');
}

export async function frameCurrentJob(page: Page, kerfdesk: KerfDeskFixture): Promise<void> {
  const writesBeforeFrame = serialWrites(await kerfdesk.events()).length;
  await page.getByRole('button', { name: 'Frame job', exact: true }).click();
  await expect
    .poll(async () => serialWrites(await kerfdesk.events()).slice(writesBeforeFrame))
    .toContain('$J=G90 G21');
  await expect(page.getByRole('button', { name: 'Start framed job', exact: true })).toBeEnabled();
}

export async function confirmJobReview(
  page: Page,
  kerfdesk: KerfDeskFixture,
  startButton: Locator = page
    .getByRole('dialog', { name: 'Review job before starting' })
    .getByRole('button', { name: 'Start job' }),
  /** The fresh report the controller answers with; carry the live work offset. */
  status: string = IDLE,
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
  await kerfdesk.emitSerialLine(status);
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

export async function reopenProject(page: Page, name = 'project-basic.lf2'): Promise<void> {
  await page.getByRole('button', { name: 'Open...' }).click();
  await expect(page).toHaveTitle(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await dismissNotifications(page);
}

export async function dismissNotifications(page: Page): Promise<void> {
  const notifications = page.getByRole('button', { name: /^Dismiss notification:/ });
  while ((await notifications.count()) > 0) {
    await notifications.first().click();
  }
}

export async function runMenuCommand(page: Page, family: string, command: string): Promise<void> {
  const applicationMenu = page.getByRole('menubar', { name: 'Application menu' });
  await applicationMenu.getByRole('menuitem', { name: family, exact: true }).click();
  await applicationMenu.getByRole('menuitem').filter({ hasText: command }).click();
}

export async function connectAndHome(page: Page, kerfdesk: KerfDeskFixture): Promise<void> {
  await selectWorkspacePanel(page, 'Machine');
  await page.getByRole('button', { name: /^Connect/ }).click();
  await expect(page.getByText('State: Idle', { exact: true })).toBeVisible();
  await expandMachineUtilities(page);
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect.poll(async () => serialWrites(await kerfdesk.events())).toContain('G4 P0.01');
  await kerfdesk.emitSerialLine(IDLE);
  await expect(page.getByRole('button', { name: 'Home', exact: true })).toBeEnabled();
}

export function serialWrites(events: FixtureEvents): string {
  return events
    .filter((event) => event['kind'] === 'serial-write')
    .map((event) => String(event['text']))
    .join('');
}

export function serialWriteBytes(events: FixtureEvents): number[] {
  return events.flatMap((event) => {
    if (event['kind'] !== 'serial-write') return [];
    const bytes = event['bytes'];
    if (!Array.isArray(bytes)) return [];
    return bytes.filter((value): value is number => typeof value === 'number');
  });
}

export function serialWriteLineCount(events: FixtureEvents): number {
  return events
    .filter((event) => event['kind'] === 'serial-write')
    .map((event) => String(event['text']))
    .reduce((count, text) => count + [...text].filter((character) => character === '\n').length, 0);
}

export async function drainHeldSerialWrites(
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
