import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { capture, idle, openTask, phonePage } from './phone-workspace-support.mjs';
import { appPage } from './workspace-ui-support.mjs';
import {
  checkMachine,
  completeFrame,
  enterMachine,
  machineFixture,
  machineIdle,
  motionCommands,
  NEXT_REVIEW_ID,
  noOverflow,
  release,
  REVIEW_ID,
} from './machine-ui-support.mjs';

let browser;
before(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
after(async () => {
  await browser?.close();
});

const surfaces = {
  phone: async (state, width) => {
    const loaded = await phonePage(browser, state, width);
    return { ...loaded, surface: loaded.page };
  },
  app: async (state, width) => {
    const loaded = await appPage(browser, state, width);
    return { ...loaded, surface: loaded.frame };
  },
};

for (const [kind, load] of Object.entries(surfaces)) {
  test(`${kind} machine: control without edit, exact Frame/review/Start, fresh review requires another explicit Start`, async () => {
    const state = machineFixture();
    const loaded = await load(state);
    try {
      const p = loaded.surface;
      await enterMachine(p);
      assert.match(await p.locator('#machine-access').textContent(), /approved/);
      assert.match(await p.locator('#machine-position').textContent(), /Work position \(G54\)/);
      assert.equal(await p.locator('#machine-z').isHidden(), true);
      assert.equal(await p.locator('#machine-review').isDisabled(), true);
      await p.locator('#machine-frame').click();
      await machineIdle(p);
      assert.match(await p.locator('#machine-state').textContent(), /Preparing Frame/);
      assert.equal(await p.locator('#machine-review').isDisabled(), true);
      completeFrame(state);
      await checkMachine(p);
      await p.locator('#machine-review').click();
      await machineIdle(p);
      assert.equal(await p.locator('#machine-review-card').isVisible(), true);
      assert.match(await p.locator('#machine-acknowledgement').textContent(), /unverified/);
      assert.equal(await p.locator('#machine-review-card img').count(), 0);
      assert.equal(
        motionCommands(state).some((item) => item.name === 'start_job'),
        false,
      );
      state.nextReview = true;
      await p.locator('#machine-start').click();
      await machineIdle(p);
      let starts = motionCommands(state).filter((item) => item.name === 'start_job');
      assert.equal(starts.length, 1);
      assert.equal(starts[0].args.reviewId, REVIEW_ID);
      assert.equal(state.running, false);
      await p.locator('#machine-start').click();
      await machineIdle(p);
      starts = motionCommands(state).filter((item) => item.name === 'start_job');
      assert.equal(starts.length, 2);
      assert.equal(starts[1].args.reviewId, NEXT_REVIEW_ID);
      assert.match(await p.locator('#machine-state').textContent(), /Running.*42%/);
      await p.locator('#machine-abort').click();
      await machineIdle(p);
      const abort = motionCommands(state).at(-1);
      assert.equal(abort.name, 'abort_job');
      assert.equal('expectedRevision' in abort.args, false);
      assert.deepEqual(loaded.errors, []);
    } finally {
      await loaded.context.close();
    }
  });

  test(`${kind} machine: partial and blank jog drafts survive status reads and validate only on a tap`, async () => {
    const state = machineFixture();
    state.zSupported = true;
    const loaded = await load(state);
    try {
      const p = loaded.surface;
      await enterMachine(p);
      const step = p.locator('#machine-jog-form [name=distanceMm]');
      const feed = p.locator('#machine-jog-form [name=feedMmPerMin]');
      assert.equal(await p.locator('#machine-z').isVisible(), true);
      for (const draft of ['', '-', '-.', '.']) {
        await step.fill(draft);
        await feed.fill('-');
        await checkMachine(p);
        assert.equal(await step.inputValue(), draft);
        assert.equal(await feed.inputValue(), '-');
        await p.getByRole('button', { name: 'Jog right', exact: true }).click();
        assert.equal(motionCommands(state).length, 0);
      }
      await step.fill('.25');
      await feed.fill('');
      await p.getByRole('button', { name: 'Jog left', exact: true }).click();
      await machineIdle(p);
      const jog = motionCommands(state)[0];
      assert.deepEqual(
        { axis: jog.args.axis, direction: jog.args.direction, distanceMm: jog.args.distanceMm },
        { axis: 'x', direction: -1, distanceMm: 0.25 },
      );
      assert.equal('feedMmPerMin' in jog.args, false);
      await feed.fill('3000');
      await p
        .locator('#machine-z [data-direction="1"], #machine-z [data-jog-direction="1"]')
        .click();
      await machineIdle(p);
      assert.equal(motionCommands(state).at(-1).args.axis, 'z');
      assert.equal(motionCommands(state).at(-1).args.feedMmPerMin, 3000);
      assert.deepEqual(loaded.errors, []);
    } finally {
      await loaded.context.close();
    }
  });

  for (const reason of ['edit only', 'old desktop', 'missing readiness', 'malformed']) {
    test(`${kind} machine: ${reason} never grants motion`, async () => {
      const state = machineFixture(reason === 'edit only' ? ['read', 'edit'] : ['read', 'control']);
      if (reason === 'old desktop') state.legacyMachine = true;
      if (reason === 'missing readiness') state.noAvailability = true;
      if (reason === 'malformed') state.machineMalformed = true;
      const loaded = await load(state);
      try {
        const p = loaded.surface;
        await p.getByRole('button', { name: 'Machine', exact: true }).click();
        await p.waitForFunction(
          () => globalThis.document.getElementById('machine-check').disabled === false,
        );
        assert.equal(
          await p.getByRole('button', { name: 'Jog right', exact: true }).isDisabled(),
          true,
        );
        assert.equal(await p.locator('#machine-frame').isDisabled(), true);
        assert.equal(await p.locator('#machine-abort').isDisabled(), true);
        assert.equal(motionCommands(state).length, 0);
        assert.deepEqual(loaded.errors, []);
      } finally {
        await loaded.context.close();
      }
    });
  }

  test(`${kind} machine: uncertain admission checks the original receipt and never resends motion`, async () => {
    const state = machineFixture();
    state.drop.add('frame_job');
    state.afterAction = (name, args) => {
      if (name === 'frame_job') {
        state.unknownReceipts.add(args.requestId);
        state.latestOperation = null;
        state.motion = 'idle';
      }
    };
    const loaded = await load(state);
    try {
      const p = loaded.surface;
      await loaded.page.clock.install();
      await enterMachine(p);
      await p.locator('#machine-frame').click();
      if (kind === 'app') await loaded.page.clock.fastForward(30001);
      await machineIdle(p);
      assert.match(await p.locator('#machine-state').textContent(), /not confirmed/);
      const original = motionCommands(state)[0].args.requestId;
      assert.equal(await p.locator('#machine-frame').isDisabled(), true);
      assert.equal(await p.locator('#machine-abort').isDisabled(), false);
      await checkMachine(p);
      assert.equal(motionCommands(state).length, 1);
      assert.ok(
        state.commands.some(
          (item) => item.name === 'get_control_operation' && item.args.operationId === original,
        ),
      );
      state.unknownReceipts.delete(original);
      state.controlReceipts.get(original).state = 'completed';
      await checkMachine(p);
      assert.equal(await p.locator('#machine-frame').isDisabled(), false);
      assert.equal(motionCommands(state).length, 1);
      assert.deepEqual(loaded.errors, []);
    } finally {
      await loaded.context.close();
    }
  });

  test(`${kind} machine: failed Abort keeps a held motion identity and late result blocked until authoritative completion`, async () => {
    const state = machineFixture();
    state.hold.add('frame_job');
    state.hold.add('abort_job');
    state.drop.add('abort_job');
    state.afterAction = (name, args) => {
      if (name === 'abort_job') {
        state.unknownReceipts.add(args.requestId);
        state.latestOperation = null;
        state.motion = 'idle';
      }
    };
    const loaded = await load(state);
    try {
      const p = loaded.surface;
      await loaded.page.clock.install();
      await enterMachine(p);
      await p.locator('#machine-frame').click();
      await p.waitForFunction(
        () =>
          globalThis.document.getElementById('machine-panel').getAttribute('aria-busy') === 'true',
      );
      assert.equal(await p.locator('#machine-abort').isDisabled(), false);
      await p.locator('#machine-abort').click();
      await p.waitForFunction(
        () => globalThis.document.getElementById('machine-abort').disabled === true,
      );
      release(state, 'abort_job');
      if (kind === 'app') await loaded.page.clock.fastForward(30001);
      release(state, 'frame_job');
      await machineIdle(p);
      const calls = motionCommands(state),
        frameId = calls[0].args.requestId,
        abortId = calls[1].args.requestId;
      assert.equal(calls.length, 2);
      assert.equal(calls[1].name, 'abort_job');
      assert.equal('expectedRevision' in calls[1].args, false);
      assert.equal(await p.locator('#machine-frame').isDisabled(), true);
      await checkMachine(p);
      const lookedUp = state.commands
        .filter((entry) => entry.name === 'get_control_operation')
        .map((entry) => entry.args.operationId);
      assert.ok(lookedUp.includes(frameId));
      assert.ok(lookedUp.includes(abortId));
      state.unknownReceipts.delete(abortId);
      state.controlReceipts.get(abortId).state = 'failed';
      await checkMachine(p);
      assert.equal(await p.locator('#machine-frame').isDisabled(), true);
      state.controlReceipts.get(frameId).state = 'completed';
      await checkMachine(p);
      assert.equal(await p.locator('#machine-frame').isDisabled(), false);
      assert.equal(motionCommands(state).length, 2);
      assert.deepEqual(loaded.errors, []);
    } finally {
      await loaded.context.close();
    }
  });

  for (const width of [320, 390]) {
    test(`${kind} machine layout: ${width}px, comfortable targets, literal review and real artwork preview fixture`, async () => {
      const state = machineFixture();
      state.framed = true;
      if (process.env.KERFDESK_MCP_PREVIEW_IMAGE) {
        const bytes = await readFile(process.env.KERFDESK_MCP_PREVIEW_IMAGE);
        state.preview = {
          mimeType: 'image/png',
          data: bytes.toString('base64'),
          widthPx: bytes.readUInt32BE(16),
          heightPx: bytes.readUInt32BE(20),
        };
      }
      const loaded = await load(state, width);
      try {
        const p = loaded.surface;
        assert.equal(await noOverflow(p), true);
        const image = p.locator(kind === 'phone' ? '#workspace-preview' : '#preview');
        assert.equal(
          await image.evaluate((item) => item.naturalWidth),
          state.preview?.widthPx ?? 1,
        );
        await capture(loaded.page, `${kind}-artwork-${width}-synthetic-host`);
        await enterMachine(p);
        for (const selector of [
          '#machine-check',
          '#machine-frame',
          '#machine-abort',
          '.jog-pad button',
        ]) {
          const box = await p.locator(selector).first().boundingBox();
          assert.ok(box.height >= 48 && box.width >= 44);
        }
        await capture(loaded.page, `${kind}-machine-${width}-synthetic-host`);
        const pad = await p.locator('.jog-pad').boundingBox();
        const stop = await p
          .locator(kind === 'phone' ? '.machine-stop-bar' : '#machine-stop')
          .boundingBox();
        assert.ok(
          pad.y + pad.height <= stop.y,
          'All XY jog buttons are visible above Abort at the initial phone scroll position',
        );
        await p.locator('#machine-review').click();
        await machineIdle(p);
        await p.locator('#machine-start').scrollIntoViewIfNeeded();
        assert.equal(await noOverflow(p), true);
        assert.equal(await p.locator('#machine-review-card img').count(), 0);
        await capture(loaded.page, `${kind}-review-${width}-synthetic-host`);
        assert.deepEqual(loaded.errors, []);
      } finally {
        await loaded.context.close();
      }
    });
  }
}

test('phone machine: polling and panel switches preserve unsent text, font and partial numeric drafts', async () => {
  const state = machineFixture(['read', 'edit', 'control']);
  const loaded = await phonePage(browser, state);
  try {
    const p = loaded.page,
      form = p.locator('#text-edit-form');
    await p.getByRole('button', { name: 'Edit selected text', exact: true }).click();
    await idle(p);
    await form.locator('[name=text]').fill('UNSENT TEXT');
    await openTask(p, 'text-fonts');
    await form.locator('[name=fontId]').selectOption('serif');
    await form.locator('[name=fontSearch]').fill('script');
    await form.locator('[name=fontSizeMm]').fill('');
    await openTask(p, 'text-spacing');
    await form.locator('[name=lineHeight]').fill('-.');
    await enterMachine(p);
    await checkMachine(p);
    await checkMachine(p);
    await loaded.page.clock.install();
    await loaded.page.clock.fastForward(6001);
    await p.getByRole('button', { name: 'Artwork', exact: true }).click();
    await p.getByRole('button', { name: 'Edit selected text', exact: true }).click();
    await idle(p);
    for (const [name, value] of Object.entries({
      text: 'UNSENT TEXT',
      fontId: 'serif',
      fontSearch: 'script',
      fontSizeMm: '',
      lineHeight: '-.',
    }))
      assert.equal(await form.locator(`[name=${name}]`).inputValue(), value);
    assert.equal(state.commands.filter((item) => item.name === 'get_text').length, 1);
    assert.equal(state.commands.filter((item) => item.name === 'get_workspace').length, 1);
    assert.equal(state.edits, 0);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

test('phone machine: separate control request defaults unchecked and revoked/replaced client cannot dispatch', async () => {
  const state = machineFixture();
  const loaded = await phonePage(browser, state);
  try {
    const p = loaded.page;
    assert.equal(await p.locator('#pair-form [name=control]').isChecked(), false);
    await enterMachine(p);
    state.clientId = 'replacement-client';
    await p.locator('#machine-frame').click();
    await p
      .locator('#machine-message')
      .filter({ hasText: /connection changed/ })
      .waitFor();
    assert.equal(motionCommands(state).length, 0);
    await checkMachine(p);
    state.revoked = true;
    await p.getByRole('button', { name: 'Jog right', exact: true }).click();
    await p.locator('#pair-card').waitFor();
    assert.equal(motionCommands(state).length, 0);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});
