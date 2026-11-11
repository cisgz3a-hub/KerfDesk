// In-app dialogs (ADR-707) in a real browser.
//
// PROJECT.md non-negotiable 9: no modal may block Abort during a job. An in-app
// dialog may open while a job runs only because the Live Motion bar stays
// above it. The unit test holds the structure; this spec holds what structure
// cannot: a real pointer click on ABORT JOB lands on it with a dialog open
// (Playwright refuses a click that another element would receive), and the
// dialog makes room for the bar instead of sitting under it.
//
// ADR-207 Amendment 3: Chromium clicks a focused button on every auto-repeated
// Enter. The keys here come from CDP as Windows delivers a held key, so the
// second test shows a held Enter opening a question and not answering it.

import type { CDPSession } from '@playwright/test';
import { expect, test, type Locator, type Page } from './fixtures/kerfdesk-test';
import { selectWorkspacePanel } from './fixtures/workspace-ui';

const REPEAT_DELAY_MS = 500;
const REPEAT_EVERY_MS = 33;

interface DialogProbe {
  __abortClicks?: number;
  __confirmAnswer?: boolean | 'pending';
  /** How often the question was asked, and each answer it got. */
  __asked?: number;
  __answers?: boolean[];
}

async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#app-splash')).toHaveCount(0, { timeout: 20_000 });
  const setupHint = page.getByRole('button', { name: 'Not now', exact: true });
  if (await setupHint.isVisible()) await setupHint.click();
}

/** A streaming job in the store, with Abort counted instead of sent. */
async function startStreamingJob(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const storePath = '/src/ui/state/laser-store.ts';
    const streamerPath = '/src/core/controllers/grbl/streamer.ts';
    const { useLaserStore } = (await import(/* @vite-ignore */ storePath)) as {
      useLaserStore: {
        getState: () => { capabilities: Record<string, unknown> };
        setState: (state: Record<string, unknown>) => void;
      };
    };
    const { createStreamer } = (await import(/* @vite-ignore */ streamerPath)) as {
      createStreamer: (gcode: string) => Record<string, unknown>;
    };
    const probe = window as unknown as { __abortClicks?: number };
    probe.__abortClicks = 0;
    useLaserStore.setState({
      connection: { kind: 'connected' },
      capabilities: { ...useLaserStore.getState().capabilities, realtimePause: true },
      streamer: { ...createStreamer('G1 X1 S100\nG1 X2 S100\n'), status: 'streaming' },
      stopJob: async () => {
        probe.__abortClicks = (probe.__abortClicks ?? 0) + 1;
      },
    });
  });
}

/** Publishes `window.__askDelete()`, which asks the question the material
 *  library asks before it deletes a preset, and records the answer. */
async function installDeleteQuestion(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const dialogsPath = '/src/ui/state/app-dialogs.ts';
    const { appConfirm } = (await import(/* @vite-ignore */ dialogsPath)) as {
      appConfirm: (options: Record<string, string>) => Promise<boolean>;
    };
    const probe = window as unknown as {
      __confirmAnswer?: boolean | 'pending';
      __asked?: number;
      __answers?: boolean[];
      __askDelete?: () => void;
    };
    probe.__asked = 0;
    probe.__answers = [];
    probe.__askDelete = () => {
      probe.__asked = (probe.__asked ?? 0) + 1;
      probe.__confirmAnswer = 'pending';
      void appConfirm({
        title: 'Delete preset?',
        message: 'Delete preset "Birch plywood - 3 mm" from this material library?',
        confirmLabel: 'Delete',
        tone: 'danger',
      }).then((answer) => {
        probe.__confirmAnswer = answer;
        probe.__answers?.push(answer);
      });
    };
  });
}

function abortClicks(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as DialogProbe).__abortClicks ?? 0);
}

function confirmAnswer(page: Page): Promise<boolean | 'pending' | undefined> {
  return page.evaluate(() => (window as unknown as DialogProbe).__confirmAnswer);
}

