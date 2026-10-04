import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { chromium } from '@playwright/test';
import { appPage } from './workspace-ui-support.mjs';
import { idle } from './phone-workspace-support.mjs';
import { touchRead } from './touch-ui-support.mjs';
import {
  machineFixture,
  enterMachine,
  machineIdle,
  motionCommands,
} from './machine-ui-support.mjs';

let browser;
before(async () => {
  browser = await chromium.launch({
    ...(process.env.KERFDESK_TEST_BROWSER === 'chromium' ? {} : { channel: 'chrome' }),
    headless: true,
  });
});
after(async () => {
  await browser?.close();
});

/** Exact-source browser fixture only; no real app, provider or controller receives commands. */
function fixture() {
  const state = machineFixture(['read', 'edit', 'control']);
  Object.assign(state, {
    creation: true,
    viewport: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 100 },
    selected: ['rectangle-1'],
    artwork: [
      {
        id: 'rectangle-1',
        type: 'rectangle',
        visible: true,
        editable: true,
        bounds: { xMm: 20, yMm: 40, widthMm: 50, heightMm: 20 },
      },
    ],
  });
  state.readHook = (name, args) => {
    if (name === 'get_workspace' && state.failDesignRead) return state.failDesignRead();
    const result = touchRead(state, name, args);
    return result ? { result } : null;
  };
  return state;
}

function designFailure(state, failure) {
  const admission = Promise.withResolvers();
  const lateResponse = Promise.withResolvers();
  state.failDesignRead = () => {
    admission.resolve();
    if (failure === 'timeout') return lateResponse.promise;
    return failure === 'unavailable'
      ? { error: { code: 'unavailable' } }
      : { result: { revision: 'fixture-' + state.revision } };
  };
  return {
    async admitted() {
      let timer;
      try {
        await Promise.race([
          admission.promise,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Design read was not admitted.')), 10_000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
    lateResponse,
  };
}

for (const receiptState of ['preparing', 'uncertain']) {
  for (const failure of ['malformed', 'unavailable', 'timeout']) {
    test(
      'portable Design ' + failure + ' retains ' + receiptState + ' Frame and Abort',
      async () => {
        const state = fixture();
        if (receiptState === 'uncertain') {
          state.drop.add('frame_job');
          state.afterAction = (name, args) => {
            if (name !== 'frame_job') return;
            state.unknownReceipts.add(args.requestId);
            state.latestOperation = null;
            state.motion = 'idle';
          };
        }
        const loaded = await appPage(browser, state, 390, { clock: true });
        try {
          const surface = loaded.frame;
          assert.equal(await surface.locator('#preview').isVisible(), true);
          assert.equal(await surface.locator('[data-touch-tool=rectangle]').isEnabled(), true);
          assert.equal(await surface.locator('#undo').isEnabled(), true);

          await enterMachine(surface);
          await surface.locator('#machine-frame').click();
          await state.whenAdmitted('frame_job');
          if (receiptState === 'uncertain') await loaded.page.clock.fastForward(30_001);
          await machineIdle(surface);
          const originalRequestId = motionCommands(state)[0].args.requestId;
          assert.equal(state.controlReceipts.get(originalRequestId).state, 'preparing');
          // A status without latestOperation cannot incidentally restore a forgotten attempt.
          state.latestOperation = null;
          const beforeFailure = state.commands.length;

          await surface.getByRole('button', { name: 'Design', exact: true }).click();
          const failedRead = designFailure(state, failure);
          await surface.locator('#refresh').click();
          await failedRead.admitted();
          if (failure === 'timeout') await loaded.page.clock.fastForward(30_001);
          await idle(surface);
          assert.equal(await surface.locator('#preview').isHidden(), true);
          assert.equal(await surface.locator('#preview').getAttribute('src'), null);
          assert.equal(await surface.locator('#items input').count(), 0);
          assert.equal(await surface.locator('#undo').isDisabled(), true);
          assert.equal(await surface.locator('[data-touch-tool=rectangle]').isDisabled(), true);
          assert.equal(state.edits, 0);
          assert.equal(motionCommands(state).length, 1);

          if (failure === 'timeout') {
            const request = loaded.rpc.findLast((entry) => entry.params?.name === 'get_workspace');
            // Witness the late reply's delivery rather than waiting an arbitrary delay.
            await surface.evaluate((id) => {
              globalThis.lateDesignReplySeen = false;
              const listener = (event) => {
                if (event.data?.id !== id) return;
                globalThis.removeEventListener('message', listener);
                globalThis.lateDesignReplySeen = true;
              };
              globalThis.addEventListener('message', listener);
            }, request.id);
            failedRead.lateResponse.resolve({ result: touchRead(state, 'get_workspace', {}) });
            await surface.waitForFunction(() => globalThis.lateDesignReplySeen === true);
            assert.equal(await surface.locator('#preview').isHidden(), true);
            assert.equal(await surface.locator('#items input').count(), 0);
            assert.equal(await surface.locator('#undo').isDisabled(), true);
          }

          await enterMachine(surface);
          await machineIdle(surface);
          const receiptReads = state.commands
            .slice(beforeFailure)
            .filter((entry) => entry.name === 'get_control_operation');
          assert.ok(receiptReads.length > 0, 'Check status still looks up the owned request.');
          assert.ok(receiptReads.every((entry) => entry.args.operationId === originalRequestId));
          assert.match(
            await surface.locator('#machine-state').textContent(),
            receiptState === 'uncertain' ? /not confirmed/ : /Preparing Frame/,
          );
          assert.equal(await surface.locator('#machine-frame').isDisabled(), true);
          assert.equal(await surface.locator('#machine-start').isDisabled(), true);
          assert.equal(await surface.locator('#machine-abort').isEnabled(), true);
          assert.equal(motionCommands(state).length, 1, 'A design failure cannot resend motion.');

          await surface.locator('#machine-abort').click();
          await state.whenAdmitted('abort_job');
          await machineIdle(surface);
          const actions = motionCommands(state);
          assert.deepEqual(
            actions.map((entry) => entry.name),
            ['frame_job', 'abort_job'],
          );
          assert.equal(actions[0].args.requestId, originalRequestId);
          assert.notEqual(actions[1].args.requestId, originalRequestId);
          assert.equal(Object.hasOwn(actions[1].args, 'expectedRevision'), false);
          assert.equal(state.motionWrites, 2);
          assert.deepEqual(loaded.errors, []);
        } finally {
          await loaded.context.close();
        }
      },
    );
  }
}
