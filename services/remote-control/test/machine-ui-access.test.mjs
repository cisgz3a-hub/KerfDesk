import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { phonePage } from './phone-workspace-support.mjs';
import { appPage, notification } from './workspace-ui-support.mjs';
import {
  checkMachine,
  enterMachine,
  machineFixture,
  machineIdle,
  machineStatus,
  motionCommands,
} from './machine-ui-support.mjs';

let browser;
before(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
after(async () => {
  await browser?.close();
});
const surfaces = {
  phone: async (state) => {
    const value = await phonePage(browser, state);
    return { ...value, surface: value.page };
  },
  app: async (state) => {
    const value = await appPage(browser, state);
    return { ...value, surface: value.frame };
  },
};

for (const [kind, load] of Object.entries(surfaces)) {
  test(`${kind} machine access: stale revision is never replayed and the next tap uses fresh machine revision`, async () => {
    const state = machineFixture(),
      loaded = await load(state);
    try {
      const p = loaded.surface;
      await enterMachine(p);
      state.revision++;
      await p.locator('#machine-frame').click();
      await machineIdle(p);
      assert.equal(state.motionWrites, 0);
      assert.equal(motionCommands(state).length, 1);
      assert.match(await p.locator('#machine-message').textContent(), /workspace changed/i);
      await p.locator('#machine-frame').click();
      await machineIdle(p);
      assert.equal(state.motionWrites, 1);
      assert.equal(motionCommands(state).length, 2);
      assert.equal(motionCommands(state)[1].args.expectedRevision, 'fixture-2');
      assert.deepEqual(loaded.errors, []);
    } finally {
      await loaded.context.close();
    }
  });

  test(`${kind} machine access: coordinate identity and controller disconnection are factual and fail closed`, async () => {
    const state = machineFixture();
    state.noPositionSpace = true;
    const loaded = await load(state);
    try {
      const p = loaded.surface;
      await enterMachine(p);
      assert.equal(
        await p.locator('#machine-position').textContent(),
        'Work position unavailable.',
      );
      state.controllerConnection = 'disconnected';
      await checkMachine(p);
      assert.match(await p.locator('#machine-state').textContent(), /Controller disconnected/);
      assert.equal(await p.locator('#machine-frame').isDisabled(), true);
      assert.equal(await p.locator('#machine-abort').isDisabled(), true);
      assert.match(
        await p.locator(kind === 'phone' ? '.machine-stop-bar' : '#machine-stop').textContent(),
        /Requires a PC connection/,
      );
      assert.equal(motionCommands(state).length, 0);
      assert.deepEqual(loaded.errors, []);
    } finally {
      await loaded.context.close();
    }
  });

  test(`${kind} machine access: keyboard jog and bounded speed preserve focus and literal numeric draft`, async () => {
    const state = machineFixture(),
      loaded = await load(state);
    try {
      const p = loaded.surface;
      await enterMachine(p);
      const step = p.locator('#machine-jog-form [name=distanceMm]');
      await step.fill('');
      await step.press('1');
      await step.press('.');
      await step.press('5');
      assert.equal(await step.inputValue(), '1.5');
      const jog = p.getByRole('button', { name: 'Jog up', exact: true });
      await jog.focus();
      await jog.press('Enter');
      await machineIdle(p);
      const sent = motionCommands(state)[0];
      assert.equal(sent.args.axis, 'y');
      assert.equal(sent.args.direction, 1);
      assert.equal(sent.args.distanceMm, 1.5);
      await p.locator('#machine-jog-form [name=feedMmPerMin]').fill('100001');
      await jog.focus();
      await jog.press('Enter');
      assert.equal(motionCommands(state).length, 1);
      assert.equal(await p.locator('#machine-jog-form [name=feedMmPerMin]').inputValue(), '100001');
      assert.deepEqual(loaded.errors, []);
    } finally {
      await loaded.context.close();
    }
  });

  test(`${kind} machine access: CNC review without a prompt never claims verified laser mode`, async () => {
    const state = machineFixture();
    state.framed = true;
    state.afterAction = (name, _args, operation) => {
      if (name !== 'review_machine_job') return;
      operation.review.mode = 'cnc';
      operation.review.acknowledgement = { kind: 'cnc' };
      operation.review.operations = [];
    };
    const loaded = await load(state);
    try {
      await enterMachine(loaded.surface);
      await loaded.surface.locator('#machine-review').click();
      await machineIdle(loaded.surface);
      assert.equal(
        await loaded.surface.locator('#machine-acknowledgement').textContent(),
        'Confirm this current review before Start.',
      );
      assert.equal(motionCommands(state).filter((item) => item.name === 'start_job').length, 0);
      assert.deepEqual(loaded.errors, []);
    } finally {
      await loaded.context.close();
    }
  });
}

test('MCP Machine: display-only host may show status but cannot gain control from a notification', async () => {
  const state = machineFixture();
  state.displayOnly = true;
  const loaded = await appPage(browser, state);
  try {
    await loaded.frame.getByRole('button', { name: 'Machine', exact: true }).click();
    await notification(loaded.page, machineStatus(state));
    await loaded.frame.locator('#machine-position').filter({ hasText: 'G54' }).waitFor();
    assert.equal(await loaded.frame.locator('#machine-check').isDisabled(), true);
    assert.equal(await loaded.frame.locator('#machine-frame').isDisabled(), true);
    assert.equal(await loaded.frame.locator('#machine-abort').isDisabled(), true);
    assert.equal(state.commands.length, 0);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

test('MCP Machine: revoked access clears private review, status and live controls', async () => {
  const state = machineFixture();
  state.framed = true;
  const loaded = await appPage(browser, state);
  try {
    await enterMachine(loaded.frame);
    await loaded.frame.locator('#machine-review').click();
    await machineIdle(loaded.frame);
    assert.equal(await loaded.frame.locator('#machine-review-card').isVisible(), true);
    state.revoked = true;
    await loaded.frame.locator('#machine-start').click();
    await loaded.frame.locator('#machine-state').filter({ hasText: 'unavailable' }).waitFor();
    assert.equal(await loaded.frame.locator('#machine-review-card').isHidden(), true);
    assert.equal(await loaded.frame.locator('#machine-frame').isDisabled(), true);
    assert.equal(await loaded.frame.locator('#machine-abort').isDisabled(), true);
    assert.equal(state.motionWrites, 1);
    assert.equal(state.running, false);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

test('MCP Machine: a received operation opens its review in a display-only host without granting controls', async () => {
  const state = machineFixture();
  state.displayOnly = true;
  state.framed = true;
  const result = await state.machineCommand('review_machine_job', {
    expectedRevision: 'fixture-1',
    requestId: 'f1f85c46-bf0d-4f4f-8d53-d2ae7e2d04c1',
  });
  const loaded = await appPage(browser, state);
  try {
    await notification(loaded.page, result.result);
    await loaded.frame.locator('#machine-review-card').waitFor();
    assert.equal(await loaded.frame.locator('#machine-tab').getAttribute('aria-pressed'), 'true');
    assert.match(
      await loaded.frame.locator('#machine-acknowledgement').textContent(),
      /unverified/,
    );
    assert.equal(await loaded.frame.locator('#machine-start').isDisabled(), true);
    assert.equal(state.commands.length, 0);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

test('MCP Machine: malformed machine notification retires existing control hints until a real status read', async () => {
  const state = machineFixture(),
    loaded = await appPage(browser, state);
  try {
    await enterMachine(loaded.frame);
    await loaded.page.clock.install();
    state.machineMalformed = true;
    await notification(loaded.page, {
      connection: 'connected',
      permissions: { canControl: true },
      revision: 'fixture-1',
    });
    await loaded.frame.waitForFunction(
      () => globalThis.document.getElementById('machine-frame').disabled === true,
    );
    assert.equal(motionCommands(state).length, 0);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});
