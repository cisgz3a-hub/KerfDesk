import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { fixtureState } from './phone-workspace-support.mjs';
import { loadLive, tick } from './live-ui-support.mjs';
import { machineFixture, enterMachine, machineIdle } from './machine-ui-support.mjs';

let browser;
before(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
after(async () => {
  await browser?.close();
});

const writes = (state, name) => state.commands.filter((entry) => entry.name === name);
async function shape(loaded, kind) {
  await loaded.surface.getByRole('button', { name: 'Add shape', exact: true }).click();
  return loaded.surface.locator(kind === 'phone' ? '#rectangle-form' : '#add-rectangle-form');
}

for (const kind of ['phone', 'app']) {
  test(`${kind} decimal entry: blank and partial drafts survive refresh before a comma-decimal shape is applied`, async () => {
    const state = fixtureState(),
      loaded = await loadLive(browser, kind, state);
    try {
      const form = await shape(loaded, kind),
        width = form.locator('[name=widthMm]');
      await width.fill('');
      await tick(loaded);
      assert.equal(await width.inputValue(), '');
      await width.fill('-');
      await form.getByRole('button').click();
      assert.equal(writes(state, 'add_rectangle').length, 0);
      assert.equal(await width.inputValue(), '-');
      await width.fill('0,5');
      await form.locator('[name=heightMm]').fill('2,5');
      await form.locator('[name=xMm]').fill('-1,25');
      await form.locator('[name=yMm]').fill('+,75');
      await form.getByRole('button').click();
      await expect.poll(() => writes(state, 'add_rectangle').length).toBe(1);
      const args = writes(state, 'add_rectangle')[0].args;
      assert.equal(args.widthMm, 0.5);
      assert.equal(args.heightMm, 2.5);
      assert.equal(args.xMm, -1.25);
      assert.equal(args.yMm, 0.75);
      assert.equal(loaded.errors.length, 0);
    } finally {
      await loaded.context.close();
    }
  });

  test(`${kind} decimal entry: dot decimals stay accepted and comma input is never treated as grouping`, async () => {
    const state = fixtureState(),
      loaded = await loadLive(browser, kind, state);
    try {
      const form = await shape(loaded, kind);
      await form.locator('[name=widthMm]').fill('1,234');
      await form.locator('[name=heightMm]').fill('2.5');
      await form.getByRole('button').click();
      await expect.poll(() => writes(state, 'add_rectangle').length).toBe(1);
      assert.equal(writes(state, 'add_rectangle')[0].args.widthMm, 1.234);
      assert.equal(writes(state, 'add_rectangle')[0].args.heightMm, 2.5);
    } finally {
      await loaded.context.close();
    }
  });

  test(`${kind} decimal entry: malformed, grouped, nonfinite and out-of-range dimensions remain local`, async () => {
    const state = fixtureState(),
      loaded = await loadLive(browser, kind, state);
    try {
      const form = await shape(loaded, kind),
        width = form.locator('[name=widthMm]');
      for (const value of [
        '0,5.1',
        '0.5,1',
        '1,2,3',
        '1 000,5',
        '1e3',
        'Infinity',
        '0,0',
        '100001,1',
      ]) {
        await width.fill(value);
        await form.getByRole('button').click();
        assert.equal(writes(state, 'add_rectangle').length, 0, value);
        assert.equal(await width.inputValue(), value);
      }
      assert.equal(loaded.errors.length, 0);
    } finally {
      await loaded.context.close();
    }
  });

  test(`${kind} decimal entry: one explicit jog uses the decimal step and speed without rewriting the draft`, async () => {
    const state = machineFixture(),
      loaded = await loadLive(browser, kind, state);
    try {
      await enterMachine(loaded.surface);
      const form = loaded.surface.locator('#machine-jog-form');
      await form.locator('[name=distanceMm]').fill('0,5');
      await form.locator('[name=feedMmPerMin]').fill('600,5');
      await loaded.surface.getByRole('button', { name: 'Jog right', exact: true }).click();
      await state.whenAdmitted('jog_machine');
      await machineIdle(loaded.surface);
      const calls = writes(state, 'jog_machine');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].args.distanceMm, 0.5);
      assert.equal(calls[0].args.feedMmPerMin, 600.5);
      assert.equal(await form.locator('[name=distanceMm]').inputValue(), '0,5');
      assert.equal(await form.locator('[name=feedMmPerMin]').inputValue(), '600,5');
      assert.equal(loaded.errors.length, 0);
    } finally {
      await loaded.context.close();
    }
  });

  test(`${kind} decimal entry: incomplete, mixed separators and invalid jog ranges never dispatch motion`, async () => {
    const state = machineFixture(),
      loaded = await loadLive(browser, kind, state);
    try {
      await enterMachine(loaded.surface);
      const step = loaded.surface.locator('#machine-jog-form [name=distanceMm]');
      for (const value of ['', '-', ',', '0,001', '100,1', '1,2,3', '0.5,1', 'NaN']) {
        await step.fill(value);
        await loaded.surface.getByRole('button', { name: 'Jog right', exact: true }).click();
        assert.equal(writes(state, 'jog_machine').length, 0, value);
        assert.equal(await step.inputValue(), value);
      }
      assert.equal(loaded.errors.length, 0);
    } finally {
      await loaded.context.close();
    }
  });
}
