import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { chromium } from '@playwright/test';
import { idle } from './phone-workspace-support.mjs';
import {
  touchFixture,
  touchRead,
  loadTouch,
  choose,
  drag,
  applyDraft,
  scenePoint,
  visibleCanvas,
  writes,
  notifyTouch,
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
  test(
    kind + ' resize keeps the comfortable grip offset and stationary taps are no-ops',
    async () => {
      const loaded = await loadTouch(browser, kind);
      try {
        await choose(loaded, 'resize');
        await drag(loaded, [35, 65], [35, 65]);
        const ghost = loaded.surface.locator('svg .touch-ghost');
        assert.equal(Number(await ghost.getAttribute('x')), -20);
        assert.equal(Number(await ghost.getAttribute('y')), 30);
        assert.equal(Number(await ghost.getAttribute('width')), 60);
        assert.equal(Number(await ghost.getAttribute('height')), 40);
        assert.equal(await loaded.surface.locator('.touch-apply').isDisabled(), true);
        assert.equal(writes(loaded.state).length, 0);
        await choose(loaded, 'resize');
        await drag(loaded, [35, 65], [40, 70]);
        assert.ok(Math.abs(Number(await ghost.getAttribute('width')) - 65) < 0.0001);
        assert.ok(Math.abs(Number(await ghost.getAttribute('height')) - 45) < 0.0001);
        await applyDraft(loaded);
        const [write] = writes(loaded.state);
        assert.equal(write.name, 'transform_artwork');
        assert.equal(write.args.transform.type, 'resize');
        assert.ok(Math.abs(write.args.transform.widthMm - 65) < 0.0001);
        assert.ok(Math.abs(write.args.transform.heightMm - 45) < 0.0001);
        assert.equal(loaded.state.edits, 1);
        assert.deepEqual(loaded.errors, []);
      } finally {
        await loaded.context.close();
      }
    },
  );
  test(
    kind + ' page and ancestor scrolling cancel an active gesture before mapping the next event',
    async () => {
      const loaded = await loadTouch(browser, kind);
      try {
        await choose(loaded, 'move');
        await visibleCanvas(loaded);
        const from = await scenePoint(loaded, 10, 50);
        await loaded.page.mouse.move(from.x, from.y);
        await loaded.page.mouse.down();
        const before = await loaded.surface.locator(loaded.image).boundingBox();
        await loaded.surface.evaluate(() => globalThis.scrollBy(0, 40));
        await loaded.surface.evaluate(
          () => new Promise((resolve) => globalThis.requestAnimationFrame(resolve)),
        );
        const after = await loaded.surface.locator(loaded.image).boundingBox();
        assert.ok(Math.abs(before.y - after.y) > 10, 'Fixture must physically move the image');
        const to = await scenePoint(loaded, 25, 42);
        await loaded.page.mouse.move(to.x, to.y);
        await loaded.page.mouse.up();
        assert.equal(await loaded.surface.locator('svg .touch-ghost').count(), 0);
        assert.equal(await loaded.surface.locator('.touch-apply').isDisabled(), true);
        assert.equal(writes(loaded.state).length, 0);
        await drag(loaded, [10, 50], [15, 55]);
        await loaded.surface.evaluate(() => globalThis.scrollBy(0, 20));
        await loaded.surface.evaluate(
          () => new Promise((resolve) => globalThis.requestAnimationFrame(resolve)),
        );
        assert.equal(
          await loaded.surface.locator('.touch-apply').isEnabled(),
          true,
          'Finished world-coordinate draft survives view scrolling',
        );
        await applyDraft(loaded);
        assert.equal(loaded.state.edits, 1);
        assert.deepEqual(loaded.errors, []);
      } finally {
        await loaded.context.close();
      }
    },
  );
  test(
    kind + ' known offline and malformed authoritative reads disable editing until fresh recovery',
    async () => {
      const loaded = await loadTouch(browser, kind);
      try {
        await choose(loaded, 'rectangle');
        await drag(loaded, [10, 10], [60, 70]);
        const normal = loaded.state.readHook;
        if (kind === 'phone') loaded.state.online = false;
        else
          loaded.state.readHook = (name, args) =>
            name === 'get_workspace' ? { error: { code: 'unavailable' } } : normal(name, args);
        await loaded.surface.locator('#refresh').click();
        await idle(loaded.surface);
        assert.equal(await loaded.surface.locator('.touch-confirm').isHidden(), true);
        assert.equal(
          await loaded.surface.locator('[data-touch-tool=rectangle]').isDisabled(),
          true,
        );
        loaded.state.online = true;
        loaded.state.readHook = normal;
        await loaded.surface.locator('#refresh').click();
        await idle(loaded.surface);
        assert.equal(await loaded.surface.locator('[data-touch-tool=rectangle]').isEnabled(), true);
        loaded.state.readHook = (name, args) =>
          name === 'get_workspace'
            ? { result: { revision: 'fixture-' + loaded.state.revision } }
            : normal(name, args);
        await loaded.surface.locator('#refresh').click();
        await idle(loaded.surface);
        assert.equal(
          await loaded.surface.locator('[data-touch-tool=rectangle]').isDisabled(),
          true,
        );
        loaded.state.readHook = normal;
        await loaded.surface.locator('#refresh').click();
        await idle(loaded.surface);
        assert.equal(await loaded.surface.locator('[data-touch-tool=rectangle]').isEnabled(), true);
        assert.equal(writes(loaded.state).length, 0);
        assert.deepEqual(loaded.errors, []);
      } finally {
        await loaded.context.close();
      }
    },
  );
  test(
    kind +
      ' empty bed viewport supports a new shape and incompatible viewport changes retire the draft',
    async () => {
      const state = Object.assign(touchFixture(), {
        empty: true,
        viewport: { xMm: 0, yMm: 0, widthMm: 300, heightMm: 300 },
      });
      const loaded = await loadTouch(browser, kind, state);
      try {
        await choose(loaded, 'rectangle');
        await drag(loaded, [20, 30], [80, 70]);
        await applyDraft(loaded);
        assert.equal(writes(state)[0].name, 'add_rectangle');
        assert.ok(Math.abs(writes(state)[0].args.xMm - 20) < 0.0001);
        await choose(loaded, 'rectangle');
        await drag(loaded, [20, 30], [80, 70]);
        state.viewport = { xMm: -50, yMm: -50, widthMm: 400, heightMm: 400 };
        if (kind === 'app') await notifyTouch(loaded, touchRead(state, 'get_workspace_preview'));
        else {
          await loaded.surface.locator('#refresh').click();
          await idle(loaded.surface);
        }
        await loaded.surface.locator('.touch-confirm').waitFor({ state: 'hidden' });
        assert.equal(state.edits, 1);
        assert.deepEqual(loaded.errors, []);
      } finally {
        await loaded.context.close();
      }
    },
  );
  test(
    kind + ' over-detailed brush stays bounded and cannot silently apply a truncated stroke',
    async () => {
      const loaded = await loadTouch(browser, kind);
      try {
        await choose(loaded, 'brush');
        await visibleCanvas(loaded);
        const a = await scenePoint(loaded, 10, 20),
          b = await scenePoint(loaded, 40, 50);
        await loaded.page.mouse.move(a.x, a.y);
        await loaded.page.mouse.down();
        await loaded.surface.locator('#preview-surface').evaluate(
          (surface, points) => {
            for (let index = 0; index < 514; index++) {
              const point = points[index % 2];
              surface.dispatchEvent(
                new globalThis.PointerEvent('pointermove', {
                  bubbles: true,
                  pointerId: 1,
                  isPrimary: true,
                  buttons: 1,
                  clientX: point.x,
                  clientY: point.y,
                }),
              );
            }
          },
          [a, b],
        );
        await loaded.page.mouse.up();
        const points = await loaded.surface.locator('.touch-stroke').getAttribute('points');
        assert.equal(points.split(' ').length, 512);
        assert.equal(await loaded.surface.locator('.touch-apply').isDisabled(), true);
        assert.match(await loaded.surface.locator('.touch-summary').innerText(), /too detailed/);
        assert.equal(writes(loaded.state).length, 0);
        await loaded.surface
          .locator('.touch-confirm')
          .getByRole('button', { name: 'Cancel', exact: true })
          .click();
        assert.equal(await loaded.surface.locator('.touch-confirm').isHidden(), true);
        assert.deepEqual(loaded.errors, []);
      } finally {
        await loaded.context.close();
      }
    },
  );
}
