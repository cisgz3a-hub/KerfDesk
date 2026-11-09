// Abort stays prompt while the Run dialog is open on a 500k-line file (rolling
// audit v11 W7-P2-1, ADR-630 Amendment 9). The dialog re-renders on every
// controller, motion and streamer change, through the Frame and into the
// stream Start begins. Each render re-ran the whole review on the UI thread
// (1.0-1.4 s at 500k lines), so Ctrl+. reached the controller 5.9 s late
// during a Frame and 0.54-0.66 s late once the beam-on stream had begun. The
// paced GRBL stand-in stamps the first jog and the first beam-on line, and
// logs every realtime byte with its time; Ctrl+. is sent from Node so the
// press time does not wait for the page. A CPU profile of the page's own
// thread, from the Frame click until the dialog has gone, must hold no sample
// of a whole-program pass: the review and the lit-rapid scan run in the
// Inspector worker. That holds on any machine, where a time bound on the
// page's other work (Start's preparation, the Abort's teardown) would not.

import type { CDPSession } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from './fixtures/kerfdesk-test';
import {
  connectMachineAndDismissFirstSetup,
  expectToolbarCommandVisible,
} from './fixtures/workspace-ui';

const pacedSerialSource = readFileSync(
  fileURLToPath(new URL('./fixtures/paced-grbl-serial.js', import.meta.url)),
  'utf8',
);

const LINES = 500_000;
const NAME = 'photo.nc';
// From the press to the controller. Before the fix: 539-661 ms in the stream
// and 5,874 ms in a Frame; after it, tens of milliseconds on this route.
const ABORT_BOUND_MS = 300;
// The Run dialog's whole-program passes, which belong in the worker.
const WHOLE_PROGRAM_PASSES = ['reviewExternalProgram', 'findLitRapids'];
// A function the page runs on purpose, so a profile that saw nothing fails.
const PROFILE_PROBE = 'runReviewProfileProbe';
const SOFT_RESET = 0x18;
const JOG_CANCEL = 0x85;

interface Sample {
  readonly watchedAt: number | null;
  readonly realtime: readonly { readonly byte: number; readonly t: number }[];
}

async function openRunDialog(page: Page, blocksPerSecond: number): Promise<void> {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.addInitScript({
    content: `window.__PACED_GRBL_CONFIG__ = { blocksPerSecond: ${blocksPerSecond} };`,
  });
  await page.addInitScript({ content: pacedSerialSource });
  await page.goto('/');
  await expectToolbarCommandVisible(page, 'Open...', { timeout: 180_000 });
  const notifications = page.getByRole('button', { name: /^Dismiss notification:/ });
  while ((await notifications.count()) > 0) await notifications.first().click();
  const machineTab = page.getByRole('tab', { name: 'Machine', exact: true });
  if (await machineTab.isVisible()) await machineTab.click();
  await connectMachineAndDismissFirstSetup(page);
  await expect(page.getByText('State: Idle', { exact: true })).toBeVisible({ timeout: 60_000 });
  // A photo-engrave-shaped program (about 14 MB), built in the page.
  await page.evaluate(
    ({ lines, name }) => {
      const out: string[] = ['G21', 'G90', 'G0 X10 Y10', 'M4 S0', 'G1 F3000'];
      for (let index = 0; out.length < lines - 2; index += 1) {
        const row = Math.floor(index / 1000);
        const column = index % 1000;
        const x = 10 + (row % 2 === 0 ? column : 999 - column) * 0.08;
        out.push(`G1 X${x.toFixed(2)} Y${(10 + row * 0.1).toFixed(2)} S${(index * 37) % 1000}`);
      }
      out.push('M5', 'G0 X0 Y0');
      (
        window as unknown as { __KERFDESK_E2E__: { setOpenFiles: (files: unknown) => void } }
      ).__KERFDESK_E2E__.setOpenFiles([{ name, text: `${out.join('\n')}\n` }]);
    },
    { lines: LINES, name: NAME },
  );
  await page.getByText('File', { exact: true }).click();
  await page.getByRole('menuitem').filter({ hasText: 'Open G-code...' }).click();
  const inspector = page.getByRole('dialog', { name: `G-code Inspector: ${NAME}` });
  await expect(inspector).toBeVisible({ timeout: 180_000 });
  const run = inspector.getByRole('button', { name: 'Run on machine...' });
  await expect(run).toBeEnabled({ timeout: 300_000 });
  await run.click();
  await expect(runDialog(page).getByRole('button', { name: 'Frame', exact: true })).toBeEnabled({
    timeout: 300_000,
  });
}

function runDialog(page: Page) {
  return page.getByRole('dialog', { name: `Run ${NAME}` });
}

async function watchLine(page: Page, source: string): Promise<void> {
  await page.evaluate((pattern) => {
    (
      window as unknown as { __PACED_GRBL__: { watchLine: (pattern: string) => void } }
    ).__PACED_GRBL__.watchLine(pattern);
  }, source);
}

async function waitForWatchedLine(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                __PACED_GRBL__: { watchedLine: () => { at: number | null } | null };
              }
            ).__PACED_GRBL__.watchedLine()?.at ?? null,
        ),
      { timeout: 180_000, intervals: [25] },
    )
    .not.toBeNull();
}

/** Ctrl+. as the operator presses it; returns the wall-clock press time. */
async function pressAbort(cdp: CDPSession): Promise<number> {
  const key = {
    key: '.',
    code: 'Period',
    windowsVirtualKeyCode: 190,
    nativeVirtualKeyCode: 190,
    modifiers: 2,
  };
  const pressedAt = Date.now();
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  return pressedAt;
}

