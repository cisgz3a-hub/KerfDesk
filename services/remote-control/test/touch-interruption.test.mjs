import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from '@playwright/test';
import {
  applyDraft,
  choose,
  drag,
  loadTouch,
  scenePoint,
  visibleCanvas,
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

async function startMouse(loaded, xMm = 10, yMm = 50) {
  await visibleCanvas(loaded);
  await loaded.surface.locator('#preview-surface').evaluate((surface) => {
    surface.addEventListener(
      'pointerdown',
      (event) => {
        surface.dataset.testPointerId = String(event.pointerId);
      },
      { once: true },
    );
  });
  const point = await scenePoint(loaded, xMm, yMm);
  await loaded.page.mouse.move(point.x, point.y);
  await loaded.page.mouse.down();
  return point;
}
async function loseCapture(loaded, point) {
  await loaded.surface.locator('#preview-surface').evaluate((surface) => {
    const id = Number(surface.dataset.testPointerId);
    if (!surface.hasPointerCapture(id)) throw new Error('Fixture pointer was not captured.');
    surface.releasePointerCapture(id);
  });
  await loaded.page.mouse.move(point.x + 2, point.y);
}
async function startTouchNavigation(loaded, cdp) {
  await visibleCanvas(loaded);
  const box = await loaded.surface.locator('#preview-surface').boundingBox();
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { id: 10, x: centre.x - 30, y: centre.y },
      { id: 20, x: centre.x + 30, y: centre.y },
    ],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { id: 10, x: centre.x - 40, y: centre.y + 10 },
      { id: 20, x: centre.x + 40, y: centre.y + 10 },
    ],
  });
}
async function assertCancelled(loaded) {
  assert.equal(await loaded.surface.locator('.touch-confirm').isHidden(), true);
  assert.equal(await loaded.surface.locator('.touch-apply').isDisabled(), true);
  assert.equal(writes(loaded.state).length, 0);
  assert.deepEqual(loaded.errors, []);
}

