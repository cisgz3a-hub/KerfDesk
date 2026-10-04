import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from '@playwright/test';
import { idle } from './phone-workspace-support.mjs';
import { loadTouch, touchFixture, writes } from './touch-ui-support.mjs';

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

test('phone creation sheets stay beside a visible canvas and keep blank number drafts editable', async () => {
  const loaded = await loadTouch(browser, 'phone');
  const page = loaded.surface;
  try {
    await page.locator('[data-editor-task=rectangle-task]').click();
    assert.equal(await page.locator(loaded.image).isVisible(), true);
    assert.equal(await page.locator('#rectangle-form').isVisible(), true);
    const width = page.locator('#rectangle-form [name=widthMm]');
    await width.fill('');
    assert.equal(await width.inputValue(), '');
    await width.fill('17.5');
    await page.locator('#rectangle-form [name=heightMm]').fill('12');
    await page.locator('#rectangle-form button').click();
    await idle(page);
    const [request] = writes(loaded.state);
    assert.equal(request.name, 'add_rectangle');
    assert.equal(request.args.widthMm, 17.5);
    assert.equal(request.args.heightMm, 12);
    assert.equal(request.args.expectedRevision, 'fixture-1');
    assert.match(request.args.requestId, /^[0-9a-f-]{36}$/);
    await page.locator('#close-editor').click();
    await page.locator('[data-editor-task=add-text-task]').click();
    assert.equal(await page.locator('#text-form').isVisible(), true);
    assert.equal(await page.locator(loaded.image).isVisible(), true);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

test('portable MCP creates text and exact rectangle dimensions through canonical revision-fenced tools', async () => {
  const loaded = await loadTouch(browser, 'app');
  const page = loaded.surface;
  try {
    await page.locator('#add-text').click();
    const form = page.locator('#add-text-form');
    await form.locator('[name=text]').fill('Written on my phone');
    await form.locator('[name=fontSizeMm]').fill('');
    assert.equal(await form.locator('[name=fontSizeMm]').inputValue(), '');
    await form.locator('[name=fontSizeMm]').fill('12.5');
    await form.locator('[name=xMm]').fill('-3.25');
    await form.locator('[name=fontId] option[value=serif]').waitFor({ state: 'attached' });
    await form.locator('[name=fontId]').selectOption('serif');
    await form.locator('button[type=submit]').click();
    await idle(page);
    assert.equal(writes(loaded.state).length, 1);
    assert.deepEqual(
      { ...writes(loaded.state)[0].args, requestId: 'bounded-id' },
      {
        text: 'Written on my phone',
        fontId: 'serif',
        fontSizeMm: 12.5,
        widthMm: 50,
        xMm: -3.25,
        yMm: 0,
        expectedRevision: 'fixture-1',
        requestId: 'bounded-id',
      },
    );
    await page.locator('#close-authoring').click();
    await page.locator('#add-shape').click();
    const shape = page.locator('#add-rectangle-form');
    await shape.locator('[name=widthMm]').fill('');
    await shape.dispatchEvent('submit');
    await idle(page);
    assert.equal(writes(loaded.state).length, 1);
    assert.equal(await shape.locator('[name=widthMm]').inputValue(), '');
    await shape.locator('[name=widthMm]').fill('23.75');
    await shape.locator('[name=heightMm]').fill('18');
    await shape.locator('button[type=submit]').click();
    await idle(page);
    assert.equal(writes(loaded.state)[1].name, 'add_rectangle');
    assert.equal(writes(loaded.state)[1].args.widthMm, 23.75);
    assert.equal(writes(loaded.state)[1].args.heightMm, 18);
    assert.equal(writes(loaded.state)[1].args.expectedRevision, 'fixture-2');
    await shape.locator('[name=shapeType]').selectOption('ellipse');
    await shape.locator('[name=widthMm]').fill('18');
    await shape.locator('button[type=submit]').click();
    await idle(page);
    assert.equal(writes(loaded.state)[2].name, 'add_ellipse');
    assert.equal(writes(loaded.state)[2].args.widthMm, 18);
    assert.equal(writes(loaded.state)[2].args.heightMm, 18);
    assert.equal(writes(loaded.state)[2].args.expectedRevision, 'fixture-3');
    assert.equal(await page.locator(loaded.image).isVisible(), true);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

test('portable property sheets move, rotate and resize artwork without any machine command', async () => {
  const loaded = await loadTouch(browser, 'app');
  const page = loaded.surface;
  try {
    await page.locator('#properties').click();
    await page.locator('#transform-form [name=dxMm]').fill('2.5');
    await page.locator('#transform-form [name=dyMm]').fill('-4');
    await page.locator('#transform-form button[type=submit]').click();
    await idle(page);
    await page.locator('#rotate-form [name=angleDeg]').fill('90');
    await page.locator('#rotate-form button[type=submit]').click();
    await idle(page);
    await page.locator('#resize-form [name=widthMm]').fill('25');
    await page.locator('#resize-form [name=heightMm]').fill('15');
    await page.locator('#resize-form button[type=submit]').click();
    await idle(page);
    const requests = writes(loaded.state);
    assert.equal(requests.length, 3);
    assert.deepEqual(
      requests.map((request) => request.name),
      ['transform_artwork', 'transform_artwork', 'transform_artwork'],
    );
    assert.deepEqual(requests[0].args.artworkIds, ['rectangle-1']);
    assert.deepEqual(requests[0].args.transform, { type: 'move', dxMm: 2.5, dyMm: -4 });
    assert.deepEqual(requests[1].args.transform, { type: 'rotate', angleDeg: 90 });
    assert.equal(requests[1].args.expectedRevision, 'fixture-2');
    assert.deepEqual(requests[2].args.transform, { type: 'resize', widthMm: 25, heightMm: 15 });
    assert.equal(requests[2].args.expectedRevision, 'fixture-3');
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

test('portable creation keeps a separate stale fence for an unsent text draft after a shape is added', async () => {
  const loaded = await loadTouch(browser, 'app');
  const page = loaded.surface;
  try {
    await page.locator('#add-text').click();
    await page.locator('#add-text-form [name=text]').fill('Keep my text draft');
    await page.locator('#close-authoring').click();
    await page.locator('#add-shape').click();
    await page.locator('#add-rectangle-form button[type=submit]').click();
    await idle(page);
    await page.locator('#close-authoring').click();
    await page.locator('#add-text').click();
    assert.equal(
      await page.locator('#add-text-form [name=text]').inputValue(),
      'Keep my text draft',
    );
    assert.equal(await page.locator('#authoring-conflict').isVisible(), true);
    assert.equal(await page.locator('#add-text-form button[type=submit]').isDisabled(), true);
    assert.equal(writes(loaded.state).length, 1);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

test('portable form drafts survive a PC change and require explicit review before applying', async () => {
  const loaded = await loadTouch(browser, 'app');
  const page = loaded.surface;
  try {
    await page.locator('#add-shape').click();
    const form = page.locator('#add-rectangle-form');
    await form.locator('[name=widthMm]').fill('19.75');
    loaded.state.revision++;
    await page.locator('#refresh').click();
    await idle(page);
    assert.equal(await form.locator('[name=widthMm]').inputValue(), '19.75');
    assert.equal(await page.locator('#authoring-conflict').isVisible(), true);
    assert.equal(await form.locator('button[type=submit]').isDisabled(), true);
    await form.dispatchEvent('submit');
    await idle(page);
    assert.equal(writes(loaded.state).length, 0);
    await page.locator('#review-authoring').click();
    await form.locator('button[type=submit]').click();
    await idle(page);
    assert.equal(writes(loaded.state).length, 1);
    assert.equal(writes(loaded.state)[0].args.expectedRevision, 'fixture-2');
    assert.equal(writes(loaded.state)[0].args.widthMm, 19.75);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

for (const mode of ['read-only', 'display-only']) {
  test(`portable ${mode} view exposes creation help but never sends an edit`, async () => {
    const state = touchFixture();
    if (mode === 'read-only') state.scopes = ['read'];
    else {
      state.displayOnly = true;
      state.sharing = false;
    }
    const loaded = await loadTouch(browser, 'app', state);
    const page = loaded.surface;
    try {
      await page.locator('#add-text').click();
      assert.equal(await page.locator('#authoring-sheet').isVisible(), true);
      assert.equal(await page.locator('#add-text-form textarea').isDisabled(), true);
      assert.equal(await page.locator('#add-text-form button[type=submit]').isDisabled(), true);
      assert.match(await page.locator('#authoring-access').innerText(), /permission|interactive/);
      await page.locator('#add-text-form').dispatchEvent('submit');
      await idle(page);
      assert.equal(writes(state).length, 0);
      assert.deepEqual(loaded.errors, []);
    } finally {
      await loaded.context.close();
    }
  });
}

test('portable uncertain creation retries the same request instead of creating a second shape', async () => {
  const state = touchFixture();
  state.dropNextWrite = true;
  let sent;
  const requested = new Promise((resolve) => {
    sent = resolve;
  });
  state.onWrite = () => sent();
  const loaded = await loadTouch(browser, 'app', state);
  const page = loaded.surface;
  try {
    await page.locator('#add-shape').click();
    await page.locator('#add-rectangle-form [name=widthMm]').fill('14');
    await page.locator('#add-rectangle-form button[type=submit]').click();
    await requested;
    await loaded.page.clock.fastForward(30_050);
    await idle(page);
    assert.equal(state.edits, 1);
    assert.equal(await page.locator('#authoring-retry').isVisible(), true);
    await page.locator('#authoring-retry').click();
    await idle(page);
    const requests = writes(state);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].args.requestId, requests[1].args.requestId);
    assert.equal(state.edits, 1);
    assert.equal(await page.locator('#retry').isHidden(), true);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});
