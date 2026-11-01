// Rolling audit v5 J7-P2-1 (ADR-584 Amendment 1): the phone's Undo shares the PC's history, so it
// can undo Keep current machine for an opened file. The PC's notice about that is on the PC only,
// and the receipt said nothing changed. The receipt now carries a notice, which the phone shows.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, launch, phonePage, writes } from './remote-app-support.mjs';

let browser;
before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
});

const MACHINE_NOTICE =
  "Undo brought back the opened file's machine, and the PC asks again which machine to use. " +
  "Until that is answered on the PC, Frame and Start use the file's machine.";

async function until(predicate, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function historyReply(state, fields = {}) {
  return () => {
    state.revision += 1;
    return {
      revision: `r${state.revision}`,
      changedArtworkIds: [],
      history: { canUndo: false, canRedo: true },
      ...fields,
    };
  };
}

test('phone Undo shows the machine change its receipt reports', async () => {
  const state = fixture({ errors: [] });
  state.replies = {
    undo: historyReply(state, { notices: [{ level: 'warning', message: MACHINE_NOTICE }] }),
  };
  const { page, context } = await phonePage(browser, state);
  try {
    const undo = page.getByRole('button', { name: 'Undo', exact: true });
    await undo.waitFor();
    await undo.click();
    const toast = page.locator('.toasts').getByText(MACHINE_NOTICE);
    await toast.waitFor();
    assert.equal(
      await toast.evaluate((node) => node.closest('.toast')?.className),
      'toast warning',
    );
    assert.equal(writes(state).filter((item) => item.name === 'undo').length, 1);
    assert.deepEqual(state.errors, []);
  } finally {
    await context.close();
  }
});

test('phone Undo of an artwork edit stays quiet', async () => {
  const state = fixture({ errors: [] });
  state.replies = { undo: historyReply(state) };
  const { page, context } = await phonePage(browser, state);
  try {
    const undo = page.getByRole('button', { name: 'Undo', exact: true });
    await undo.waitFor();
    await undo.click();
    // The receipt arrives, the view refreshes from it, and still no toast appears.
    await until(() => writes(state).some((item) => item.name === 'undo'));
    await until(() => state.commands.filter((item) => item.name === 'get_workspace').length > 1);
    await page.waitForTimeout(300);
    assert.equal(writes(state).filter((item) => item.name === 'undo').length, 1);
    assert.equal(await page.locator('.toasts .toast').count(), 0);
    assert.deepEqual(state.errors, []);
  } finally {
    await context.close();
  }
});
