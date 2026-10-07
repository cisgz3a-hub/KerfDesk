import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from '@playwright/test';
import { appPage } from './workspace-ui-support.mjs';
import { fixtureState, idle, openTask, phonePage, workspace } from './phone-workspace-support.mjs';

let browser;
before(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
after(async () => {
  await browser?.close();
});

function groupedFixture(fallback) {
  const state = fixtureState();
  state.readHook = (name) => {
    if (name !== 'get_workspace') return null;
    const value = workspace(state);
    value.selection = ['rectangle-1'];
    value.artwork = ['rectangle-1', 'group-peer'].map((id, index) => ({
      id,
      type: 'shape',
      visible: true,
      editable: true,
      bounds: { xMm: index * 20, yMm: 0, widthMm: 10, heightMm: 20 },
      ...(fallback ? {} : { transformBounds: { xMm: 0, yMm: 0, widthMm: 30, heightMm: 20 } }),
    }));
    if (fallback === 'legacy') delete value.capabilities.groupTransformBounds;
    return { result: value };
  };
  return state;
}

test('embedded Properties renders complete group dimensions and submits the unchanged target', async () => {
  const state = groupedFixture();
  const loaded = await appPage(browser, state);
  try {
    const page = loaded.frame;
    await page.locator('#properties').click();
    assert.equal(await page.locator('#resize-form [name=widthMm]').inputValue(), '30');
    assert.equal(await page.locator('#resize-form [name=heightMm]').inputValue(), '20');
    assert.match(await page.locator('#authoring-selection').innerText(), /every member of a group/);
    await page.locator('#resize-form button[type=submit]').click();
    await idle(page);
    const requests = state.commands.filter((item) => item.args.requestId);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].args.artworkIds, ['rectangle-1']);
    assert.deepEqual(requests[0].args.transform, { type: 'resize', widthMm: 30, heightMm: 20 });
    assert.equal(requests[0].args.expectedRevision, 'fixture-1');
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

for (const fallback of ['legacy', 'missing-hint']) {
  test(`embedded ${fallback} result disables resize with a bounded explanation`, async () => {
    const state = groupedFixture(fallback);
    const loaded = await appPage(browser, state);
    try {
      const page = loaded.frame;
      await page.locator('#properties').click();
      assert.equal(await page.locator('#resize-form [name=widthMm]').inputValue(), '');
      assert.equal(await page.locator('#resize-form [name=widthMm]').isDisabled(), true);
      assert.equal(await page.locator('#resize-form button[type=submit]').isDisabled(), true);
      assert.match(
        await page.locator('#authoring-selection').innerText(),
        fallback === 'legacy' ? /Update KerfDesk on the PC/ : /Resize is unavailable/,
      );
      await page.locator('#resize-form').dispatchEvent('submit');
      await idle(page);
      assert.equal(state.commands.filter((item) => item.args.requestId).length, 0);
      assert.deepEqual(loaded.errors, []);
    } finally {
      await loaded.context.close();
    }
  });
}

test('phone Resize keeps empty dimensions and an empty submit sends no edit with complete-target hints present', async () => {
  const state = groupedFixture();
  const loaded = await phonePage(browser, state);
  try {
    const page = loaded.page;
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await openTask(page, 'arrange-task');
    assert.equal(await page.locator('#resize-form [name=widthMm]').inputValue(), '');
    assert.equal(await page.locator('#resize-form [name=heightMm]').inputValue(), '');
    await page.locator('#resize-form').dispatchEvent('submit');
    await idle(page);
    assert.equal(state.commands.filter((item) => item.args.requestId).length, 0);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});
