import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from './fixtures/kerfdesk-test';
import { connectMachineAndDismissFirstSetup, selectWorkspacePanel } from './fixtures/workspace-ui';
import type { SerialTranscriptEntry } from '../src/ui/state/laser-transcript';

test('controller incidents survive acknowledgements and reconnect in the console and saved report', async ({
  page,
  kerfdesk,
}, info) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  await selectWorkspacePanel(page, 'Machine');
  await connectMachineAndDismissFirstSetup(page);
  await expect(page.getByText('State: Idle', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Info: Machine settings detected:/)).toBeVisible();
  await kerfdesk.emitSerialLine('ALARM:2');
  await kerfdesk.emitSerialLine('error:20');
  await expect
    .poll(async () => (await incidents(page)).map((entry) => entry.raw))
    .toContain('ALARM:2');
  const original = (await incidents(page)).filter(
    (entry) => entry.kind === 'alarm' || entry.kind === 'error',
  );
  expect(original).toHaveLength(2);
  await page.evaluate(() => {
    const fixture = (
      window as typeof window & {
        __KERFDESK_E2E__: { emitSerialLine: (line: string) => void };
      }
    ).__KERFDESK_E2E__;
    for (let i = 0; i < 600; i += 1) fixture.emitSerialLine('ok');
  });
  await expect
    .poll(async () => (await liveTranscript(page)).some((entry) => entry.raw === 'ALARM:2'))
    .toBe(false);
  expect(
    (await incidents(page)).filter((entry) => original.some((prior) => prior.id === entry.id)),
  ).toEqual(original);
  await kerfdesk.disconnectSerial();
  await expect(page.getByRole('button', { name: /^Connect/ })).toBeVisible();
  await expect
    .poll(async () => (await incidents(page)).some((entry) => entry.kind === 'disconnect'))
    .toBe(true);
  await connectMachineAndDismissFirstSetup(page);
  await expect(page.getByText('State: Idle', { exact: true })).toBeVisible();
  expect(
    (await incidents(page)).filter((entry) => original.some((prior) => prior.id === entry.id)),
  ).toEqual(original);

  const summary = page.locator('.lf-machine-rail summary').filter({ hasText: /^Console$/ });
  if ((await summary.locator('..').getAttribute('open')) === null) await summary.click();
  await page.getByRole('button', { name: 'Super console', exact: true }).click();
  const consoleDialog = page.getByRole('dialog', { name: 'Super console', exact: true });
  await expect(consoleDialog).toBeVisible();
  for (const label of ['Commands', 'Replies', 'Status', 'Stream']) {
    await consoleDialog.getByRole('checkbox', { name: label, exact: true }).uncheck();
  }
  const table = consoleDialog.getByRole('region', {
    name: 'Super console transcript',
    exact: true,
  });
  await expect(table.getByText('ALARM:2', { exact: true })).toHaveCount(1);
  await expect(table.getByText('error:20', { exact: true })).toHaveCount(1);
  for (const entry of original) {
    const row = table.getByRole('row').filter({
      has: page.getByRole('cell', { name: entry.raw, exact: true }),
    });
    await expect(row.getByTitle(new Date(entry.at).toISOString(), { exact: true })).toBeVisible();
  }
  await page.screenshot({ path: info.outputPath('retained-incidents.png') });
  await consoleDialog.getByRole('button', { name: 'Close', exact: true }).click();

  await page.getByRole('menuitem', { name: 'Help', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Save Support Report...', exact: true }).click();
  await expect
    .poll(
      async () => (await kerfdesk.events()).filter((event) => event.kind === 'file-saved').length,
    )
    .toBeGreaterThan(0);
  const name = (await kerfdesk.events()).filter((event) => event.kind === 'file-saved').at(-1)?.[
    'name'
  ];
  const report = typeof name === 'string' ? (await kerfdesk.savedFiles())[name] : undefined;
  expect(report).toBeDefined();
  for (const entry of original) {
    expect(report).toContain(entry.raw);
    expect(report).toContain(new Date(entry.at).toISOString());
    if (entry.decoded !== undefined) expect(report).toContain(entry.decoded);
  }
  writeFileSync(info.outputPath('saved-support-report.txt'), report ?? '');
  writeFileSync(
    info.outputPath('retained-incidents.json'),
    JSON.stringify(await incidents(page), null, 2),
  );
  await page.getByRole('button', { name: 'Super console', exact: true }).click();
  await expect(consoleDialog).toBeVisible();
  const clearHistory = consoleDialog.getByRole('button', {
    name: 'Clear incident history',
    exact: true,
  });
  await expect(clearHistory).toBeVisible();
  await expect(clearHistory).toBeEnabled();
  await clearHistory.click();
  await expect.poll(async () => (await incidents(page)).length).toBe(0);
  await expect(table.getByText('ALARM:2', { exact: true })).toHaveCount(0);
  await consoleDialog.getByRole('button', { name: 'Close', exact: true }).click();
});

async function transcriptState(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/ui/state/laser-store.ts';
    const loaded = (await import(/* @vite-ignore */ path)) as {
      useLaserStore: {
        getState: () => {
          transcript: readonly SerialTranscriptEntry[];
          incidentHistory?: readonly SerialTranscriptEntry[];
        };
      };
    };
    const state = loaded.useLaserStore.getState();
    return { live: state.transcript, incidents: state.incidentHistory ?? [] };
  });
}
const incidents = async (page: Page) => (await transcriptState(page)).incidents;
const liveTranscript = async (page: Page) => (await transcriptState(page)).live;
