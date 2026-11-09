// Rolling audit v11 W2-P2-1 (ADR-585 Amendment 2): the phone shows the PC's
// paused-CNC Resume warning, and where the PC prefers Abort, Resume needs a
// slide in a sheet that shows the warning before anything is sent.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, isUuid, launch, noHorizontalOverflow, phonePage } from './remote-app-support.mjs';

const FLUIDNC_ADVISORY =
  'KerfDesk does not lift the bit on FluidNC, so unless parking is on in the FluidNC config it ' +
  "is still in the cut. Resume restarts the spindle and waits only the spindle's spinup_ms " +
  'from the FluidNC config, which is 0 unless set. Prefer ABORT JOB.';

let browser;
before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
});

async function until(check, label, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function pausedCnc(resumeAdvisory) {
  const state = fixture();
  state.errors = [];
  state.machine.mode = 'cnc';
  state.machine.controllerState = 'Door:0';
  state.machine.job = {
    active: true,
    state: 'paused',
    progressPercent: 30,
    elapsedSeconds: 40,
    remainingSeconds: 90,
    resumeAdvisory,
  };
  state.machine.availability.resume = { available: true };
  return state;
}

test('phone Resume of a paused FluidNC router job shows the warning and needs a slide', async () => {
  const state = pausedCnc({ message: FLUIDNC_ADVISORY, confirmation: '0a1b2c3d' });
  const { page, context } = await phonePage(browser, state, { width: 360 });
  try {
    await page.getByRole('button', { name: 'Machine' }).click();
    // The warning is on the paused card before anything is tapped, as on the PC.
    await page.getByText('Paused', { exact: true }).waitFor();
    await page.locator('.card .banner.warning').filter({ hasText: 'spinup_ms' }).waitFor();

    await page.getByRole('button', { name: 'Resume' }).click();
    const sheet = page.getByRole('dialog', { name: 'Resume this job?' });
    await sheet.waitFor();
    assert.match(await sheet.textContent(), /Resume restarts the spindle and waits only/);
    assert.match(await sheet.textContent(), /recommends ABORT/);
    assert.equal(
      state.commands.some((item) => item.name === 'resume_job'),
      false,
      'tapping Resume alone sends nothing',
    );
    assert.equal(await noHorizontalOverflow(page), true);

    const slider = page.getByRole('slider', { name: 'Slide to resume the paused job' });
    await slider.focus();
    await page.keyboard.press('Enter');
    await until(() => state.commands.some((item) => item.name === 'resume_job'), 'resume sent');
    const sent = state.commands.find((item) => item.name === 'resume_job');
    assert.ok(isUuid(sent.args.requestId));
    assert.equal(sent.args.confirmAdvisory, '0a1b2c3d');
    assert.equal(sent.args.expectedRevision, undefined);
    await sheet.waitFor({ state: 'detached' });
    assert.deepEqual(state.errors, []);
  } finally {
    await context.close();
  }
});

test('phone Resume where the PC only informs: the warning shows, one tap resumes', async () => {
  const state = pausedCnc({
    message:
      'The bit is lifted to safe height with the spindle off. Resume spins the spindle up there.',
  });
  const { page, context } = await phonePage(browser, state, { width: 360 });
  try {
    await page.getByRole('button', { name: 'Machine' }).click();
    await page.locator('.card .banner.warning').filter({ hasText: 'lifted to safe' }).waitFor();
    await page.getByRole('button', { name: 'Resume' }).click();
    await until(() => state.commands.some((item) => item.name === 'resume_job'), 'resume sent');
    const sent = state.commands.find((item) => item.name === 'resume_job');
    assert.equal('confirmAdvisory' in sent.args, false);
    assert.equal(await page.getByRole('dialog', { name: 'Resume this job?' }).count(), 0);
    assert.deepEqual(state.errors, []);
  } finally {
    await context.close();
  }
});

test('phone Resume of a paused laser job is unchanged: no warning, one tap', async () => {
  const state = fixture();
  state.errors = [];
  state.machine.job = { active: true, state: 'paused', progressPercent: 30 };
  state.machine.availability.resume = { available: true };
  const { page, context } = await phonePage(browser, state, { width: 360 });
  try {
    await page.getByRole('button', { name: 'Machine' }).click();
    await page.getByText('Paused', { exact: true }).waitFor();
    assert.equal(await page.locator('.card .banner.warning').count(), 0);
    await page.getByRole('button', { name: 'Resume' }).click();
    await until(() => state.commands.some((item) => item.name === 'resume_job'), 'resume sent');
    assert.equal(
      'confirmAdvisory' in state.commands.find((item) => item.name === 'resume_job').args,
      false,
    );
  } finally {
    await context.close();
  }
});
