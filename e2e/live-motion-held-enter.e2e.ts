// A held Enter never resumes a paused job (rolling audit v10 V8-P2-1, ADR-207
// Amendment 3). Pause flips to Pausing… then Resume in one focused button, and
// Chromium clicks a focused button on every auto-repeated Enter keypress: a
// 1 s hold paused, then resumed the burn once Resume showed. The keys come
// from CDP as Windows delivers a held key (one keydown, a 500 ms delay, then a
// repeat every 33 ms, then keyup), and the paced GRBL stand-in logs every
// realtime byte it receives. Frame job hands focus back to itself when its
// Frame ends (U7-P3-1), so a held Enter re-ran the Frame too (V9-P3-1).

import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  connectMachineAndDismissFirstSetup,
  expectToolbarCommandVisible,
  selectWorkspacePanel,
} from './fixtures/workspace-ui';

const pacedSerialSource = readFileSync(
  fileURLToPath(new URL('./fixtures/paced-grbl-serial.js', import.meta.url)),
  'utf8',
);

const REPEAT_DELAY_MS = 500;
const REPEAT_EVERY_MS = 33;
const SAFETY_DOOR = 0x84;
const CYCLE_START = 0x7e;
const SOFT_RESET = 0x18;

interface PacedGrbl {
  readonly realtime: readonly { readonly byte: number; readonly t: number }[];
  readonly state: () => string;
}

async function connectWithRings(page: Page): Promise<void> {
  // 30 blocks/s keeps the 12-ring job running for the whole test.
  await page.addInitScript({ content: 'window.__PACED_GRBL_CONFIG__ = { blocksPerSecond: 30 };' });
  await page.addInitScript({ content: pacedSerialSource });
  await page.goto('/');
  await expectToolbarCommandVisible(page, 'Open...', { timeout: 120_000 });
  await page.evaluate(async () => {
    const scenePath = '/src/core/scene/index.ts';
    const storePath = '/src/ui/state/store.ts';
    const [scene, store] = (await Promise.all([
      import(/* @vite-ignore */ scenePath),
      import(/* @vite-ignore */ storePath),
    ])) as [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any,
    ];
    const ring = (cx: number, cy: number) => ({
      closed: true,
      points: Array.from({ length: 96 }, (_, index) => ({
        x: Math.round((cx + 12 * Math.cos((index / 96) * Math.PI * 2)) * 1000) / 1000,
        y: Math.round((cy + 12 * Math.sin((index / 96) * Math.PI * 2)) * 1000) / 1000,
      })),
    });
    const polylines = Array.from({ length: 12 }, (_, index) =>
      ring(60 + (index % 4) * 30, 60 + Math.floor(index / 4) * 30),
    );
    const layer = {
      ...scene.createLayer({ id: 'cut', color: '#000000', mode: 'line' }),
      speed: 1500,
    };
    const created = scene.createProject();
    store.useStore.getState().setProject({
      ...created,
      device: { ...created.device, homing: { enabled: true, direction: 'front-left' } },
      jobSetup: {
        ...created.jobSetup,
        placement: { ...created.jobSetup.placement, startFrom: 'current-position' },
      },
      scene: {
        ...created.scene,
        layers: [layer],
        objects: [
          {
            kind: 'imported-svg',
            id: 'rings',
            source: 'rings.svg',
            operationIds: ['cut'],
            bounds: { minX: 40, minY: 40, maxX: 160, maxY: 120 },
            transform: scene.IDENTITY_TRANSFORM,
            paths: [{ color: '#000000', polylines }],
          },
        ],
      },
    });
  });
  const notifications = page.getByRole('button', { name: /^Dismiss notification:/ });
  while ((await notifications.count()) > 0) await notifications.first().click();
  await selectWorkspacePanel(page, 'Machine');
  await connectMachineAndDismissFirstSetup(page);
  await expect(page.getByText('State: Idle', { exact: true })).toBeVisible();
}

async function openFramedJob(page: Page): Promise<void> {
  await connectWithRings(page);
  await page.getByRole('button', { name: 'Frame job', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled({
    timeout: 120_000,
  });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Review job before starting' })).toBeVisible({
    timeout: 120_000,
  });
}

async function enter(cdp: CDPSession, type: 'keyDown' | 'keyUp', autoRepeat = false) {
  const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
  await cdp.send(
    'Input.dispatchKeyEvent',
    type === 'keyDown'
      ? { type, ...key, text: '\r', unmodifiedText: '\r', autoRepeat }
      : { type, ...key },
  );
}