function questionHistory(page: Page): Promise<{ asked: number; answers: boolean[] }> {
  return page.evaluate(() => {
    const probe = window as unknown as DialogProbe;
    return { asked: probe.__asked ?? 0, answers: [...(probe.__answers ?? [])] };
  });
}

/** The dialog's panel ends above the bar: neither covers the other. */
async function expectDialogClearOfBar(dialog: Locator, bar: Locator): Promise<void> {
  const panel = await dialog.locator('.lf-dialog').boundingBox();
  const barBox = await bar.boundingBox();
  expect(panel).not.toBeNull();
  expect(barBox).not.toBeNull();
  if (panel === null || barBox === null) return;
  expect(panel.y + panel.height).toBeLessThanOrEqual(barBox.y + 0.5);
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

test.use({ viewport: { width: 1366, height: 768 } });

test('ABORT JOB takes a real click while an in-app dialog is open', async ({ page }) => {
  test.setTimeout(180_000);
  await openApp(page);
  await selectWorkspacePanel(page, 'Machine');
  await startStreamingJob(page);
  await installDeleteQuestion(page);

  const bar = page.getByRole('region', { name: 'Live Motion', exact: true });
  const abort = bar.getByRole('button', { name: 'ABORT JOB', exact: true });
  await expect(abort).toBeVisible();

  // Help > Safety & liability is a dialog now, readable during a job, with a
  // link that can be followed (annoyance audit A1-P3-1).
  await page.getByText('Help', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Safety & liability', exact: true }).click();
  const safety = page.getByRole('dialog', { name: 'Safety & liability', exact: true });
  await expect(safety).toBeVisible();
  await expect(safety.getByRole('link', { name: 'https://kerfdesk.com/safety/' })).toHaveAttribute(
    'href',
    'https://kerfdesk.com/safety/',
  );
  await expectDialogClearOfBar(safety, bar);
  await abort.click();
  expect(await abortClicks(page)).toBe(1);
  await expect(safety).toBeVisible();
  await safety.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(safety).toHaveCount(0);

  // An in-app confirm, asked during the job and left unanswered.
  await page.evaluate(() => (window as unknown as { __askDelete: () => void }).__askDelete());
  const confirm = page.getByRole('dialog', { name: 'Delete preset?', exact: true });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole('button')).toHaveText(['Delete', 'Cancel']);
  await expectDialogClearOfBar(confirm, bar);
  await abort.click();
  expect(await abortClicks(page)).toBe(2);

  // Aborting neither answered the question nor closed it; its own button does.
  await expect(confirm).toBeVisible();
  expect(await confirmAnswer(page)).toBe('pending');
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  expect(await confirmAnswer(page)).toBe(true);
});

test('a held Enter that opens a question does not answer it', async ({ page }) => {
  test.setTimeout(180_000);
  await openApp(page);
  await installDeleteQuestion(page);
  // A stand-in for the button that asks: pressing it opens the question, and
  // the question then takes the focus onto its own Delete button.
  await page.evaluate(() => {
    const opener = document.createElement('button');
    opener.type = 'button';
    opener.textContent = 'Ask to delete';
    opener.style.cssText = 'position:fixed;top:8px;left:8px;z-index:2147483646';
    opener.addEventListener('click', () =>
      (window as unknown as { __askDelete: () => void }).__askDelete(),
    );
    document.body.appendChild(opener);
  });
  const opener = page.getByRole('button', { name: 'Ask to delete', exact: true });
  await opener.focus();
  await expect(opener).toBeFocused();

  // The first keydown presses the opener; every repeat after it lands on Delete.
  // Unguarded, each repeat answers the question and the next one asks it again,
  // so the end state alone proves nothing: count the asks and the answers.
  await holdEnter(page, 2000);
  const confirm = page.getByRole('dialog', { name: 'Delete preset?', exact: true });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole('button', { name: 'Delete', exact: true })).toBeFocused();
  expect(await questionHistory(page)).toEqual({ asked: 1, answers: [] });

  // A fresh press is the answer, and it still works from the keyboard.
  await holdEnter(page, 80);
  await expect(confirm).toHaveCount(0);
  expect(await questionHistory(page)).toEqual({ asked: 1, answers: [true] });
});
