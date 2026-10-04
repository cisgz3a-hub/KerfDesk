import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { idle } from './phone-workspace-support.mjs';
import {
  compactTouchScript,
  touchExports,
  touchFixture,
  loadTouch,
  choose,
  drag,
  applyDraft,
  finger,
  writes,
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
function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 0.0001, actual + ' != ' + expected);
}

test('portable controller and CSS are the exact bounded phone implementation', async () => {
  const resource = await touchExports();
  assert.equal(resource.MCP_TOUCH_SCRIPT.trim(), (await compactTouchScript()).trim());
  assert.equal(
    resource.MCP_TOUCH_STYLE,
    await readFile(new URL('../public/control-touch.css', import.meta.url), 'utf8'),
  );
  assert.equal(resource.MCP_TOUCH_MARKUP, '<div id="touch-tools"></div>');
});

for (const kind of ['phone', 'app']) {
  test(kind + ' 320px rectangle draft maps negative scene bounds and applies once', async () => {
    const loaded = await loadTouch(browser, kind, touchFixture(), 320);
    try {
      await choose(loaded, 'rectangle');
      await drag(loaded, [40, 70], [-20, 30]);
      assert.equal(writes(loaded.state).length, 0);
      assert.equal(await loaded.surface.locator('.touch-confirm').isVisible(), true);
      const ghost = loaded.surface.locator('svg .touch-ghost');
      near(Number(await ghost.getAttribute('x')), -20);
      near(Number(await ghost.getAttribute('width')), 60);
      await loaded.surface.locator('.touch-apply').evaluate((button) => {
        button.click();
        button.click();
      });
      await idle(loaded.surface);
      assert.equal(loaded.state.edits, 1);
      const [write] = writes(loaded.state);
      assert.equal(write.name, 'add_rectangle');
      assert.equal(write.args.expectedRevision, 'fixture-1');
      assert.match(write.args.requestId, /^[0-9a-f-]{36}$/i);
      for (const [name, value] of Object.entries({ xMm: -20, yMm: 30, widthMm: 60, heightMm: 40 }))
        near(write.args[name], value);
      assert.deepEqual(loaded.errors, []);
    } finally {
      await loaded.context.close();
    }
  });
  test(
    kind + ' 390px real touch creates ellipse and brush without sending until Apply',
    async () => {
      const loaded = await loadTouch(browser, kind);
      try {
        await choose(loaded, 'ellipse');
        await finger(loaded, [
          [10, 10],
          [80, 60],
        ]);
        assert.equal(writes(loaded.state).length, 0);
        assert.equal(await loaded.surface.locator('svg ellipse.touch-ghost').count(), 1);
        await applyDraft(loaded);
        assert.equal(writes(loaded.state)[0].name, 'add_ellipse');
        near(writes(loaded.state)[0].args.widthMm, 70);
        near(writes(loaded.state)[0].args.heightMm, 50);
        await choose(loaded, 'brush');
        await finger(loaded, [
          [10, 20],
          [30, 60],
          [70, 10],
        ]);
        assert.equal(loaded.state.edits, 1);
        assert.equal(await loaded.surface.locator('svg polyline.touch-stroke').count(), 1);
        assert.equal(await loaded.surface.locator('svg .touch-ghost').count(), 0);
        assert.match(
          await loaded.surface.locator('.touch-summary').innerText(),
          /Draft brush\. Apply/,
        );
        await applyDraft(loaded);
        const write = writes(loaded.state)[1];
        assert.equal(write.name, 'add_polyline');
        assert.equal(write.args.closed, false);
        assert.equal(write.args.pointsMm.length, 3);
        near(write.args.pointsMm[0].xMm, 10);
        near(write.args.pointsMm.at(-1).yMm, 10);
        assert.deepEqual(loaded.errors, []);
      } finally {
        await loaded.context.close();
      }
    },
  );
  test(kind + ' bounds selection ignores hidden and locked overlapping items', async () => {
    const loaded = await loadTouch(browser, kind);
    try {
      await choose(loaded, 'select');
      await drag(loaded, [10, 50], [10, 50]);
      assert.equal(writes(loaded.state).length, 0);
      await applyDraft(loaded);
      assert.equal(writes(loaded.state)[0].name, 'set_selection');
      assert.deepEqual(writes(loaded.state)[0].args.artworkIds, ['rectangle-1']);
      assert.deepEqual(loaded.errors, []);
    } finally {
      await loaded.context.close();
    }
  });
  test(
    kind + ' group Move and lower-right Resize use exact canonical combined bounds',
    async () => {
      const state = touchFixture();
      state.artwork.push({
        id: 'other-1',
        visible: true,
        editable: true,
        type: 'rectangle',
        bounds: { xMm: -40, yMm: 20, widthMm: 10, heightMm: 10 },
      });
      state.selected.push('other-1');
      const loaded = await loadTouch(browser, kind, state);
      try {
        await choose(loaded, 'move');
        await drag(loaded, [10, 50], [25, 42]);
        await applyDraft(loaded);
        const move = writes(state)[0];
        assert.equal(move.name, 'transform_artwork');
        assert.deepEqual(move.args.artworkIds, ['rectangle-1', 'other-1']);
        near(move.args.transform.dxMm, 15);
        near(move.args.transform.dyMm, -8);
        await choose(loaded, 'resize');
        await drag(loaded, [40, 70], [60, 100]);
        await applyDraft(loaded);
        const resize = writes(state)[1];
        assert.deepEqual(resize.args.artworkIds, ['rectangle-1', 'other-1']);
        assert.equal(resize.args.transform.type, 'resize');
        near(resize.args.transform.widthMm, 100);
        near(resize.args.transform.heightMm, 80);
        assert.equal('xMm' in resize.args.transform, false);
        assert.deepEqual(loaded.errors, []);
      } finally {
        await loaded.context.close();
      }
    },
  );
  test(
    kind + ' zoom and pan retain exact PNG coordinate mapping, not the element letterbox',
    async () => {
      const loaded = await loadTouch(browser, kind);
      try {
        await loaded.surface.locator('#zoom-in').click();
        await loaded.surface.locator('#zoom-in').click();
        await loaded.surface.locator('#preview-surface').evaluate((surface) => {
          surface.scrollLeft = 60;
          surface.scrollTop = 60;
        });
        await loaded.surface.evaluate(
          () => new Promise((resolve) => globalThis.requestAnimationFrame(resolve)),
        );
        await choose(loaded, 'rectangle');
        await drag(loaded, [-20, -20], [30, 30]);
        await applyDraft(loaded);
        const write = writes(loaded.state)[0];
        assert.equal(write.name, 'add_rectangle');
        near(write.args.xMm, -20);
        near(write.args.yMm, -20);
        near(write.args.widthMm, 50);
        near(write.args.heightMm, 50);
        assert.deepEqual(loaded.errors, []);
      } finally {
        await loaded.context.close();
      }
    },
  );
  test(kind + ' keyboard Move stays a draft and Escape cancels without writes', async () => {
    const loaded = await loadTouch(browser, kind);
    try {
      await choose(loaded, 'move');
      await loaded.surface.locator('#preview-surface').focus();
      await loaded.page.keyboard.press('ArrowRight');
      await loaded.page.keyboard.press('Shift+ArrowDown');
      assert.equal(writes(loaded.state).length, 0);
      await applyDraft(loaded);
      assert.deepEqual(writes(loaded.state)[0].args.transform, { type: 'move', dxMm: 1, dyMm: 10 });
      await choose(loaded, 'move');
      await loaded.surface.locator('#preview-surface').focus();
      await loaded.page.keyboard.press('ArrowLeft');
      await loaded.page.keyboard.press('Escape');
      assert.equal(await loaded.surface.locator('.touch-confirm').isHidden(), true);
      assert.equal(writes(loaded.state).length, 1);
      assert.deepEqual(loaded.errors, []);
    } finally {
      await loaded.context.close();
    }
  });
}
