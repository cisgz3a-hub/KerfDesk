// Annoyance audit A3-P2-2 and A3-P2-4 (ADR-674 Amendment 1), in a real browser
// with real pointer and key events. The audit read the code and left a runtime
// check owed.
// - Quick taps on a jog arrow used to move one step: the arrows greyed out for
//   the whole of the first step, so every later tap was lost.
// - Enter on a blocked Console command used to do nothing: a browser does not
//   submit a form through a disabled Send button.
// The controller is the in-page journey GRBL (fixtures/journey-grbl-serial.js),
// slowed so that one 10 mm step takes about two and a half seconds.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from './fixtures/kerfdesk-test';
import {
  connectMachineThroughToolbar,
  openMachineToolDropdown,
  selectWorkspacePanel,
} from './fixtures/workspace-ui';

const journeyGrbl = readFileSync(
  fileURLToPath(new URL('./fixtures/journey-grbl-serial.js', import.meta.url)),
  'utf8',
);

interface JourneyWindow {
  readonly __JOURNEY_GRBL__: { readonly wire: string[] };
}

const wireLines = (page: Page, pattern: string): Promise<string[]> =>
  page.evaluate(
    (source) =>
      (window as unknown as JourneyWindow).__JOURNEY_GRBL__.wire.filter((line) =>
        new RegExp(source).test(line),
      ),
    pattern,
  );

const JOG_LINE = '^\\$J=';
// About how fast a person taps a button twice.
const TAP_GAP_MS = 150;

async function connectSlowGrbl(page: Page): Promise<void> {
  await page.addInitScript({
    content: 'window.__JOURNEY_GRBL_CONFIG__ = { blocksPerSecond: 0.4 };',
  });
  await page.addInitScript({ content: journeyGrbl });
  await page.goto('/');
  await selectWorkspacePanel(page, 'Machine');
  await connectMachineThroughToolbar(page);
  const setup = page.getByRole('dialog', { name: 'Machine Setup', exact: true });
  if (
    await setup.waitFor({ timeout: 15_000 }).then(
      () => true,
      () => false,
    )
  ) {
    await setup.getByRole('button', { name: 'Cancel without saving', exact: true }).click();
    await expect(setup).not.toBeVisible();
  }
  await expect(page.getByRole('region', { name: 'Machine toolbar', exact: true })).toContainText(
    'Connected',
  );
}

test.use({ viewport: { width: 1440, height: 1000 } });

test('three quick taps on a jog arrow move three steps', async ({ page }) => {
  test.setTimeout(300_000);
  await connectSlowGrbl(page);
  const right = page
    .getByRole('region', { name: 'Jog and positioning', exact: true })
    .getByRole('button', { name: /^Jog \+X \d/ });
  await expect(right).toBeEnabled({ timeout: 60_000 });

  // `force` presses whatever is there: a tap on a greyed-out arrow is lost, as
  // it is for a person, where an ordinary click would wait for the arrow.
  await right.click();
  await page.waitForTimeout(TAP_GAP_MS);
  // The step is still running, and the arrow is still live.
  expect(await right.isEnabled()).toBe(true);
  await right.click({ force: true });
  await page.waitForTimeout(TAP_GAP_MS);
  await right.click({ force: true });

  // Every tap becomes a step: the later ones wait in KerfDesk and follow.
  await expect.poll(() => wireLines(page, JOG_LINE), { timeout: 30_000 }).toHaveLength(3);
  expect(new Set(await wireLines(page, JOG_LINE)).size).toBe(1);
  // No tap was refused.
  await expect(page.getByRole('region', { name: 'Notifications', exact: true })).not.toContainText(
    'Jog:',
  );
});

test('Enter on a blocked Console command says why, then sends once the block clears', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await connectSlowGrbl(page);
  const right = page
    .getByRole('region', { name: 'Jog and positioning', exact: true })
    .getByRole('button', { name: /^Jog \+X \d/ });
  await expect(right).toBeEnabled({ timeout: 60_000 });
  const consolePanel = await openMachineToolDropdown(page, 'Console');
  const input = consolePanel.getByRole('textbox', { name: 'Console command', exact: true });
  await input.fill('G91');

  // A step that takes about a second holds the Console for that long.
  await right.click();
  await expect(consolePanel.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await input.press('Enter');
  const reason = consolePanel
    .getByRole('alert')
    .filter({ hasText: 'A jog or Frame is still running.' });
  await expect(reason).toBeVisible();
  expect(await wireLines(page, '^G91$')).toHaveLength(0);

  // The reason goes with the block, and the same key then sends the line.
  await expect(reason).toHaveCount(0, { timeout: 30_000 });
  await input.press('Enter');
  await expect.poll(() => wireLines(page, '^G91$'), { timeout: 15_000 }).toHaveLength(1);
});