// Every time in wall-clock milliseconds, like Date.now() on the Node side.
function sample(page: Page): Promise<Sample> {
  return page.evaluate(() => {
    const scope = window as unknown as {
      __PACED_GRBL__: {
        realtime: { byte: number; t: number }[];
        watchedLine: () => { at: number | null } | null;
      };
    };
    const at = scope.__PACED_GRBL__.watchedLine()?.at ?? null;
    return {
      watchedAt: at === null ? null : performance.timeOrigin + at,
      realtime: scope.__PACED_GRBL__.realtime.map((entry) => ({
        byte: entry.byte,
        t: performance.timeOrigin + entry.t,
      })),
    };
  });
}

/** How long after `pressedAt` the first of `bytes` reached the controller. */
function abortDelay(data: Sample, pressedAt: number, bytes: readonly number[]): number | null {
  const reached = data.realtime.find(
    (entry) => entry.t >= pressedAt - 5 && bytes.includes(entry.byte),
  );
  return reached === undefined ? null : Math.round(reached.t - pressedAt);
}

async function startProfile(cdp: CDPSession): Promise<void> {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.start');
}

/** Profile samples on the page's thread inside each whole-program pass, and
 * inside the probe the page runs just before the profile stops. */
async function wholeProgramPassSamples(
  page: Page,
  cdp: CDPSession,
): Promise<{ readonly passes: Record<string, number>; readonly probe: number }> {
  await page.evaluate(() => {
    const runReviewProfileProbe = (): void => {
      const until = performance.now() + 30;
      while (performance.now() < until) {
        // Spin: the profile must sample this.
      }
    };
    runReviewProfileProbe();
  });
  const { profile } = await cdp.send('Profiler.stop');
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map<number, number>();
  for (const node of profile.nodes) {
    for (const child of node.children ?? []) parents.set(child, node.id);
  }
  const counts: Record<string, number> = Object.fromEntries(
    [...WHOLE_PROGRAM_PASSES, PROFILE_PROBE].map((name) => [name, 0]),
  );
  for (const sampled of profile.samples ?? []) {
    const seen = new Set<string>();
    for (let at: number | undefined = sampled; at !== undefined; at = parents.get(at)) {
      const name = nodes.get(at)?.callFrame.functionName ?? '';
      if (name in counts) seen.add(name);
    }
    for (const name of seen) counts[name] = (counts[name] ?? 0) + 1;
  }
  const { [PROFILE_PROBE]: probe = 0, ...passes } = counts;
  return { passes, probe };
}

const NO_PASSES = Object.fromEntries(WHOLE_PROGRAM_PASSES.map((name) => [name, 0]));

test('Ctrl+. stops a large file Frame promptly', async ({ page }) => {
  test.setTimeout(600_000);
  // Four blocks a second: each jog of the Frame takes a quarter second.
  await openRunDialog(page, 4);
  const cdp = await page.context().newCDPSession(page);
  await watchLine(page, '^\\$J=');
  await startProfile(cdp);
  await runDialog(page).getByRole('button', { name: 'Frame', exact: true }).click();
  await waitForWatchedLine(page);
  const pressedAt = await pressAbort(cdp);
  await page.waitForTimeout(2_500);
  const { passes, probe } = await wholeProgramPassSamples(page, cdp);
  const data = await sample(page);
  const delay = abortDelay(data, pressedAt, [JOG_CANCEL, SOFT_RESET]);
  test.info().annotations.push({
    type: 'frame-abort',
    description: `${delay} ms; page-thread passes ${JSON.stringify(passes)}`,
  });
  expect(probe).toBeGreaterThan(0);
  expect(passes).toEqual(NO_PASSES);
  expect(delay).not.toBeNull();
  expect(delay).toBeLessThanOrEqual(ABORT_BOUND_MS);
});

test('Ctrl+. stops a large file stream promptly as the beam comes on', async ({ page }) => {
  test.setTimeout(600_000);
  await openRunDialog(page, 500);
  const dialog = runDialog(page);
  const cdp = await page.context().newCDPSession(page);
  await startProfile(cdp);
  await dialog.getByRole('button', { name: 'Frame', exact: true }).click();
  const start = dialog.getByRole('button', { name: 'Start', exact: true });
  await expect(start).toBeEnabled({ timeout: 300_000 });
  await watchLine(page, '^M4');
  await start.click({ noWaitAfter: true });
  // As soon as the beam-on line has gone out: the Run dialog is still open,
  // waiting on the recovery retirement, and re-renders on each store change.
  await waitForWatchedLine(page);
  const pressedAt = await pressAbort(cdp);
  // Start resolves after the recovery retirement, then the dialog closes.
  await expect(dialog).toBeHidden({ timeout: 120_000 });
  await page.waitForTimeout(1_000);
  const { passes, probe } = await wholeProgramPassSamples(page, cdp);
  const data = await sample(page);
  expect(data.watchedAt).not.toBeNull();
  const delay = abortDelay(data, pressedAt, [SOFT_RESET]);
  test.info().annotations.push({
    type: 'stream-abort',
    description: `${delay} ms; page-thread passes ${JSON.stringify(passes)}`,
  });
  expect(probe).toBeGreaterThan(0);
  expect(passes).toEqual(NO_PASSES);
  expect(delay).not.toBeNull();
  expect(delay).toBeLessThanOrEqual(ABORT_BOUND_MS);
});
