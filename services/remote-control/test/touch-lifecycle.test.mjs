import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { chromium } from '@playwright/test';
import { idle } from './phone-workspace-support.mjs';
import { lifecycle, visibility, assertNoOverflow } from './live-ui-support.mjs';
import {
  touchFixture,
  touchRead,
  loadTouch,
  choose,
  drag,
  applyDraft,
  writes,
  visibleCanvas,
  scenePoint,
  notifyTouch,
  writeAdmission,
} from './touch-ui-support.mjs';

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

for (const kind of ['phone', 'app']) {
  test(kind + ' readonly, legacy, missing or malformed mapping refuse touch edits', async () => {
    for (const patch of [
      { scopes: ['read', 'control'] },
      { legacy: true },
      { noViewport: true },
      { viewport: { xMm: 0, yMm: 0, widthMm: Infinity, heightMm: 400 } },
    ]) {
      const state = Object.assign(touchFixture(), patch);
      const loaded = await loadTouch(browser, kind, state);
      try {
        for (const tool of ['select', 'move', 'resize', 'brush', 'rectangle', 'ellipse'])
          assert.equal(
            await loaded.surface.locator('[data-touch-tool=' + tool + ']').isDisabled(),
            true,
            tool + JSON.stringify(patch),
          );
        assert.equal(await loaded.surface.locator('[data-touch-tool=pan]').isEnabled(), true);
        assert.equal(await loaded.surface.locator(loaded.image).isVisible(), true);
        assert.match(
          await loaded.surface.locator('.touch-hint').innerText(),
          /approval|Update|coordinates/,
        );
        assert.equal(writes(state).length, 0);
        assert.deepEqual(loaded.errors, []);
      } finally {
        await loaded.context.close();
      }
    }
  });
  test(kind + ' CNC disables creation and keeps supported bounds editing', async () => {
    const state = Object.assign(touchFixture(), { mode: 'cnc', creation: false });
    const loaded = await loadTouch(browser, kind, state);
    try {
      for (const tool of ['brush', 'rectangle', 'ellipse'])
        assert.equal(
          await loaded.surface.locator('[data-touch-tool=' + tool + ']').isDisabled(),
          true,
        );
      await choose(loaded, 'move');
      await drag(loaded, [10, 50], [15, 55]);
      await applyDraft(loaded);
      assert.equal(writes(state)[0].name, 'transform_artwork');
      assert.match(await loaded.surface.locator('.touch-hint').innerText(), /Laser workspace/);
      assert.deepEqual(loaded.errors, []);
    } finally {
      await loaded.context.close();
    }
  });
  test(kind + ' hidden page, pagehide and navigation cancel unapplied drafts', async () => {
    const loaded = await loadTouch(browser, kind);
    try {
      await choose(loaded, 'rectangle');
      await drag(loaded, [10, 10], [60, 70]);
      await visibility(loaded.surface, true);
      assert.equal(await loaded.surface.locator('.touch-confirm').isHidden(), true);
      await visibility(loaded.surface, false);
      await drag(loaded, [10, 10], [60, 70]);
      await lifecycle(loaded.surface, 'pagehide');
      assert.equal(await loaded.surface.locator('.touch-confirm').isHidden(), true);
      await lifecycle(loaded.surface, 'pageshow');
      await drag(loaded, [10, 10], [60, 70]);
      await loaded.surface.getByRole('button', { name: 'Settings', exact: true }).click();
      assert.equal(await loaded.surface.locator('.touch-confirm').isHidden(), true);
      assert.equal(writes(loaded.state).length, 0);
      assert.deepEqual(loaded.errors, []);
    } finally {
      await loaded.context.close();
    }
  });
  test(
    kind + ' second finger and pointer cancellation never leave an applicable stroke',
    async () => {
      const loaded = await loadTouch(browser, kind);
      const cdp = await loaded.context.newCDPSession(loaded.page);
      try {
        await choose(loaded, 'brush');
        await visibleCanvas(loaded);
        const a = await scenePoint(loaded, 10, 20),
          b = await scenePoint(loaded, 50, 60);
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ id: 1, ...a }],
        });
        const before = await loaded.surface.locator(loaded.image).boundingBox();
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ id: 1, ...b }],
        });
        const after = await loaded.surface.locator(loaded.image).boundingBox();
        assert.equal(before.y, after.y, 'Showing Apply must not move the image under the finger');
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [
            { id: 1, ...b },
            { id: 2, x: 8, y: 8 },
          ],
        });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        assert.equal(await loaded.surface.locator('.touch-confirm').isHidden(), true);
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ id: 1, ...a }],
        });
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ id: 1, ...b }],
        });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
        assert.equal(await loaded.surface.locator('.touch-confirm').isHidden(), true);
        assert.equal(writes(loaded.state).length, 0);
        assert.deepEqual(loaded.errors, []);
      } finally {
        await cdp.detach();
        await loaded.context.close();
      }
    },
  );
  test(
    kind + ' PC revision change cancels forced refresh and stale Apply never replays',
    async () => {
      const loaded = await loadTouch(browser, kind);
      try {
        await choose(loaded, 'rectangle');
        await drag(loaded, [10, 10], [60, 70]);
        const reads = loaded.state.commands.filter(
          (value) => value.name === 'get_workspace',
        ).length;
        loaded.state.revision++;
        await loaded.page.clock.runFor(10001);
        assert.equal(
          loaded.state.commands.filter((value) => value.name === 'get_workspace').length,
          reads,
          'A draft blocks ordinary refresh',
        );
        await applyDraft(loaded);
        assert.equal(loaded.state.edits, 0);
        assert.equal(writes(loaded.state).length, 1);
        assert.equal(writes(loaded.state)[0].args.expectedRevision, 'fixture-1');
        await loaded.page.clock.runFor(10001);
        assert.equal(writes(loaded.state).length, 1);
        await loaded.surface.locator('#refresh').click();
        await idle(loaded.surface);
        await choose(loaded, 'rectangle');
        await drag(loaded, [10, 10], [60, 70]);
        loaded.state.revision++;
        if (kind === 'app') await notifyTouch(loaded, touchRead(loaded.state, 'get_workspace'));
        else {
          await loaded.surface.locator('#refresh').click();
          await idle(loaded.surface);
        }
        await loaded.surface.locator('.touch-confirm').waitFor({ state: 'hidden' });
        assert.equal(loaded.state.edits, 0);
        assert.deepEqual(loaded.errors, []);
      } finally {
        await loaded.context.close();
      }
    },
  );
  test(
    kind + ' sharing opt-out and revoked access clear draft before any admitted edit',
    async () => {
      const loaded = await loadTouch(browser, kind);
      try {
        await choose(loaded, 'rectangle');
        await drag(loaded, [10, 10], [60, 70]);
        loaded.state.sharing = false;
        if (kind === 'app') await notifyTouch(loaded, touchRead(loaded.state, 'get_workspace'));
        else {
          await loaded.surface.locator('#refresh').click();
          await idle(loaded.surface);
        }
        await loaded.surface.locator('.touch-confirm').waitFor({ state: 'hidden' });
        assert.equal(await loaded.surface.locator(loaded.image).isHidden(), true);
        assert.equal(loaded.state.edits, 0);
        loaded.state.sharing = true;
        await loaded.surface.locator('#refresh').click();
        await idle(loaded.surface);
        await choose(loaded, 'rectangle');
        await drag(loaded, [10, 10], [60, 70]);
        loaded.state.revoked = true;
        await applyDraft(loaded);
        assert.equal(loaded.state.edits, 0);
        assert.equal(await loaded.surface.locator(loaded.image).isHidden(), true);
        assert.equal(await loaded.surface.locator('.touch-confirm').isHidden(), true);
        assert.deepEqual(loaded.errors, []);
      } finally {
        await loaded.context.close();
      }
    },
  );
  test(
    kind + ' lost edit reply retains one request identity and only explicit retry checks it',
    async () => {
      const loaded = await loadTouch(browser, kind);
      try {
        await choose(loaded, 'rectangle');
        await drag(loaded, [10, 10], [60, 70]);
        loaded.state.dropNextWrite = true;
        const admitted = writeAdmission(loaded.state);
        await loaded.surface.locator('.touch-apply').click();
        await admitted;
        if (kind === 'app') await loaded.page.clock.runFor(30001);
        await idle(loaded.surface);
        assert.equal(loaded.state.edits, 1);
        const requestId = writes(loaded.state)[0].args.requestId;
        await loaded.page.clock.runFor(60001);
        assert.equal(writes(loaded.state).length, 1);
        assert.equal(
          await loaded.surface.locator('[data-touch-tool=rectangle]').isDisabled(),
          true,
        );
        await loaded.surface.locator(kind === 'phone' ? '#retry-edit' : '#retry').click();
        await idle(loaded.surface);
        assert.equal(loaded.state.edits, 1);
        assert.equal(writes(loaded.state).length, 2);
        assert.equal(writes(loaded.state)[1].args.requestId, requestId);
        assert.deepEqual(loaded.errors, []);
      } finally {
        await loaded.context.close();
      }
    },
  );
  test(kind + ' 320 and 390px larger-font tool layout has no horizontal overflow', async () => {
    for (const width of [320, 390]) {
      const loaded = await loadTouch(browser, kind, touchFixture(), width);
      try {
        await loaded.surface.addStyleTag({
          content:
            'body{font-family:Arial,sans-serif!important}.touch-controls button{font-size:15px!important;letter-spacing:.25px}',
        });
        await assertNoOverflow(loaded.surface);
        const buttons = await loaded.surface.locator('[data-touch-tool]').evaluateAll((elements) =>
          elements.map((element) => ({
            mode: element.dataset.touchTool,
            width: element.getBoundingClientRect().width,
            height: element.getBoundingClientRect().height,
            scroll: element.scrollWidth,
            client: element.clientWidth,
          })),
        );
        assert.ok(
          buttons.every(
            (value) => value.width >= 48 && value.height >= 48 && value.scroll <= value.client,
          ),
          JSON.stringify({ width, buttons }),
        );
        await choose(loaded, 'rectangle');
        await drag(loaded, [10, 10], [60, 70]);
        await assertNoOverflow(loaded.surface);
        assert.deepEqual(loaded.errors, []);
      } finally {
        await loaded.context.close();
      }
    }
  });
}