for (const kind of ['phone', 'app']) {
  test(
    kind + ' cancelling later pinch navigation keeps a completed independent draft',
    async () => {
      const loaded = await loadTouch(browser, kind);
      const cdp = await loaded.context.newCDPSession(loaded.page);
      try {
        await choose(loaded, 'rectangle');
        await drag(loaded, [10, 10], [70, 60]);
        const ghost = loaded.surface.locator('svg rect.touch-ghost');
        const before = await ghost.getAttribute('width');
        await startTouchNavigation(loaded, cdp);
        assert.equal(await loaded.surface.locator('.touch-apply').isDisabled(), true);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
        assert.equal(await loaded.surface.locator('.touch-confirm').isVisible(), true);
        assert.equal(await ghost.getAttribute('width'), before);
        assert.equal(await loaded.surface.locator('.touch-apply').isEnabled(), true);
        await applyDraft(loaded);
        const [write] = writes(loaded.state);
        assert.equal(write.name, 'add_rectangle');
        for (const [key, value] of Object.entries({ xMm: 10, yMm: 10, widthMm: 60, heightMm: 50 }))
          assert.ok(Math.abs(write.args[key] - value) < 0.0001, key + ' changed on cancellation');
        assert.equal(loaded.state.edits, 1);
        assert.deepEqual(loaded.errors, []);
      } finally {
        await cdp.detach();
        await loaded.context.close();
      }
    },
  );

  test(kind + ' losing capture during later Pan keeps a completed independent draft', async () => {
    const loaded = await loadTouch(browser, kind);
    try {
      await choose(loaded, 'ellipse');
      await drag(loaded, [10, 10], [70, 60]);
      await choose(loaded, 'pan');
      const point = await startMouse(loaded);
      await loaded.page.mouse.move(point.x + 10, point.y);
      assert.equal(await loaded.surface.locator('.touch-apply').isDisabled(), true);
      await loseCapture(loaded, point);
      await loaded.page.mouse.up();
      assert.equal(await loaded.surface.locator('.touch-confirm').isVisible(), true);
      assert.equal(await loaded.surface.locator('.touch-apply').isEnabled(), true);
      await applyDraft(loaded);
      assert.equal(writes(loaded.state)[0].name, 'add_ellipse');
      assert.equal(loaded.state.edits, 1);
      assert.deepEqual(loaded.errors, []);
    } finally {
      await loaded.context.close();
    }
  });

  test(kind + ' cancelling an unfinished brush stroke still retires the draft', async () => {
    const loaded = await loadTouch(browser, kind);
    const cdp = await loaded.context.newCDPSession(loaded.page);
    try {
      await choose(loaded, 'brush');
      await visibleCanvas(loaded);
      const from = await scenePoint(loaded, 10, 20);
      const to = await scenePoint(loaded, 50, 60);
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ id: 10, ...from }],
      });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ id: 10, ...to }],
      });
      assert.equal(await loaded.surface.locator('svg polyline.touch-stroke').count(), 1);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      await assertCancelled(loaded);
    } finally {
      await cdp.detach();
      await loaded.context.close();
    }
  });

  test(kind + ' losing capture during an unfinished Move still retires the draft', async () => {
    const loaded = await loadTouch(browser, kind);
    try {
      await choose(loaded, 'move');
      const point = await startMouse(loaded);
      await loaded.page.mouse.move(point.x + 10, point.y);
      assert.equal(await loaded.surface.locator('svg rect.touch-ghost').count(), 1);
      await loseCapture(loaded, point);
      await loaded.page.mouse.up();
      await assertCancelled(loaded);
    } finally {
      await loaded.context.close();
    }
  });

  test(kind + ' held Move ignores arrows and ordinary nudging resumes after release', async () => {
    const loaded = await loadTouch(browser, kind);
    try {
      await choose(loaded, 'move');
      await startMouse(loaded);
      await loaded.surface.locator('#preview-surface').focus();
      await loaded.page.keyboard.press('ArrowRight');
      await loaded.page.mouse.up();
      const ghost = loaded.surface.locator('svg rect.touch-ghost');
      assert.equal(Number(await ghost.getAttribute('x')), -20);
      assert.equal(await loaded.surface.locator('.touch-apply').isDisabled(), true);
      await loaded.page.keyboard.press('ArrowRight');
      await loaded.page.keyboard.press('Shift+ArrowDown');
      await applyDraft(loaded);
      assert.deepEqual(writes(loaded.state)[0].args.transform, {
        type: 'move',
        dxMm: 1,
        dyMm: 10,
      });
      assert.equal(loaded.state.edits, 1);
      assert.deepEqual(loaded.errors, []);
    } finally {
      await loaded.context.close();
    }
  });

  test(kind + ' navigation ignores arrows without changing a completed Move draft', async () => {
    const loaded = await loadTouch(browser, kind);
    const cdp = await loaded.context.newCDPSession(loaded.page);
    try {
      await choose(loaded, 'move');
      await loaded.surface.locator('#preview-surface').press('ArrowRight');
      const ghost = loaded.surface.locator('svg rect.touch-ghost');
      const before = await ghost.getAttribute('x');
      await startTouchNavigation(loaded, cdp);
      await loaded.surface.locator('#preview-surface').focus();
      await loaded.page.keyboard.press('ArrowRight');
      assert.equal(await ghost.getAttribute('x'), before);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await loaded.page.keyboard.press('ArrowRight');
      await applyDraft(loaded);
      assert.deepEqual(writes(loaded.state)[0].args.transform, {
        type: 'move',
        dxMm: 2,
        dyMm: 0,
      });
      assert.equal(loaded.state.edits, 1);
      assert.deepEqual(loaded.errors, []);
    } finally {
      await cdp.detach();
      await loaded.context.close();
    }
  });
}