/** One keydown, the OS repeat delay, a repeat every 33 ms, then keyup. */
async function holdEnter(page: Page, holdMs: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const start = Date.now();
  await enter(cdp, 'keyDown');
  for (let next = start + REPEAT_DELAY_MS; next <= start + holdMs; next += REPEAT_EVERY_MS) {
    const wait = next - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
    await enter(cdp, 'keyDown', true);
  }
  const rest = start + holdMs - Date.now();
  if (rest > 0) await page.waitForTimeout(rest);
  await enter(cdp, 'keyUp');
  await cdp.detach();
}

function realtimeBytes(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    (window as unknown as { __PACED_GRBL__: PacedGrbl }).__PACED_GRBL__.realtime.map(
      (entry) => entry.byte,
    ),
  );
}

function simulatedState(page: Page): Promise<string> {
  return page.evaluate(() =>
    (window as unknown as { __PACED_GRBL__: PacedGrbl }).__PACED_GRBL__.state(),
  );
}

const count = (bytes: number[], byte: number) => bytes.filter((value) => value === byte).length;

test('a held Enter on Pause pauses once and never resumes', async ({ page }) => {
  test.setTimeout(300_000);
  await openFramedJob(page);
  const review = page.getByRole('dialog', { name: 'Review job before starting' });
  await review.getByRole('button', { name: 'Start job' }).click();
  const pause = page.getByRole('button', { name: 'Pause', exact: true });
  await expect(pause).toBeFocused();
  await expect.poll(() => simulatedState(page)).toBe('Run');

  // The refuter's 1000 and 2000 ms holds resumed the job; hold past both.
  await holdEnter(page, 2500);
  const resume = page.getByRole('button', { name: 'Resume', exact: true });
  await expect(resume).toBeVisible();
  await expect(resume).toBeFocused();
  await page.waitForTimeout(1000);
  const held = await realtimeBytes(page);
  expect(count(held, SAFETY_DOOR)).toBe(1);
  expect(count(held, CYCLE_START)).toBe(0);
  expect(count(held, SOFT_RESET)).toBe(0);
  expect(await simulatedState(page)).toBe('Door:0');

  // A fresh press is a deliberate Resume, and it still works from the keyboard.
  await holdEnter(page, 80);
  await expect(pause).toBeVisible();
  await expect(pause).toBeFocused();
  const resumed = await realtimeBytes(page);
  expect(count(resumed, CYCLE_START)).toBe(1);
  expect(count(resumed, SOFT_RESET)).toBe(0);
  await expect.poll(() => simulatedState(page)).toBe('Run');
});

test('a held Enter on Start job starts the job and never pauses it', async ({ page }) => {
  test.setTimeout(300_000);
  await openFramedJob(page);
  const startJob = page
    .getByRole('dialog', { name: 'Review job before starting' })
    .getByRole('button', { name: 'Start job' });
  await expect(startJob).toBeEnabled();
  await startJob.focus();
  await holdEnter(page, 2000);
  const pause = page.getByRole('button', { name: 'Pause', exact: true });
  await expect(pause).toBeVisible();
  await expect(pause).toBeFocused();
  await page.waitForTimeout(1000);
  const bytes = await realtimeBytes(page);
  expect(count(bytes, SAFETY_DOOR)).toBe(0);
  expect(count(bytes, CYCLE_START)).toBe(0);
  expect(count(bytes, SOFT_RESET)).toBe(0);
  expect(await simulatedState(page)).toBe('Run');
});

test('a held Enter on Frame job frames once, however long it is held', async ({ page }) => {
  test.setTimeout(300_000);
  await connectWithRings(page);
  const frame = page.locator('[data-search-target="frame-job"]');
  await expect(frame).toBeEnabled({ timeout: 120_000 });
  // Count Frames as the button turning itself off.
  await frame.evaluate((button) => {
    const runs = { count: 0 };
    (window as unknown as { __FRAME_RUNS__: typeof runs }).__FRAME_RUNS__ = runs;
    let off = (button as HTMLButtonElement).disabled;
    new MutationObserver(() => {
      const now = (button as HTMLButtonElement).disabled;
      if (now && !off) runs.count += 1;
      off = now;
    }).observe(button, { attributes: true, attributeFilter: ['disabled'] });
  });
  const frameRuns = () =>
    page.evaluate(
      () => (window as unknown as { __FRAME_RUNS__: { count: number } }).__FRAME_RUNS__.count,
    );
  await frame.click();
  await expect.poll(frameRuns).toBe(1);
  await expect(page.getByRole('button', { name: 'Frame again', exact: true })).toBeEnabled({
    timeout: 120_000,
  });

  // The auditor's 4 s hold ran two extra Frames once focus came back.
  await frame.focus();
  await holdEnter(page, 4000);
  await expect(frame).toBeEnabled({ timeout: 120_000 });
  await expect(frame).toBeFocused();
  await page.waitForTimeout(2000);
  expect(await frameRuns()).toBe(2);
  const bytes = await realtimeBytes(page);
  expect(count(bytes, SOFT_RESET)).toBe(0);
});
