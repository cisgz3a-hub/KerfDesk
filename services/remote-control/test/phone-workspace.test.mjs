import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { capture, fixtureState, idle, phonePage } from './phone-workspace-support.mjs';

let browser;
before(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
after(async () => {
  await browser?.close();
});

test('phone workspace: bounded preview, job summary, literal untrusted text, no machining canvas', async () => {
  const loaded = await phonePage(browser);
  try {
    const { page, errors } = loaded;
    assert.equal(await page.locator('canvas').count(), 0);
    assert.equal(await page.locator('#workspace-preview').isVisible(), true);
    assert.match(
      await page.locator('#workspace-preview').getAttribute('src'),
      /^data:image\/png;base64,/,
    );
    assert.equal(await page.locator('#artwork-list script').count(), 0);
    assert.match(
      await page.locator('#artwork-list').textContent(),
      /<script>literal artwork<\/script>/,
    );
    await page.getByRole('button', { name: 'Details', exact: true }).click();
    assert.match(await page.locator('#details-list').textContent(), /Estimated 2 min/);
    assert.match(await page.locator('#details-list').textContent(), /50\.00 × 40\.00 mm/);
    assert.equal(await page.locator('#details-list script').count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await loaded.context.close();
  }
});

test('phone text: searchable bounded fonts, keyboard selection, existing text and numeric drafts', async () => {
  const loaded = await phonePage(browser);
  try {
    const { page, state } = loaded;
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.locator('#text-form [name=fontSearch]').fill('serif');
    const font = page.locator('#text-form [name=fontId]');
    assert.equal(await font.locator('option').count(), 2);
    await font.focus();
    await font.press('End');
    assert.equal(await font.inputValue(), 'serif');
    assert.ok((await font.boundingBox()).height <= 160);
    await page.locator('#text-form [name=fontSearch]').fill('script');
    assert.equal(await font.inputValue(), 'serif', 'Searching does not change the selected font');
    assert.equal(await font.locator('img').count(), 0);
    await page.getByRole('button', { name: 'Load text from PC', exact: true }).click();
    await idle(page);
    const form = page.locator('#text-edit-form');
    assert.equal(await form.locator('[name=text]').inputValue(), 'MCP test');
    await form.locator('[name=fontSearch]').fill('serif');
    await form.locator('[name=fontId]').selectOption('serif');
    const spacing = form.locator('[name=letterSpacing]');
    for (const draft of ['', '-', '-.', '-.5']) {
      await spacing.fill(draft);
      assert.equal(await spacing.inputValue(), draft);
    }
    await form.locator('[name=text]').fill('Phone edited text');
    await form.locator('[name=alignment]').selectOption('center');
    await page.getByRole('button', { name: 'Update text', exact: true }).click();
    await idle(page);
    const write = state.commands.find((item) => item.name === 'update_text');
    assert.equal(write.args.artworkId, 'text-1');
    assert.equal(write.args.patch.text, 'Phone edited text');
    assert.equal(write.args.patch.fontId, 'serif');
    assert.equal(write.args.patch.letterSpacing, -0.5);
    assert.equal(write.args.patch.alignment, 'center');
    assert.match(write.args.requestId, /^[0-9a-f-]{36}$/);
    await capture(page, 'phone-text-controls-fixture');
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

test('phone number fields: first digit deletion, empty replacement and submit-only range validation', async () => {
  const loaded = await phonePage(browser);
  try {
    const { page, state } = loaded;
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const power = page.locator('#operation-form [name=powerPercent]');
    await power.press('Home');
    await power.press('Delete');
    assert.equal(await power.inputValue(), '5');
    await power.fill('');
    assert.equal(await power.inputValue(), '');
    await power.pressSequentially('100');
    assert.equal(await power.inputValue(), '100');
    const speed = page.locator('#operation-form [name=speedMmPerMin]');
    await speed.fill('-');
    await page.getByRole('button', { name: 'Apply settings' }).click();
    await idle(page);
    assert.equal(await speed.inputValue(), '-');
    assert.equal(state.edits, 0);
    assert.match(await page.locator('#notice').textContent(), /valid number/);
    await speed.fill('1200.5');
    await power.fill('101');
    await page.getByRole('button', { name: 'Apply settings' }).click();
    await idle(page);
    assert.equal(state.edits, 0);
    assert.match(await page.locator('#notice').textContent(), /between 0 and 100/);
    await power.fill('100');
    await page.getByRole('button', { name: 'Apply settings' }).click();
    await idle(page);
    const write = state.commands.find((item) => item.name === 'update_operation');
    assert.equal(write.args.patch.powerPercent, 100);
    assert.equal(write.args.patch.speedMmPerMin, 1200.5);
  } finally {
    await loaded.context.close();
  }
});

test('phone text: unchanged embedded fonts are preserved and unchanged fields are not sent', async () => {
  const state = fixtureState();
  state.text.fontId = 'embedded-private-font';
  const loaded = await phonePage(browser, state);
  try {
    const { page } = loaded;
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('button', { name: 'Load text from PC', exact: true }).click();
    await idle(page);
    const form = page.locator('#text-edit-form');
    const current = form.locator('[name=fontId] option[value="embedded-private-font"]');
    assert.equal(await current.evaluate((option) => option.disabled), true);
    await form.locator('[name=text]').fill('New wording only');
    await page.getByRole('button', { name: 'Update text', exact: true }).click();
    await idle(page);
    const write = state.commands.find((item) => item.name === 'update_text');
    assert.deepEqual(write.args.patch, { text: 'New wording only' });
    assert.equal(state.text.fontId, 'embedded-private-font');
  } finally {
    await loaded.context.close();
  }
});

test('phone layout and history: selected IDs, equal-centre distribution, Undo then Redo', async () => {
  const loaded = await phonePage(browser);
  try {
    const { page, state } = loaded;
    await page.locator('#artwork-list input[value="rectangle-1"]').check();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.locator('#arrange-form [name=action]').selectOption('distribute_horizontal');
    await page.getByRole('button', { name: 'Apply layout action' }).click();
    await idle(page);
    const write = state.commands.find((item) => item.name === 'arrange_artwork');
    assert.deepEqual(write.args.artworkIds, ['text-1', 'rectangle-1']);
    assert.equal(write.args.action, 'distribute_horizontal');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await idle(page);
    assert.equal(await page.getByRole('button', { name: 'Undo', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Redo', exact: true }).isEnabled(), true);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await idle(page);
    assert.equal(state.edits, 3);
    assert.deepEqual(
      state.commands
        .filter((item) => ['undo', 'redo'].includes(item.name))
        .map((item) => item.name),
      ['undo', 'redo'],
    );
  } finally {
    await loaded.context.close();
  }
});

test('phone edits: stale response requires refresh and preserves unfinished form values', async () => {
  const loaded = await phonePage(browser);
  try {
    const { page, state } = loaded;
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.locator('#move-form [name=dxMm]').fill('2.5');
    await page.locator('#rectangle-form [name=widthMm]').fill('-');
    state.revision += 1;
    await page.getByRole('button', { name: 'Move selection' }).click();
    await idle(page);
    assert.match(await page.locator('#notice').textContent(), /workspace changed/);
    assert.equal(await page.locator('#move-form [name=dxMm]').inputValue(), '2.5');
    assert.equal(await page.locator('#rectangle-form [name=widthMm]').inputValue(), '-');
    assert.equal(await page.getByRole('button', { name: 'Move selection' }).isDisabled(), true);
    assert.equal(state.edits, 0);
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await idle(page);
    await page.getByRole('button', { name: 'Move selection' }).click();
    await idle(page);
    assert.equal(state.edits, 1);
    const writes = state.commands.filter((item) => item.name === 'transform_artwork');
    assert.equal(writes[1].args.expectedRevision, 'fixture-2');
    assert.notEqual(writes[0].args.requestId, writes[1].args.requestId);
  } finally {
    await loaded.context.close();
  }
});

test('phone edits: an uncertain result retains exactly the same ID and args on retry', async () => {
  const loaded = await phonePage(browser);
  try {
    const { page, state } = loaded;
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    state.dropNextWrite = true;
    await page.getByRole('button', { name: 'Add rectangle', exact: true }).click();
    await idle(page);
    assert.equal(state.edits, 1);
    assert.equal(await page.locator('#retry-edit').isVisible(), true);
    assert.equal(
      await page.getByRole('button', { name: 'Add rectangle', exact: true }).isDisabled(),
      true,
    );
    await page.getByRole('button', { name: 'Retry last request', exact: true }).click();
    await idle(page);
    assert.equal(state.edits, 1);
    const writes = state.commands.filter((item) => item.name === 'add_rectangle');
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[0].args, writes[1].args);
    assert.equal(await page.locator('#retry-edit').isHidden(), true);
  } finally {
    await loaded.context.close();
  }
});

for (const change of ['revoke', 'view-only', 'replace-client'])
  test(`phone permission change: ${change} prevents a pending edit before delivery`, async () => {
    const loaded = await phonePage(browser);
    try {
      const { page, state } = loaded;
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      if (change === 'revoke') state.revoked = true;
      if (change === 'view-only') state.scopes = ['read'];
      if (change === 'replace-client') state.clientId = 'replacement-fixture';
      await page.getByRole('button', { name: 'Add rectangle', exact: true }).click();
      await idle(page);
      assert.equal(state.edits, 0);
      assert.equal(
        state.commands.some((item) => item.name === 'add_rectangle'),
        false,
      );
      if (change === 'revoke') {
        assert.equal(await page.locator('#workspace-area').isHidden(), true);
        assert.equal(await page.locator('#workspace-preview').getAttribute('src'), null);
        assert.equal(await page.locator('#workspace-name').textContent(), '');
      } else assert.equal(await page.locator('#edit-forms').isHidden(), true);
    } finally {
      await loaded.context.close();
    }
  });

test('phone sharing off: preview explains opt-in and text cannot be loaded', async () => {
  const state = fixtureState();
  state.sharing = false;
  const loaded = await phonePage(browser, state);
  try {
    const { page } = loaded;
    assert.equal(await page.locator('#workspace-preview').isHidden(), true);
    assert.match(await page.locator('#preview-message').textContent(), /Sharing|sharing is off/);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    assert.equal(
      await page.getByRole('button', { name: 'Load text from PC', exact: true }).isDisabled(),
      true,
    );
    assert.equal(
      state.commands.some((item) => item.name === 'get_text'),
      false,
    );
  } finally {
    await loaded.context.close();
  }
});

for (const kind of ['svg', 'oversize', 'mismatched-png'])
  test(`phone malformed preview: ${kind} is not rendered or fetched`, async () => {
    const state = fixtureState();
    if (kind === 'svg')
      state.preview = {
        mimeType: 'image/svg+xml',
        data: '<svg onload=alert(1)>',
        widthPx: 10,
        heightPx: 10,
      };
    if (kind === 'oversize')
      state.preview = { mimeType: 'image/png', data: 'A'.repeat(65540), widthPx: 10, heightPx: 10 };
    if (kind === 'mismatched-png')
      state.preview = {
        mimeType: 'image/png',
        data: (await import('./phone-workspace-support.mjs')).ONE_PIXEL_PNG,
        widthPx: 1024,
        heightPx: 1024,
      };
    const loaded = await phonePage(browser, state);
    try {
      assert.equal(await loaded.page.locator('#workspace-preview').getAttribute('src'), null);
      assert.equal(await loaded.page.locator('#workspace-preview').isHidden(), true);
      assert.deepEqual(loaded.errors, []);
    } finally {
      await loaded.context.close();
    }
  });

test('phone malformed workspace: fails closed and cannot edit a retained old snapshot', async () => {
  const loaded = await phonePage(browser);
  try {
    loaded.state.malformed = true;
    await loaded.page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await idle(loaded.page);
    assert.match(await loaded.page.locator('#notice').textContent(), /response is incomplete/);
    await loaded.page.getByRole('button', { name: 'Edit', exact: true }).click();
    assert.equal(
      await loaded.page.getByRole('button', { name: 'Add rectangle', exact: true }).isDisabled(),
      true,
    );
    assert.equal(loaded.state.edits, 0);
  } finally {
    await loaded.context.close();
  }
});

for (const width of [320, 390, 768])
  test(`phone layout fits a ${width}px viewport with keyboard focus`, async () => {
    const loaded = await phonePage(browser, fixtureState(), width);
    try {
      const { page } = loaded;
      const size = await page.evaluate(() => ({
        client: globalThis.document.documentElement.clientWidth,
        scroll: globalThis.document.documentElement.scrollWidth,
      }));
      assert.ok(size.scroll <= size.client);
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      const search = page.locator('#text-form [name=fontSearch]');
      await search.focus();
      await search.press('Tab');
      assert.equal(
        await page
          .locator('#text-form [name=fontId]')
          .evaluate((element) => element === globalThis.document.activeElement),
        true,
      );
      assert.ok((await page.locator('#text-form [name=fontId]').boundingBox()).height <= 160);
      if (width === 390) await capture(page, 'phone-mobile-layout-fixture');
    } finally {
      await loaded.context.close();
    }
  });
