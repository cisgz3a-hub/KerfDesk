import { readFileSync } from 'node:fs';
import { expect, type KerfDeskFixture, type Locator, type Page } from './kerfdesk-test';
import {
  acknowledgeJobLinesOnly,
  connectAndHome,
  confirmJobReview,
  dismissNotifications,
  frameCurrentJob,
  programLinesSince,
  reopenProject,
  serialWriteLineCount,
  type FixtureEvents,
} from './recovery-flow';
import { selectWorkspacePanel } from './workspace-ui';

interface Position {
  readonly x: number;
  readonly y: number;
}
const settledHeads = new WeakMap<Page, Position>();
const reviewEstimateTimes = new WeakMap<Page, string>();

export const BASIC_FRAME_CORNERS = [
  '$J=G90 G21 X10.000 Y270.000 F6000',
  '$J=G90 G21 X30.000 Y270.000 F6000',
  '$J=G90 G21 X30.000 Y290.000 F6000',
  '$J=G90 G21 X10.000 Y290.000 F6000',
  '$J=G90 G21 X10.000 Y270.000 F6000',
];

export function frameJogLines(events: FixtureEvents): string[] {
  return programLinesSince(events, 0).filter((line) => line.startsWith('$J='));
}

export async function openAndFrameOnce(
  page: Page,
  kerfdesk: KerfDeskFixture,
  stayAfterJob = false,
): Promise<number> {
  await page.setViewportSize({ width: 1536, height: 864 });
  await page.goto('/');
  if (stayAfterJob) {
    const project = JSON.parse(
      readFileSync(new URL('./project-basic.lf2', import.meta.url), 'utf8'),
    ) as { device: { laserFinishPosition?: { kind: 'stay' } } };
    project.device.laserFinishPosition = { kind: 'stay' };
    await kerfdesk.setOpenFiles([{ name: 'frame-once-stay.lf2', text: JSON.stringify(project) }]);
  }
  await reopenProject(page, stayAfterJob ? 'frame-once-stay.lf2' : 'project-basic.lf2');
  await connectAndHome(page, kerfdesk);
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeDisabled();
  await frameCurrentJob(page, kerfdesk);
  const frameLines = frameJogLines(await kerfdesk.events());
  // Independent fixture geometry: [10,30] x [10,30] on a 300 mm front-left
  // machine maps to work X [10,30], Y [270,290], then returns to captured 0,0.
  expect(frameLines).toEqual([...BASIC_FRAME_CORNERS, '$J=G90 G21 X0.000 Y0.000 F6000']);
  return frameLines.length;
}

export async function clearAndRetype(input: Locator, value: string): Promise<void> {
  await input.focus();
  await input.press('End');
  const digits = (await input.inputValue()).length;
  for (let index = 0; index < digits; index += 1) await input.press('Backspace');
  await expect(input).toHaveValue('');
  await input.page().waitForTimeout(450);
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await input.pressSequentially(value, { delay: 60 });
  await expect(input).toHaveValue(value);
  await input.press('Tab');
  await expect(input).toHaveValue(value);
}

export async function editProcessValues(page: Page, power: string, speed: string): Promise<void> {
  await selectWorkspacePanel(page, 'Artwork');
  const panel = page.getByRole('complementary', {
    name: 'Artwork / Operations panel',
    exact: true,
  });
  await panel
    .getByRole('tablist', { name: 'Edit artwork or operation', exact: true })
    .getByRole('tab', { name: 'Operation', exact: true })
    .click();
  await clearAndRetype(panel.getByRole('spinbutton', { name: /^Power for/ }), power);
  await clearAndRetype(panel.getByRole('spinbutton', { name: /^Speed for/ }), speed);
}

export async function editAdvisoryProfileValues(page: Page): Promise<void> {
  await selectWorkspacePanel(page, 'Machine');
  await page.getByRole('button', { name: 'Machine Setup', exact: true }).click();
  await page.getByRole('button', { name: 'Go to step 2: Essentials', exact: true }).click();
  await page.getByText('Accessories and calibration', { exact: true }).click();
  await page.getByText('Planner and time estimate', { exact: true }).click();
  await clearAndRetype(page.getByLabel('Estimated cut time scale', { exact: true }), '2');
  await clearAndRetype(page.getByLabel('Estimated travel time scale', { exact: true }), '2');
  await page.getByText('No-go zones', { exact: true }).click();
  await page.getByRole('button', { name: 'Add zone', exact: true }).click();
  await page.getByLabel('Safety zone 1 name', { exact: true }).fill('Current review clamp');
  for (const [axis, value] of [
    ['x', '0'],
    ['y', '0'],
    ['width', '300'],
    ['height', '300'],
  ] as const) {
    await clearAndRetype(page.getByLabel(`Safety zone 1 ${axis}`, { exact: true }), value);
  }
  await page.getByRole('button', { name: 'Go to step 3: Review & save', exact: true }).click();
  await page.getByRole('button', { name: 'Save machine setup', exact: true }).click();
}

