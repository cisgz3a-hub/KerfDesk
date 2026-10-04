import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { fixtureState, idle, openTask, workspace } from './phone-workspace-support.mjs';
import { notification } from './workspace-ui-support.mjs';
import {
  completeFrame,
  release,
  enterMachine,
  machineFixture,
  machineIdle,
  motionCommands,
} from './machine-ui-support.mjs';
import { count, lifecycle, loadLive, readWitness, tick, visibility } from './live-ui-support.mjs';

let browser;
before(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
after(async () => {
  await browser?.close();
});

for (const kind of ['phone', 'app']) {
  test(`${kind} live sync: PC edits update automatically; unchanged revisions reuse the image and preserve an unapplied selection`, async () => {
    const state = fixtureState(),
      loaded = await loadLive(browser, kind, state);
    try {
      const p = loaded.surface;
      assert.equal(count(state, 'get_workspace_preview'), 1);
      await p.locator(loaded.items + ' input[value="rectangle-1"]').check();
      const first = count(state, 'get_workspace');
      await tick(loaded);
      await expect.poll(() => count(state, 'get_workspace')).toBeGreaterThan(first);
      assert.equal(count(state, 'get_workspace_preview'), 1);
      assert.equal(await p.locator(loaded.items + ' input[value="rectangle-1"]').isChecked(), true);
      await p.locator(loaded.items + ' input[value="rectangle-1"]').focus();
      state.revision++;
      state.history = { canUndo: false, canRedo: true };
      await tick(loaded);
      await p
        .locator('#redo')
        .filter({ hasNot: p.locator('[disabled]') })
        .waitFor();
      await expect.poll(() => count(state, 'get_workspace_preview')).toBe(2);
      await expect(p.locator(loaded.items + ' input[value="rectangle-1"]')).toBeFocused();
      assert.equal(await p.locator(loaded.items + ' input[value="rectangle-1"]').isChecked(), true);
      const apply = kind === 'phone' ? '#save-selection' : '#select';
      assert.equal(
        await p.locator(apply).isDisabled(),
        true,
        'Draft selection retains its original revision',
      );
      assert.equal(state.edits, 0);
      assert.deepEqual(loaded.errors, []);
    } finally {
      await loaded.context.close();
    }
  });

  test(`${kind} live sync: unchanged revision opt-out and revocation clear the preview without user refresh`, async () => {
    const state = fixtureState(),
      loaded = await loadLive(browser, kind, state);
    try {
      const p = loaded.surface;
      if (kind === 'phone') {
        await p.getByRole('button', { name: 'Edit selected text', exact: true }).click();
        await idle(p);
      }
      assert.equal((await p.locator(loaded.image).getAttribute('src')) !== null, true);
      state.sharing = false;
      await tick(loaded);
      await expect(p.locator('#preview-message')).toContainText(/sharing is off/i);
      assert.equal(await p.locator(loaded.image).getAttribute('src'), null);
      if (kind === 'phone') {
        assert.equal(await p.locator('#operation-list').textContent(), 'Operation');
        assert.equal(await p.locator('#text-edit-form [name=text]').inputValue(), '');
      }
      state.revoked = true;
      // Revocation hides the workspace and its live status; observe the visible disconnect notice.
      await loaded.page.clock.runFor(5001);
      await p
        .locator(kind === 'phone' ? '#connection' : '#summary')
        .filter({ hasText: kind === 'phone' ? 'Not connected' : 'Refresh' })
        .waitFor();
      assert.equal(await p.locator(loaded.image).getAttribute('src'), null);
      assert.equal(await p.locator(loaded.items + ' input').count(), 0);
      assert.equal(state.edits, 0);
      assert.deepEqual(loaded.errors, []);
    } finally {
      await loaded.context.close();
    }
  });

  test(`${kind} live sync: held workspace across hide/resume has one physical reader and retires the old snapshot`, async () => {
    const state = fixtureState(),
      witness = readWitness(state),
      loaded = await loadLive(browser, kind, state);
    try {
      const p = loaded.surface,
        held = witness.hold('get_workspace');
      await loaded.page.clock.runFor(5001);
      await held.admitted;
      const before = count(state, 'get_workspace');
      await lifecycle(p, 'pagehide');
      await lifecycle(p, 'pageshow');
      await loaded.page.clock.runFor(5001);
      assert.equal(
        count(state, 'get_workspace'),
        before,
        'Resume waits for the actual held pipeline',
      );
      assert.equal(witness.maximum, 1);
      assert.doesNotMatch(await p.locator('#live-status').textContent(), /^Live/);
      state.revision++;
      state.history = { canUndo: false, canRedo: true };
      held.release();
      await expect.poll(() => count(state, 'get_workspace_preview')).toBe(2);
      await p.locator('#live-status').filter({ hasText: 'Live' }).waitFor();
      assert.equal(await p.locator('#redo').isEnabled(), true);
      assert.equal(witness.maximum, 1);
      await lifecycle(p, 'pagehide');
      const stopped = state.commands.length;
      await loaded.page.clock.runFor(20001);
      assert.equal(state.commands.length, stopped, 'Pagehide does not reschedule from finally');
      assert.deepEqual(loaded.errors, []);
    } finally {
      await loaded.context.close();
    }
  });

  test(`${kind} live sync: held preview cannot resurrect same-revision artwork sharing after opt-out`, async () => {
    const state = fixtureState(),
      witness = readWitness(state),
      loaded = await loadLive(browser, kind, state);
    try {
      const p = loaded.surface,
        held = witness.hold('get_workspace_preview');
      state.revision++;
      await loaded.page.clock.runFor(5001);
      await held.admitted;
      state.sharing = false;
      if (kind === 'app') await notification(loaded.page, workspace(state));
      held.release();
      await expect(p.locator('#preview-message')).toContainText(/sharing is off/i);
      assert.equal(await p.locator(loaded.image).getAttribute('src'), null);
      await tick(loaded);
      assert.equal(await p.locator(loaded.image).getAttribute('src'), null);
      assert.equal(count(state, 'get_workspace_preview'), 2);
      assert.deepEqual(loaded.errors, []);
    } finally {
      await loaded.context.close();
    }
  });

  test(`${kind} live sync: hidden views pause reads and resume promptly; Settings never regenerates an unseen preview`, async () => {
    const state = fixtureState(),
      loaded = await loadLive(browser, kind, state);
    try {
      const p = loaded.surface;
      await visibility(p, true);
      const before = state.commands.length;
      await loaded.page.clock.runFor(15001);
      assert.equal(state.commands.length, before);
      state.revision++;
      await visibility(p, false);
      await expect.poll(() => count(state, 'get_workspace_preview')).toBe(2);
      await p.getByRole('button', { name: 'Settings', exact: true }).click();
      state.revision++;
      await tick(loaded);
      assert.equal(count(state, 'get_workspace_preview'), 2);
      await p.getByRole('button', { name: 'Design', exact: true }).click();
      await expect.poll(() => count(state, 'get_workspace_preview')).toBe(3);
      assert.equal(state.edits, 0);
      assert.deepEqual(loaded.errors, []);
    } finally {
      await loaded.context.close();
    }
  });

  test(`${kind} live sync: prolonged two uncertain receipts stay within the POST budget and an explicit Abort is independent`, async () => {
    const state = machineFixture();
    state.afterAction = (name, args, operation) => {
      if (name === 'frame_job' || name === 'abort_job') {
        operation.state = 'unknown';
        operation.committed = null;
        state.unknownReceipts.add(args.requestId);
      }
    };
    const loaded = await loadLive(browser, kind, state);
    try {
      const p = loaded.surface;
      await enterMachine(p);
      await p.locator('#machine-frame').click();
      await state.whenAdmitted('frame_job');
      await machineIdle(p);
      await p.locator('#machine-abort').click();
      await state.whenAdmitted('abort_job');
      await machineIdle(p);
      const start = state.commands.length,
        reads = count(state, 'get_workspace');
      for (let index = 0; index < 10; index++) {
        const status = count(state, 'get_machine_status');
        await loaded.page.clock.runFor(6001);
        await expect.poll(() => count(state, 'get_machine_status')).toBeGreaterThan(status);
        await machineIdle(p);
      }
      const calls = state.commands.slice(start);
      assert.ok(
        calls.length <= 30,
        `Automatic tools POSTs in 60 simulated seconds: ${calls.length}`,
      );
      assert.equal(count(state, 'get_workspace'), reads, 'Owned uncertainty pauses Design reads');
      assert.equal(motionCommands(state).length, 2, 'No automatic action replay');
      await p.locator('#machine-abort').click();
      await state.whenAdmitted('abort_job', 2);
      await machineIdle(p);
      assert.equal(motionCommands(state).length, 3);
      assert.equal(motionCommands(state).at(-1).name, 'abort_job');
      assert.equal(new Set(motionCommands(state).map((item) => item.args.requestId)).size, 3);
      assert.equal(await p.locator('#machine-frame').isDisabled(), true);
      assert.deepEqual(loaded.errors, []);
      console.log(
        `${kind} bounded polling: ${calls.length} read-only POSTs/60s; explicit Abort admitted; zero repeated motion.`,
      );
    } finally {
      await loaded.context.close();
    }
  });
}

test('phone live sync: focused text, font and partial numeric drafts survive a PC revision and require explicit discard', async () => {
  const state = fixtureState(),
    loaded = await loadLive(browser, 'phone', state);
  try {
    const p = loaded.surface,
      form = p.locator('#text-edit-form');
    await p.getByRole('button', { name: 'Edit selected text', exact: true }).click();
    await idle(p);
    await form.locator('[name=text]').fill('UNSENT phone text');
    await openTask(p, 'text-fonts');
    await form.locator('[name=fontId]').selectOption('serif');
    await form.locator('[name=fontSearch]').fill('script');
    await openTask(p, 'text-spacing');
    await form.locator('[name=lineHeight]').fill('-.');
    const spacing = form.locator('[name=letterSpacing]');
    await spacing.fill('-');
    await spacing.focus();
    state.revision++;
    state.text.text = 'New PC text';
    await tick(loaded);
    await p.locator('#draft-note').waitFor();
    for (const [name, value] of Object.entries({
      text: 'UNSENT phone text',
      fontId: 'serif',
      fontSearch: 'script',
      lineHeight: '-.',
      letterSpacing: '-',
    }))
      assert.equal(await form.locator(`[name=${name}]`).inputValue(), value);
    assert.equal(
      await spacing.evaluate((node) => node === globalThis.document.activeElement),
      true,
    );
    assert.equal(
      await p.getByRole('button', { name: 'Update text', exact: true }).isDisabled(),
      true,
    );
    assert.equal(state.edits, 0);
    await p.getByRole('button', { name: 'Discard drafts and refresh', exact: true }).click();
    await idle(p);
    await p.getByRole('button', { name: 'Design', exact: true }).click();
    await p.getByRole('button', { name: 'Edit selected text', exact: true }).click();
    await idle(p);
    assert.equal(await form.locator('[name=text]').inputValue(), 'New PC text');
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

test('phone privacy: a held loaded-text reply rechecks current sharing before exposing its contents', async () => {
  const state = fixtureState(),
    witness = readWitness(state),
    loaded = await loadLive(browser, 'phone', state);
  try {
    const held = witness.hold('get_text'),
      p = loaded.surface;
    await p.getByRole('button', { name: 'Edit selected text', exact: true }).click();
    await held.admitted;
    state.sharing = false;
    held.release();
    await idle(p);
    assert.equal(await p.locator('#text-edit-form [name=text]').inputValue(), '');
    assert.equal(await p.locator('#text-editor').isHidden(), true);
    assert.equal(await p.locator(loaded.image).getAttribute('src'), null);
    assert.match(await p.locator('#notice').textContent(), /sharing is off/);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

test('phone read serialization: an explicit text load waits behind a held preview without exposing opted-out text', async () => {
  const state = fixtureState(),
    witness = readWitness(state),
    loaded = await loadLive(browser, 'phone', state);
  try {
    const p = loaded.surface,
      held = witness.hold('get_workspace_preview');
    state.revision++;
    await loaded.page.clock.runFor(5001);
    await held.admitted;
    await p.getByRole('button', { name: 'Edit selected text', exact: true }).click();
    assert.equal(
      count(state, 'get_text'),
      0,
      'Explicit text reads share the workspace read coordinator',
    );
    assert.equal(witness.maximum, 1);
    state.sharing = false;
    held.release();
    await idle(p);
    assert.equal(await p.locator('#text-edit-form [name=text]').inputValue(), '');
    assert.equal(await p.locator(loaded.image).getAttribute('src'), null);
    assert.equal(witness.maximum, 1);
    assert.equal(state.edits, 0);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

for (const kind of ['phone', 'app'])
  test(`${kind} live sync: a held image survives hide/resume only as a retired read and a replaced connection starts fresh`, async () => {
    const state = fixtureState(),
      witness = readWitness(state),
      loaded = await loadLive(browser, kind, state);
    try {
      const p = loaded.surface,
        held = witness.hold('get_workspace_preview');
      state.revision++;
      await loaded.page.clock.runFor(5001);
      await held.admitted;
      const before = state.commands.length;
      await lifecycle(p, 'pagehide');
      await lifecycle(p, 'pageshow');
      await loaded.page.clock.runFor(5001);
      assert.equal(
        state.commands.length,
        before,
        'A held image keeps the serial pipeline occupied',
      );
      assert.equal(witness.maximum, 1);
      state.clientId = 'replacement-fixture';
      state.revision++;
      state.history = { canUndo: false, canRedo: true };
      held.release();
      await expect(p.locator('#redo')).toBeEnabled();
      await p.locator('#live-status').filter({ hasText: 'Live' }).waitFor();
      assert.equal(witness.maximum, 1);
      assert.equal(
        count(state, 'get_workspace_preview'),
        3,
        'One fresh image replaces the retired reply',
      );
      assert.equal(state.edits, 0);
      assert.deepEqual(loaded.errors, []);
    } finally {
      await loaded.context.close();
    }
  });

test('MCP App live teardown: an in-flight read cannot render, poll or call tools after the host closes the view', async () => {
  const state = fixtureState(),
    witness = readWitness(state),
    loaded = await loadLive(browser, 'app', state);
  try {
    const held = witness.hold('get_workspace');
    await loaded.page.clock.runFor(5001);
    await held.admitted;
    await loaded.page.evaluate(() =>
      globalThis.document
        .getElementById('widget')
        .contentWindow.postMessage(
          { jsonrpc: '2.0', id: 777, method: 'ui/resource-teardown', params: {} },
          '*',
        ),
    );
    await expect(loaded.surface.locator('#preview')).toHaveAttribute('hidden', '');
    const before = state.commands.length;
    held.release();
    await loaded.page.clock.runFor(20001);
    assert.equal(state.commands.length, before);
    assert.equal(await loaded.surface.locator('#preview').getAttribute('src'), null);
    assert.equal(await loaded.surface.locator('#items input').count(), 0);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

test('MCP App live sync: a display-only host receives notifications but never starts background tools', async () => {
  const state = fixtureState();
  state.displayOnly = true;
  const loaded = await loadLive(browser, 'app', state);
  try {
    await notification(loaded.page, workspace(state));
    await loaded.page.clock.runFor(20001);
    assert.equal(state.commands.length, 0);
    assert.equal(await loaded.surface.locator('#refresh').isDisabled(), true);
    assert.equal(await loaded.surface.locator('#select').isDisabled(), true);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

for (const kind of ['phone', 'app'])
  test(`${kind} live lifecycle: hiding with a held Frame preserves its identity and never unlocks motion from a late admission reply`, async () => {
    const state = machineFixture();
    state.hold.add('frame_job');
    state.afterAction = (name) => {
      if (name === 'frame_job') state.motion = 'idle';
    };
    const loaded = await loadLive(browser, kind, state);
    try {
      const p = loaded.surface;
      await enterMachine(p);
      await p.locator('#machine-frame').click();
      await state.whenHeld('frame_job');
      const identity = motionCommands(state)[0].args.requestId;
      await lifecycle(p, 'pagehide');
      await lifecycle(p, 'pageshow');
      await loaded.page.clock.runFor(2001);
      release(state, 'frame_job');
      await machineIdle(p);
      assert.equal(
        await p.locator('#machine-frame').isDisabled(),
        true,
        'Idle transport does not discard owned preparation',
      );
      assert.equal(motionCommands(state).length, 1);
      assert.equal(motionCommands(state)[0].args.requestId, identity);
      completeFrame(state);
      await loaded.page.clock.runFor(2001);
      await expect(p.locator('#machine-frame')).toBeEnabled();
      assert.equal(motionCommands(state).length, 1);
      assert.deepEqual(loaded.errors, []);
    } finally {
      await loaded.context.close();
    }
  });

for (const kind of ['phone', 'app'])
  test(`${kind} live sync: leaving Machine keeps only owned status reads until completion then resumes Design`, async () => {
    const state = machineFixture(),
      loaded = await loadLive(browser, kind, state);
    try {
      const p = loaded.surface;
      await enterMachine(p);
      await p.locator('#machine-frame').click();
      await state.whenAdmitted('frame_job');
      await machineIdle(p);
      await p.getByRole('button', { name: 'Design', exact: true }).click();
      const workspaceReads = count(state, 'get_workspace'),
        statusReads = count(state, 'get_machine_status');
      state.revision++;
      await loaded.page.clock.runFor(6001);
      await expect.poll(() => count(state, 'get_machine_status')).toBeGreaterThan(statusReads);
      await machineIdle(p);
      assert.equal(
        count(state, 'get_workspace'),
        workspaceReads,
        'Owned activity keeps Design reads waiting',
      );
      completeFrame(state);
      await loaded.page.clock.runFor(6001);
      await expect.poll(() => count(state, 'get_workspace_preview')).toBe(2);
      await p.locator('#live-status').filter({ hasText: 'Live' }).waitFor();
      const afterCompletion = count(state, 'get_machine_status');
      await loaded.page.clock.runFor(10001);
      assert.equal(
        count(state, 'get_machine_status'),
        afterCompletion,
        'No unowned Machine polling outside Machine',
      );
      assert.equal(motionCommands(state).length, 1);
      assert.deepEqual(loaded.errors, []);
    } finally {
      await loaded.context.close();
    }
  });
