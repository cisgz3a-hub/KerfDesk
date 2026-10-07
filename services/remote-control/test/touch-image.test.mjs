import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { chromium } from '@playwright/test';
import { idle, ONE_PIXEL_PNG } from './phone-workspace-support.mjs';
import { loadTouch, choose, applyDraft, writes } from './touch-ui-support.mjs';

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

const incompletePng = Buffer.from(ONE_PIXEL_PNG, 'base64').subarray(0, 33).toString('base64');
for (const kind of ['phone', 'app']) {
  test(
    kind + ' undecodable current PNG disables pointer and keyboard edits, then recovers',
    async () => {
      const loaded = await loadTouch(browser, kind);
      try {
        await choose(loaded, 'move');
        loaded.state.preview = {
          mimeType: 'image/png',
          data: incompletePng,
          widthPx: 1,
          heightPx: 1,
        };
        await loaded.surface.locator('#refresh').click();
        await idle(loaded.surface);
        await loaded.surface.locator(loaded.image).evaluate((image) =>
          image.complete
            ? undefined
            : new Promise((resolve) => {
                image.addEventListener('load', resolve, { once: true });
                image.addEventListener('error', resolve, { once: true });
              }),
        );
        assert.equal(
          await loaded.surface.locator(loaded.image).evaluate((image) => image.naturalWidth),
          0,
        );
        await loaded.surface.locator('[data-touch-tool=move]:disabled').waitFor();
        await loaded.surface.locator('#preview-surface').press('ArrowRight');
        await loaded.surface.locator('.touch-apply').dispatchEvent('click');
        assert.equal(await loaded.surface.locator('.touch-confirm').isHidden(), true);
        assert.equal(await loaded.surface.locator('.touch-apply').isDisabled(), true);
        assert.equal(writes(loaded.state).length, 0);
        assert.match(await loaded.surface.locator('.touch-hint').innerText(), /could not load/);
        loaded.state.preview = undefined;
        await loaded.surface.locator('#refresh').click();
        await idle(loaded.surface);
        await loaded.surface.locator('[data-touch-tool=move]:enabled').waitFor();
        await loaded.surface.locator('#preview-surface').press('ArrowRight');
        await applyDraft(loaded);
        assert.equal(loaded.state.edits, 1);
        assert.deepEqual(writes(loaded.state)[0].args.transform, {
          type: 'move',
          dxMm: 1,
          dyMm: 0,
        });
        assert.deepEqual(loaded.errors, []);
      } finally {
        await loaded.context.close();
      }
    },
  );
  test(
    kind + ' a pending source replacement cannot inherit old pixels or apply a prior draft',
    async () => {
      const loaded = await loadTouch(browser, kind);
      try {
        await choose(loaded, 'move');
        await loaded.surface.locator('#preview-surface').press('ArrowRight');
        assert.equal(await loaded.surface.locator('.touch-apply').isEnabled(), true);
        const witness = await loaded.surface.locator(loaded.image).evaluate((image, data) => {
          const widthBefore = image.naturalWidth;
          image.src = 'data:image/png;base64,' + data;
          const completeDuring = image.complete;
          const widthDuring = image.naturalWidth;
          const surface = globalThis.document.getElementById('preview-surface');
          surface.dispatchEvent(
            new globalThis.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
          );
          globalThis.document
            .querySelector('.touch-apply')
            .dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }));
          return { widthBefore, completeDuring, widthDuring };
        }, incompletePng);
        assert.equal(witness.widthBefore, 1);
        assert.equal(
          witness.completeDuring,
          false,
          'The new source is genuinely pending in Chrome',
        );
        await loaded.surface.locator('[data-touch-tool=move]:disabled').waitFor();
        assert.equal(await loaded.surface.locator('.touch-confirm').isHidden(), true);
        assert.equal(writes(loaded.state).length, 0);
        await loaded.surface.locator('#refresh').click();
        await idle(loaded.surface);
        await loaded.surface.locator('[data-touch-tool=move]:enabled').waitFor();
        assert.equal(await loaded.surface.locator('.touch-confirm').isHidden(), true);
        assert.equal(writes(loaded.state).length, 0);
        assert.deepEqual(loaded.errors, []);
      } finally {
        await loaded.context.close();
      }
    },
  );
}
