import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { idle } from './phone-workspace-support.mjs';
import {
  applyDraft,
  choose,
  finger,
  loadTouch,
  touchFixture,
  visibleCanvas,
  writes,
} from './touch-ui-support.mjs';

let browser, png;
before(async () => {
  browser = await chromium.launch({
    ...(process.env.KERFDESK_TEST_BROWSER === 'chromium' ? {} : { channel: 'chrome' }),
    headless: true,
  });
  const painter = await browser.newPage();
  try {
    png = await painter.evaluate(() => {
      const canvas = globalThis.document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      const context = canvas.getContext('2d');
      context.fillStyle = '#fafafa';
      context.fillRect(0, 0, 800, 600);
      context.strokeStyle = '#cc3333';
      context.lineWidth = 3;
      context.strokeRect(50, 80, 240, 160);
      return {
        mimeType: 'image/png',
        data: canvas.toDataURL('image/png').split(',')[1],
        widthPx: 800,
        heightPx: 600,
      };
    });
  } finally {
    await painter.close();
  }
});
after(async () => {
  await browser?.close();
});

function fixture() {
  const state = touchFixture();
  state.preview = png;
  state.viewport = { xMm: 0, yMm: 0, widthMm: 300, heightMm: 225 };
  return state;
}
async function pose(loaded) {
  return loaded.surface.evaluate((viewport) => {
    const surface = globalThis.document.querySelector('#preview-surface');
    const image = surface.querySelector('img').getBoundingClientRect();
    const box = surface.getBoundingClientRect();
    const x = image.left - box.left - surface.clientLeft;
    const y = image.top - box.top - surface.clientTop;
    return {
      scale: Number(surface.dataset.canvasScale),
      centreX: viewport.xMm + ((surface.clientWidth / 2 - x) * viewport.widthMm) / image.width,
      centreY: viewport.yMm + ((surface.clientHeight / 2 - y) * viewport.heightMm) / image.height,
      pxPerMm: image.width / viewport.widthMm,
    };
  }, loaded.state.viewport);
}
function sameScene(actual, expected, message) {
  for (const key of ['centreX', 'centreY', 'pxPerMm'])
    assert.ok(
      Math.abs(actual[key] - expected[key]) < 0.02,
      message + ': ' + key + ' ' + actual[key] + ' != ' + expected[key],
    );
}
async function startPan(loaded, dx = -30, dy = 20) {
  await visibleCanvas(loaded);
  const box = await loaded.surface.locator('#preview-surface').boundingBox();
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await loaded.page.mouse.move(point.x, point.y);
  await loaded.page.mouse.down();
  await loaded.page.mouse.move(point.x + dx, point.y + dy);
  return { x: point.x + dx, y: point.y + dy };
}
async function zoomTwice(loaded) {
  await loaded.surface.locator('#zoom-in').click();
  await loaded.surface.locator('#zoom-in').click();
  assert.equal((await pose(loaded)).scale, 2);
}