export async function runAndFinish(
  page: Page,
  kerfdesk: KerfDeskFixture,
  action = 'Start',
  reviewWarning?: RegExp,
): Promise<string[]> {
  await selectWorkspacePanel(page, 'Machine');
  const start = page.getByRole('button', { name: action, exact: true });
  await expect(start).toBeEnabled();
  await kerfdesk.setAutoAcknowledge(false);
  const events = await kerfdesk.events();
  const baselineLines = serialWriteLineCount(events);
  await start.click();
  const review = page.getByRole('dialog', { name: 'Review job before starting' });
  await expect(review).toBeVisible();
  if (reviewWarning !== undefined) await expect(review).toContainText(reviewWarning);
  reviewEstimateTimes.set(
    page,
    await review.getByText('Estimated time', { exact: true }).locator('..').innerText(),
  );
  await confirmJobReview(
    page,
    kerfdesk,
    undefined,
    reportAt(settledHeads.get(page) ?? { x: 0, y: 0 }),
  );
  await acknowledgeJobLinesOnly(page, kerfdesk, baselineLines);
  await expect
    .poll(async () => programLinesSince(await kerfdesk.events(), events.length).at(-1))
    .toBe('G4 P0.01');
  const position = finalWirePosition(
    programLinesSince(await kerfdesk.events(), events.length),
    settledHeads.get(page),
  );
  const report = reportAt(position);
  const complete = page.getByRole('dialog', { name: 'Job complete', exact: true });
  // Report the actual emitted endpoint while the terminal barrier is pending.
  // Its ACK and subsequent stable Idle reports alone complete this owned run.
  await kerfdesk.emitSerialLine(report);
  await expect(complete).toHaveCount(0);
  await kerfdesk.acknowledgeSerial(1);
  await kerfdesk.emitSerialLine(report);
  await expect(complete).toBeVisible();
  settledHeads.set(page, position);
  const lines = programLinesSince(await kerfdesk.events(), events.length);
  await complete.getByRole('button', { name: 'Not now', exact: true }).click();
  await expect(complete).toHaveCount(0);
  await kerfdesk.setAutoAcknowledge(true);
  await dismissNotifications(page);
  return lines;
}

export function lastReviewEstimate(page: Page): string {
  const estimate = reviewEstimateTimes.get(page);
  if (estimate === undefined) throw new Error('Fixture has not observed a Start review estimate');
  return estimate;
}

export async function frameAppSnapshot(page: Page): Promise<unknown> {
  return page.evaluate(async () => {
    const appUrl = '/src/ui/state/index.ts';
    const laserUrl = '/src/ui/state/laser-store.ts';
    const identityUrl = '/src/ui/laser/frame-spatial-identity.ts';
    const expiryUrl = '/src/ui/laser/frame-expiry-note.ts';
    const { useStore, currentOutputScope } = (await import(appUrl)) as {
      useStore: { getState: () => Record<string, unknown> };
      currentOutputScope: (state: Record<string, unknown>) => unknown;
    };
    const { useLaserStore } = (await import(laserUrl)) as {
      useLaserStore: { getState: () => Record<string, unknown> };
    };
    const { currentFrameSpatialSignature } = (await import(identityUrl)) as {
      currentFrameSpatialSignature: () => string;
    };
    const { frameExpiryReason } = (await import(expiryUrl)) as {
      frameExpiryReason: () => string | null;
    };
    const app = useStore.getState();
    const laser = useLaserStore.getState();
    const project = app['project'] as { device: Record<string, unknown> };
    return {
      project,
      deviceKeys: Object.keys(project.device),
      placement: app['jobPlacement'],
      outputScope: currentOutputScope(app),
      spatialSignature: currentFrameSpatialSignature(),
      expiryReason: frameExpiryReason(),
      laser: Object.fromEntries(
        [
          'completedFrame',
          'frameVerification',
          'framedRun',
          'frameTrace',
          'connectionEpoch',
          'positionEpoch',
          'streamerEpoch',
          'settingsVersion',
          'controllerSettings',
          'grblSettingsRows',
          'statusReport',
          'connected',
          'homed',
          'machineOrigin',
          'wcsState',
          'nativeCoordinateEvidence',
          'controllerOperation',
          'motionOperation',
          'pendingUntrackedAcks',
          'pendingTransportWrites',
        ].map((key) => [key, laser[key]]),
      ),
    };
  });
}

export function expectCutWords(lines: readonly string[], powerS: number, feed: number): void {
  const positivePower = lines.flatMap((line) => words(line, 'S')).filter((value) => value > 0);
  const cuttingFeeds = lines
    .filter((line) => /^G0?[123](?:\s|$)/.test(line))
    .flatMap((line) => words(line, 'F'));
  expect([...new Set(positivePower)]).toEqual([powerS]);
  expect([...new Set(cuttingFeeds)]).toEqual([feed]);
  expect(lines.some((line) => /^G0?1\s.*[XY]/.test(line))).toBe(true);
  expect(lines.some((line) => line.startsWith('$J='))).toBe(false);
}

function words(line: string, letter: 'S' | 'F' | 'G' | 'X' | 'Y'): number[] {
  return [...line.matchAll(new RegExp(`${letter}\\s*(-?\\d+(?:\\.\\d+)?)`, 'g'))].map((match) =>
    Number(match[1]),
  );
}

/** Independent bounded oracle for this fixture's mm/absolute wire programs. */
export function finalWirePosition(
  lines: readonly string[],
  initial: Position = { x: 0, y: 0 },
): Position {
  let { x, y } = initial;
  let motion = 0;
  for (const line of lines) {
    if (line.startsWith('$')) continue;
    const modes = words(line, 'G');
    if (modes.some((mode) => mode === 20 || mode === 91 || mode === 92)) {
      throw new Error(`Fixture oracle requires mm, absolute coordinates without rebasing: ${line}`);
    }
    for (const mode of modes) if ([0, 1, 2, 3].includes(mode)) motion = mode;
    if (![0, 1, 2, 3].includes(motion)) continue;
    x = words(line, 'X').at(-1) ?? x;
    y = words(line, 'Y').at(-1) ?? y;
  }
  return { x, y };
}

function reportAt({ x, y }: Position): string {
  return `<Idle|MPos:${x.toFixed(3)},${y.toFixed(3)},0.000|WCO:0.000,0.000,0.000|FS:0,0>`;
}
