import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { fixtureState, readResult, idle, openTask } from './phone-workspace-support.mjs';
import { count, lifecycle, loadLive, tick, visibility } from './live-ui-support.mjs';
import {
  enterMachine,
  machineFixture,
  machineIdle,
  motionCommands,
} from './machine-ui-support.mjs';

// Intended-contract regressions for F-03/F-04/F-05, using the shipped phone scripts.
let browser;
before(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
after(async () => browser?.close());

function auditedState(state = fixtureState()) {
  Object.assign(state, { saved: false, changedSettings: false });
  state.readHook = (name, args) => {
    const result = readResult(state, name, args);
    if (!result) return null;
    if (name === 'get_workspace') {
      result.dirty = !state.saved;
      if (state.changedSettings) result.operations[0].powerPercent = 63;
    }
    if (name === 'get_machine' && state.changedSettings)
      Object.assign(result.machine, { name: 'Updated machine profile', bedWidthMm: 510 });
    if (name === 'get_app_status' && state.changedSettings) {
      result.edition.mode = 'pro';
      result.updates = {
        available: true,
        version: 'next-version',
        highlights: ['Settings repair'],
      };
    }
    if (name === 'review_job') {
      result.warnings = [
        {
          code: 'source',
          message: state.sharing
            ? 'PRIVATE artwork: Birthday Alice'
            : 'Review this warning on the PC.',
        },
      ];
      if (state.changedSettings) result.frame.complete = true;
    }
    if (name === 'list_material_recipes' && state.changedSettings)
      Object.assign(result, {
        recipes: [{ id: 'new-recipe', name: 'Updated material recipe' }],
        total: 1,
      });
    return { result };
  };
  return state;
}

async function openDetails(page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const details = page.locator('section[data-panel="details"] > details > summary');
  if ((await details.locator('..').getAttribute('open')) === null) await details.click();
  await expect(page.locator('#details-list')).toContainText('Checked with the PC.');
}

function readWitness(state) {
  const read = state.readHook;
  const holds = new Map();
  let active = 0,
    maximum = 0;
  const observe = async (reader, name, args) => {
    const result = await reader(name, args);
    if (!result) return result;
    active++;
    maximum = Math.max(maximum, active);
    try {
      const held = holds.get(name);
      if (held) {
        holds.delete(name);
        held.admission.resolve();
        await held.response.promise;
      }
      return result;
    } finally {
      active--;
    }
  };
  state.readHook = (name, args) => observe(read, name, args);
  if (state.machineCommand) {
    const machine = state.machineCommand;
    state.machineCommand = (name, args) =>
      ['get_machine_status', 'get_control_operation'].includes(name)
        ? observe(machine, name, args)
        : machine(name, args);
  }
  return {
    hold(name) {
      const admission = Promise.withResolvers();
      const response = Promise.withResolvers();
      const timer = setTimeout(() => admission.reject(new Error('No held read: ' + name)), 10_000);
      const admitted = admission.promise.finally(() => clearTimeout(timer));
      holds.set(name, { admission, response });
      return { admitted, release: () => response.resolve() };
    },
    get maximum() {
      return maximum;
    },
    get active() {
      return active;
    },
  };
}

const noActions = (state) => {
  assert.equal(state.edits, 0);
  assert.equal(
    state.commands.filter((entry) =>
      ['frame_job', 'review_machine_job', 'start_job', 'abort_job', 'jog_machine'].includes(
        entry.name,
      ),
    ).length,
    0,
  );
};

test('collapsed Computer and job details skip preparation; opening and reopening read current facts', async () => {
  const state = auditedState();
  const witness = readWitness(state);
  const loaded = await loadLive(browser, 'phone', state);
  const p = loaded.surface;
  const summary = p.locator('section[data-panel="details"] > details > summary');
  try {
    await p.getByRole('button', { name: 'Settings', exact: true }).click();
    await tick(loaded, 20_001);
    for (const name of ['get_app_status', 'get_machine', 'review_job', 'list_material_recipes'])
      assert.equal(count(state, name), 0, 'Collapsed details must not read ' + name);
    await summary.click();
    await expect(p.locator('#details-list')).toContainText('Fixture profile');
    await summary.click();
    await expect(p.locator('#details-list')).toBeEmpty();
    const reviews = count(state, 'review_job');
    state.revision++;
    state.changedSettings = true;
    await tick(loaded, 20_001);
    assert.equal(count(state, 'review_job'), reviews);
    await summary.click();
    await expect(p.locator('#details-list')).toContainText('Updated machine profile');
    await expect(p.locator('#details-list')).toContainText('Frame completed');
    assert.equal(witness.maximum, 1);
    noActions(state);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

test('closing the detail disclosure retires a held private review, even if reopened before delivery', async () => {
  const state = auditedState();
  const read = state.readHook;
  state.readHook = (name, args) => {
    const answer = read(name, args);
    if (name === 'review_job' && state.changedSettings)
      answer.result.warnings = [{ code: 'current', message: 'Current review warning' }];
    return answer;
  };
  const witness = readWitness(state);
  const loaded = await loadLive(browser, 'phone', state);
  const p = loaded.surface;
  const summary = p.locator('section[data-panel="details"] > details > summary');
  let held;
  try {
    await openDetails(p);
    held = witness.hold('review_job');
    await tick(loaded, 10_001);
    await held.admitted;
    await watchPrivateDetails(p);
    await summary.click();
    await expect(p.locator('#details-list')).toBeEmpty();
    state.changedSettings = true;
    await summary.click();
    held.release();
    await expect.poll(() => witness.active).toBe(0);
    assert.deepEqual(await p.evaluate(() => globalThis.privateDetailPaints), []);
    await tick(loaded);
    await expect(p.locator('#details-list')).toContainText('Updated machine profile');
    await expect(p.locator('#details-list')).toContainText('Current review warning');
    assert.deepEqual(await p.evaluate(() => globalThis.privateDetailPaints), []);
    assert.equal(witness.maximum, 1);
    noActions(state);
    assert.deepEqual(loaded.errors, []);
  } finally {
    held?.release();
    await loaded.context.close();
  }
});

test('paused updates leave collapsed details idle; opening their disclosure explicitly refreshes current facts', async () => {
  const state = auditedState();
  const loaded = await loadLive(browser, 'phone', state);
  const p = loaded.surface;
  const summary = p.locator('section[data-panel="details"] > details > summary');
  try {
    await openDetails(p);
    await p.locator('#live-updates').uncheck();
    await summary.click();
    await expect(p.locator('#details-list')).toBeEmpty();
    const commands = state.commands.length;
    const previews = count(state, 'get_workspace_preview');
    state.changedSettings = true;
    await visibility(p, true);
    await visibility(p, false);
    await tick(loaded, 20_001);
    assert.equal(state.commands.length, commands);
    await summary.click();
    await expect(p.locator('#details-list')).toContainText('Updated machine profile');
    await expect(p.locator('#details-list')).toContainText('Automatic updates are paused.');
    assert.equal(count(state, 'get_workspace_preview'), previews);
    noActions(state);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

for (const action of ['frame_job', 'abort_job']) {
  test(`Machine reads wait for held details while explicit ${action} still dispatches immediately`, async () => {
    const state = auditedState(machineFixture(['read', 'edit', 'control']));
    if (action === 'frame_job') state.afterAction = () => (state.latestOperation = null);
    const witness = readWitness(state);
    const loaded = await loadLive(browser, 'phone', state);
    const p = loaded.surface;
    let held;
    try {
      await enterMachine(p);
      await openDetails(p);
      held = witness.hold('review_job');
      await tick(loaded, 10_001);
      await held.admitted;
      const statuses = count(state, 'get_machine_status');
      await p.getByRole('button', { name: 'Machine', exact: true }).click();
      await expect(p.locator('#machine-check')).toBeDisabled();
      assert.equal(count(state, 'get_machine_status'), statuses);
      assert.equal(witness.maximum, 1);
      await p.locator(action === 'frame_job' ? '#machine-frame' : '#machine-abort').click();
      await state.whenAdmitted(action);
      assert.deepEqual(
        motionCommands(state).map((entry) => entry.name),
        [action],
      );
      held.release();
      await machineIdle(p);
      if (action === 'frame_job') {
        await p.locator('#machine-check').click();
        await machineIdle(p);
        assert.ok(count(state, 'get_control_operation') > 0);
      } else assert.equal(Object.hasOwn(motionCommands(state)[0].args, 'expectedRevision'), false);
      assert.equal(witness.maximum, 1);
      assert.equal(state.edits, 0);
      assert.equal(state.motionWrites, 1);
      assert.deepEqual(loaded.errors, []);
    } finally {
      held?.release();
      await loaded.context.close();
    }
  });
}

for (const pause of ['hidden', 'pagehide']) {
  test(`queued Machine reads retire across ${pause} and resume through the same reader`, async () => {
    const state = auditedState(machineFixture(['read', 'edit', 'control']));
    const witness = readWitness(state);
    const loaded = await loadLive(browser, 'phone', state);
    const p = loaded.surface;
    let held;
    try {
      await enterMachine(p);
      await openDetails(p);
      held = witness.hold('review_job');
      await tick(loaded, 10_001);
      await held.admitted;
      const statuses = count(state, 'get_machine_status');
      await p.getByRole('button', { name: 'Machine', exact: true }).click();
      await expect(p.locator('#machine-check')).toBeDisabled();
      if (pause === 'hidden') await visibility(p, true);
      else await lifecycle(p, 'pagehide');
      held.release();
      await expect(p.locator('#machine-check')).toBeEnabled();
      await expect.poll(() => witness.active).toBe(0);
      assert.equal(count(state, 'get_machine_status'), statuses);
      const before = state.commands.length;
      await loaded.page.clock.runFor(20_001);
      assert.equal(state.commands.length, before);
      if (pause === 'hidden') await visibility(p, false);
      else await lifecycle(p, 'pageshow');
      await expect.poll(() => count(state, 'get_machine_status')).toBeGreaterThan(statuses);
      await machineIdle(p);
      assert.equal(witness.maximum, 1);
      noActions(state);
      assert.deepEqual(loaded.errors, []);
    } finally {
      held?.release();
      await loaded.context.close();
    }
  });
}

for (const changesRevision of [true, false]) {
  test(`visible Settings follows machine, edition, update, recipe and Frame facts${changesRevision ? ' after PC edits' : ' without a document revision change'}`, async () => {
    const state = auditedState();
    const loaded = await loadLive(browser, 'phone', state);
    const p = loaded.surface;
    try {
      await openDetails(p);
      await expect(p.locator('#details-list')).toContainText('Fixture profile');
      const before = count(state, 'get_machine');
      state.changedSettings = true;
      if (changesRevision) state.revision++;
      await tick(loaded, 10_001);
      await expect.poll(() => count(state, 'get_machine')).toBeGreaterThan(before);
      await expect(p.locator('#details-list')).toContainText('Updated machine profile');
      await expect(p.locator('#details-list')).toContainText('510 × 300');
      await expect(p.locator('#details-list')).toContainText('pro');
      await expect(p.locator('#details-list')).toContainText('next-version');
      await expect(p.locator('#details-list')).toContainText('Updated material recipe');
      await expect(p.locator('#details-list')).toContainText('Frame completed');
      if (changesRevision)
        await expect(p.locator('#operation-form [name=powerPercent]')).toHaveValue('63');
      assert.match(await p.locator('#live-status').textContent(), /^Live/);
      noActions(state);
      assert.deepEqual(loaded.errors, []);
    } finally {
      await loaded.context.close();
    }
  });
}

test('sharing opt-out immediately clears cached private details while their redacted replacement is still held', async () => {
  const state = auditedState();
  const witness = readWitness(state);
  const loaded = await loadLive(browser, 'phone', state);
  const p = loaded.surface;
  try {
    await openDetails(p);
    await expect(p.locator('#details-list')).toContainText('PRIVATE artwork: Birthday Alice');
    state.sharing = false;
    const held = witness.hold('review_job');
    await tick(loaded, 10_001);
    await held.admitted;
    await expect(p.locator('#preview-message')).toContainText(/sharing is off/i);
    assert.equal(await p.locator('#workspace-preview').getAttribute('src'), null);
    await expect(p.locator('#details-list')).not.toContainText('Birthday Alice');
    held.release();
    await expect(p.locator('#details-list')).toContainText('Review this warning on the PC.');
    assert.equal(witness.maximum, 1);
    noActions(state);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

test('same-revision successful PC Save updates the badge without replacing drafts, focus, selection or preview', async () => {
  const state = auditedState();
  const loaded = await loadLive(browser, 'phone', state);
  const p = loaded.surface;
  try {
    await expect(p.locator('#workspace-meta')).toContainText('Unsaved changes');
    await p.locator('#artwork-list input[value="rectangle-1"]').check();
    await p.getByRole('button', { name: 'Edit', exact: true }).click();
    await openTask(p, 'operation-task');
    const power = p.locator('#operation-form [name=powerPercent]');
    const speed = p.locator('#operation-form [name=speedMmPerMin]');
    await power.fill('70');
    await speed.fill('-.');
    await speed.focus();
    await speed.evaluate((input) => {
      globalThis.savedInput = input;
      input.setSelectionRange(1, 2);
    });
    const before = count(state, 'get_workspace');
    const previews = count(state, 'get_workspace_preview');
    state.saved = true;
    await tick(loaded);
    await expect.poll(() => count(state, 'get_workspace')).toBeGreaterThan(before);
    await expect(p.locator('#workspace-meta')).not.toContainText('Unsaved changes');
    await expect(power).toHaveValue('70');
    await expect(speed).toHaveValue('-.');
    await expect(speed).toBeFocused();
    assert.deepEqual(
      await speed.evaluate((input) => [
        input === globalThis.savedInput,
        input.selectionStart,
        input.selectionEnd,
      ]),
      [true, 1, 2],
    );
    assert.equal(await p.locator('#artwork-list input[value="rectangle-1"]').isChecked(), true);
    assert.equal(await p.locator('#draft-note').isHidden(), true);
    assert.equal(count(state, 'get_workspace_preview'), previews);
    assert.equal(count(state, 'review_job'), 0);
    noActions(state);
    await speed.fill('2000');
    await p.getByRole('button', { name: 'Apply settings', exact: true }).click();
    await idle(p);
    const write = state.commands.find((entry) => entry.name === 'update_operation');
    assert.equal(write.args.expectedRevision, 'fixture-1');
    assert.equal(state.edits, 1);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

async function watchPrivateDetails(page) {
  await page.evaluate(() => {
    globalThis.privateDetailPaints = [];
    const target = globalThis.document.getElementById('details-list');
    new globalThis.MutationObserver(() => {
      if (target.textContent.includes('Birthday Alice'))
        globalThis.privateDetailPaints.push(target.textContent);
    }).observe(target, { childList: true, subtree: true, characterData: true });
  });
}

for (const change of ['sharing', 'revision']) {
  test(`held private review cannot publish old details across a ${change} change`, async () => {
    const state = auditedState();
    const witness = readWitness(state);
    const loaded = await loadLive(browser, 'phone', state);
    const p = loaded.surface;
    let held;
    try {
      await openDetails(p);
      held = witness.hold('review_job');
      await tick(loaded, 10_001);
      await held.admitted;
      await expect(p.locator('#details-list')).not.toContainText('Birthday Alice');
      await watchPrivateDetails(p);
      if (change === 'sharing') state.sharing = false;
      else {
        state.revision++;
        state.changedSettings = true;
      }
      held.release();
      await expect(p.locator('#details-list')).toContainText('PC workspace changed.');
      await expect(p.locator('#details-list')).not.toContainText('Fixture profile');
      assert.deepEqual(await p.evaluate(() => globalThis.privateDetailPaints), []);
      if (change === 'sharing') {
        assert.equal(await p.locator('#workspace-preview').getAttribute('src'), null);
        await tick(loaded, 10_001);
        await expect(p.locator('#details-list')).toContainText('Review this warning on the PC.');
        assert.deepEqual(await p.evaluate(() => globalThis.privateDetailPaints), []);
      } else {
        await tick(loaded, 10_001);
        await expect(p.locator('#details-list')).toContainText('Updated machine profile');
        await expect(p.locator('#details-list')).toContainText('Frame completed');
      }
      assert.equal(witness.maximum, 1);
      noActions(state);
      assert.deepEqual(loaded.errors, []);
    } finally {
      held?.release();
      await loaded.context.close();
    }
  });
}

for (const change of ['revoked', 'replacement']) {
  test(`held details cannot restore the previous ${change === 'revoked' ? 'revoked session' : 'client session'}`, async () => {
    const state = auditedState();
    const witness = readWitness(state);
    const loaded = await loadLive(browser, 'phone', state);
    const p = loaded.surface;
    let held;
    try {
      await openDetails(p);
      held = witness.hold('review_job');
      await tick(loaded, 10_001);
      await held.admitted;
      await watchPrivateDetails(p);
      if (change === 'revoked') state.revoked = true;
      else {
        state.clientId = 'replacement-client';
        state.sharing = false;
        state.changedSettings = true;
      }
      held.release();
      if (change === 'revoked') {
        await expect(p.locator('#connection')).toHaveText('Not connected');
        assert.equal(await p.locator('#workspace-area').isHidden(), true);
        assert.equal(await p.locator('#details-list').textContent(), '');
        assert.equal(await p.locator('#workspace-preview').getAttribute('src'), null);
      } else {
        await expect(p.locator('#details-list')).toContainText('Updated machine profile');
        await expect(p.locator('#details-list')).toContainText('Review this warning on the PC.');
      }
      assert.deepEqual(await p.evaluate(() => globalThis.privateDetailPaints), []);
      assert.equal(witness.maximum, 1);
      noActions(state);
      assert.deepEqual(loaded.errors, []);
    } finally {
      held?.release();
      await loaded.context.close();
    }
  });
}

for (const pause of ['hidden', 'pagehide']) {
  test(`held Settings reads retire across ${pause}, stop polling and refresh on return`, async () => {
    const state = auditedState();
    const witness = readWitness(state);
    const loaded = await loadLive(browser, 'phone', state);
    const p = loaded.surface;
    let held;
    try {
      await openDetails(p);
      held = witness.hold('review_job');
      await tick(loaded, 10_001);
      await held.admitted;
      await watchPrivateDetails(p);
      if (pause === 'hidden') await visibility(p, true);
      else await lifecycle(p, 'pagehide');
      state.sharing = false;
      state.changedSettings = true;
      held.release();
      await expect.poll(() => witness.active).toBe(0);
      const before = state.commands.length;
      await loaded.page.clock.runFor(20_001);
      assert.equal(state.commands.length, before);
      assert.deepEqual(await p.evaluate(() => globalThis.privateDetailPaints), []);
      if (pause === 'hidden') await visibility(p, false);
      else await lifecycle(p, 'pageshow');
      await expect(p.locator('#details-list')).toContainText('Updated machine profile');
      await expect(p.locator('#details-list')).toContainText('Review this warning on the PC.');
      assert.equal(witness.maximum, 1);
      assert.deepEqual(await p.evaluate(() => globalThis.privateDetailPaints), []);
      noActions(state);
      assert.deepEqual(loaded.errors, []);
    } finally {
      held?.release();
      await loaded.context.close();
    }
  });
}

test('Settings reads stay serialized and within the POST budget; hidden details skip preparation and reopen refreshes immediately', async () => {
  const state = auditedState();
  const witness = readWitness(state);
  const loaded = await loadLive(browser, 'phone', state);
  const p = loaded.surface;
  try {
    assert.equal(count(state, 'review_job'), 0, 'Initial Design does not prepare hidden details.');
    assert.equal(count(state, 'get_machine'), 0);
    await openDetails(p);
    const before = state.commands.length;
    for (let index = 0; index < 12; index++) {
      const reads = count(state, 'get_workspace');
      await tick(loaded);
      await expect.poll(() => count(state, 'get_workspace')).toBeGreaterThan(reads);
      await expect(p.locator('#details-list')).toContainText('Checked with the PC.');
    }
    const calls = state.commands.length - before;
    assert.ok(calls <= 48, `Visible Settings used ${calls} read-only POSTs in 60 seconds.`);
    assert.ok(count(state, 'get_machine') >= 5, 'Visible detail facts continue refreshing.');
    await p.getByRole('button', { name: 'Design', exact: true }).click();
    const reviews = count(state, 'review_job');
    const workspaceReads = count(state, 'get_workspace');
    state.revision++;
    await tick(loaded);
    await expect.poll(() => count(state, 'get_workspace')).toBeGreaterThan(workspaceReads);
    assert.equal(count(state, 'review_job'), reviews);
    await openDetails(p);
    await p.getByRole('button', { name: 'Design', exact: true }).click();
    state.changedSettings = true;
    await openDetails(p);
    await expect(p.locator('#details-list')).toContainText('Updated machine profile');
    assert.equal(witness.maximum, 1);
    noActions(state);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

test('mixed-revision detail responses are kept out of the visible cache until a consistent read', async () => {
  const state = auditedState();
  const read = state.readHook;
  let mismatch = true;
  state.readHook = (name, args) => {
    const answer = read(name, args);
    if (name === 'get_machine' && mismatch) answer.result.revision = 'previous-desktop-revision';
    return answer;
  };
  const loaded = await loadLive(browser, 'phone', state);
  const p = loaded.surface;
  try {
    await p.getByRole('button', { name: 'Settings', exact: true }).click();
    await p.locator('section[data-panel="details"] > details > summary').click();
    await expect(p.locator('#details-list')).toContainText('The PC changed during this read.');
    await expect(p.locator('#details-list')).not.toContainText('Birthday Alice');
    await expect(p.locator('#details-list')).not.toContainText('Fixture profile');
    mismatch = false;
    await tick(loaded, 10_001);
    await expect(p.locator('#details-list')).toContainText('Fixture profile');
    noActions(state);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

test('paused automatic updates stay stopped; opening Settings explicitly reads current facts without preparing a hidden image or rebasing drafts', async () => {
  const state = auditedState();
  const loaded = await loadLive(browser, 'phone', state);
  const p = loaded.surface;
  try {
    await p.getByRole('button', { name: 'Edit', exact: true }).click();
    await openTask(p, 'operation-task');
    const power = p.locator('#operation-form [name=powerPercent]');
    await power.fill('83');
    await openDetails(p);
    await p.locator('#live-updates').uncheck();
    await expect(p.locator('#details-list')).toContainText('Automatic updates paused.');
    const before = state.commands.length;
    const previews = count(state, 'get_workspace_preview');
    state.revision++;
    state.changedSettings = true;
    await visibility(p, true);
    await visibility(p, false);
    await expect(p.locator('#details-list')).toContainText('Automatic updates paused.');
    await tick(loaded, 20_001);
    assert.equal(state.commands.length, before, 'Pausing retires periodic detail preparation.');
    await p.getByRole('button', { name: 'Design', exact: true }).click();
    await openDetails(p);
    await idle(p);
    await expect(p.locator('#details-list')).toContainText('Updated machine profile');
    await expect(p.locator('#details-list')).toContainText('Frame completed');
    await expect(p.locator('#details-list')).toContainText('Automatic updates are paused.');
    await expect(power).toHaveValue('83');
    assert.equal(await p.locator('#draft-note').evaluate((note) => note.hidden), false);
    assert.equal(await p.locator('#operation-form button').isDisabled(), true);
    assert.equal(count(state, 'get_workspace_preview'), previews);
    await p.locator('#live-updates').check();
    await expect(p.locator('#details-list')).toContainText(
      'Live updates check about every 10 seconds',
    );
    noActions(state);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});