for (const kind of ['phone', 'app']) {
  test(
    kind + ' Ctrl-wheel zoom replaces an active captured pan without being undone by its next move',
    async () => {
      const loaded = await loadTouch(browser, kind, fixture());
      try {
        await choose(loaded, 'pan');
        await zoomTwice(loaded);
        const pointer = await startPan(loaded, -20, 10);
        await loaded.page.keyboard.down('Control');
        await loaded.page.mouse.wheel(0, -50);
        await loaded.page.keyboard.up('Control');
        await loaded.surface.waitForFunction(
          () =>
            Number(globalThis.document.querySelector('#preview-surface').dataset.canvasScale) > 2.9,
        );
        const afterWheel = await pose(loaded);
        await loaded.page.mouse.move(pointer.x + 1, pointer.y);
        const afterOldPointer = await pose(loaded);
        sameScene(afterOldPointer, afterWheel, 'An old pan must not undo explicit zoom');
        assert.equal(afterOldPointer.scale, afterWheel.scale);
        await loaded.page.mouse.up();
        assert.equal(writes(loaded.state).length, 0);
        assert.deepEqual(loaded.errors, []);
      } finally {
        await loaded.context.close();
      }
    },
  );

  test(
    kind + ' Pan retains a completed ellipse draft and applies its original scene coordinates',
    async () => {
      const loaded = await loadTouch(browser, kind, fixture());
      try {
        await choose(loaded, 'ellipse');
        await finger(loaded, [
          [30, 30],
          [90, 75],
        ]);
        const ghost = loaded.surface.locator('svg ellipse.touch-ghost');
        await expect(ghost).toBeVisible();
        await choose(loaded, 'pan');
        await expect(ghost).toBeVisible();
        await startPan(loaded);
        await expect(loaded.surface.locator('.touch-apply')).toBeDisabled();
        await loaded.page.mouse.up();
        await expect(ghost).toBeVisible();
        await expect(loaded.surface.locator('.touch-apply')).toBeEnabled();
        await choose(loaded, 'ellipse');
        await expect(ghost).toBeVisible();
        assert.equal(writes(loaded.state).length, 0);
        await applyDraft(loaded);
        const [write] = writes(loaded.state);
        assert.equal(write.name, 'add_ellipse');
        assert.equal(write.args.expectedRevision, 'fixture-1');
        for (const [key, value] of Object.entries({ xMm: 30, yMm: 30, widthMm: 60, heightMm: 45 }))
          assert.ok(Math.abs(write.args[key] - value) < 0.001, key + ' changed while navigating');
        assert.equal(loaded.state.edits, 1);
        assert.deepEqual(loaded.errors, []);
      } finally {
        await loaded.context.close();
      }
    },
  );

  test(
    kind + ' rotation preserves the scene centre and physical zoom after a 200% pan',
    async () => {
      const loaded = await loadTouch(browser, kind, fixture());
      try {
        await choose(loaded, 'pan');
        await zoomTwice(loaded);
        await startPan(loaded);
        await loaded.page.mouse.up();
        const beforeRotation = await pose(loaded);
        await loaded.page.setViewportSize({ width: 844, height: 390 });
        if (kind === 'app')
          await loaded.page.locator('#widget').evaluate((frame) => {
            frame.style.height = '390px';
          });
        await loaded.surface.evaluate(
          () =>
            new Promise((resolve) =>
              globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve)),
            ),
        );
        sameScene(
          await pose(loaded),
          beforeRotation,
          'Rotation must retain world centre and px/mm',
        );
        assert.equal(writes(loaded.state).length, 0);
        assert.deepEqual(loaded.errors, []);
      } finally {
        await loaded.context.close();
      }
    },
  );

  test(
    kind + ' a changed PC extent cancels the held pan without replacing the accepted scene view',
    async () => {
      const loaded = await loadTouch(browser, kind, fixture());
      try {
        await choose(loaded, 'pan');
        await zoomTwice(loaded);
        const pointer = await startPan(loaded, -20, 10);
        const beforeRefresh = await pose(loaded);
        loaded.state.viewport = { xMm: 0, yMm: 0, widthMm: 600, heightMm: 450 };
        loaded.state.revision++;
        await loaded.page.clock.runFor(6000);
        await loaded.surface.waitForFunction(
          () =>
            Number(globalThis.document.querySelector('#preview-surface').dataset.canvasScale) > 3.9,
        );
        await idle(loaded.surface);
        const afterRefresh = await pose(loaded);
        sameScene(
          afterRefresh,
          beforeRefresh,
          'A newer PC extent must retain physical zoom and centre',
        );
        assert.ok(Math.abs(afterRefresh.scale - 4) < 0.001);
        await loaded.page.mouse.move(pointer.x + 1, pointer.y);
        sameScene(
          await pose(loaded),
          afterRefresh,
          'The old captured pan must not overwrite the new mapping',
        );
        await loaded.page.mouse.up();
        await startPan(loaded, -15, 0);
        await loaded.page.mouse.up();
        assert.ok(
          (await pose(loaded)).centreX > afterRefresh.centreX + 1,
          'A fresh pan must still work',
        );
        assert.equal(writes(loaded.state).length, 0);
        assert.deepEqual(loaded.errors, []);
      } finally {
        await loaded.context.close();
      }
    },
  );
}
