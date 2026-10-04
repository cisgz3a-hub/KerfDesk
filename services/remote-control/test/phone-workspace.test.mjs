import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import {
  capture,
  fixtureState,
  idle,
  openTask,
  phonePage,
  visualState,
} from './phone-workspace-support.mjs';

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
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
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
    await openTask(page, 'add-text-task');
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
    await openTask(page, 'edit-text-task');
    await page.getByRole('button', { name: 'Load text from PC', exact: true }).click();
    await idle(page);
    const form = page.locator('#text-edit-form');
    assert.equal(await form.locator('[name=text]').inputValue(), 'MCP test');
    await openTask(page, 'text-fonts');
    await form.locator('[name=fontSearch]').fill('serif');
    await form.locator('[name=fontId]').selectOption('serif');
    await openTask(page, 'text-spacing');
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
    await openTask(page, 'operation-task');
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
    await openTask(page, 'edit-text-task');
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
    await openTask(page, 'arrange-task');
    assert.equal(await page.locator('#editor-sheet #history-controls').count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Undo', exact: true }).count(), 1);
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
    await page.locator('#close-editor').click();
    assert.equal(await page.locator('#history-home #history-controls').count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Undo', exact: true }).isVisible(), true);
  } finally {
    await loaded.context.close();
  }
});

test('phone edits: stale response requires refresh and preserves unfinished form values', async () => {
  const loaded = await phonePage(browser);
  try {
    const { page, state } = loaded;
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await openTask(page, 'arrange-task');
    await openTask(page, 'rectangle-task');
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
    assert.equal(await page.getByRole('button', { name: 'Move selection' }).isDisabled(), true);
    assert.equal(await page.locator('#move-form [name=dxMm]').inputValue(), '2.5');
    await page.getByRole('button', { name: 'Discard drafts and refresh', exact: true }).click();
    await idle(page);
    await page.locator('#move-form [name=dxMm]').fill('2.5');
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
    await openTask(page, 'rectangle-task');
    state.dropNextWrite = true;
    await page.getByRole('button', { name: 'Add rectangle', exact: true }).click();
    await idle(page);
    assert.equal(state.edits, 1);
    assert.equal(await page.locator('#editor-retry').isVisible(), true);
    assert.equal(await page.locator('#retry-edit').isHidden(), true);
    assert.equal(
      await page.getByRole('button', { name: 'Add rectangle', exact: true }).isDisabled(),
      true,
    );
    await page.locator('#close-editor').click();
    assert.equal(await page.locator('#retry-edit').isVisible(), true);
    assert.equal(await page.locator('#editor-retry').isHidden(), true);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    assert.equal(await page.locator('#retry-edit').isHidden(), true);
    assert.equal(await page.locator('#editor-retry').isVisible(), true);
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
      await openTask(page, 'rectangle-task');
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
    await openTask(page, 'edit-text-task');
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
    await openTask(loaded.page, 'rectangle-task');
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
      await openTask(page, 'add-text-task');
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

test('phone usability: selection leads straight to loaded text, keyboard task disclosure and hidden invalid fields recover', async () => {
  const loaded = await phonePage(browser);
  try {
    const { page, state } = loaded;
    assert.equal(await page.locator('.intro').isHidden(), true);
    assert.match(await page.locator('#selection-status').textContent(), /1 selected/);
    await page.getByRole('button', { name: 'Edit selected text', exact: true }).click();
    await idle(page);
    assert.equal(await page.locator('#workspace-preview').isVisible(), true);
    assert.equal(await page.locator('#text-editor').isVisible(), true);
    assert.equal(
      await page
        .locator('#text-edit-form [name=text]')
        .evaluate((item) => item === globalThis.document.activeElement),
      true,
    );
    assert.equal(state.commands.filter((item) => item.name === 'get_text').length, 1);
    assert.equal(state.edits, 0);
    const summary = page.locator('#text-spacing > summary');
    await summary.focus();
    await summary.press('Enter');
    const lineHeight = page.locator('#text-edit-form [name=lineHeight]');
    await lineHeight.fill('');
    await summary.click();
    assert.equal(await lineHeight.isHidden(), true);
    await page.getByRole('button', { name: 'Update text', exact: true }).click();
    assert.equal(await lineHeight.isVisible(), true);
    assert.equal(
      await lineHeight.evaluate((item) => item === globalThis.document.activeElement),
      true,
    );
    assert.equal(await lineHeight.inputValue(), '');
    assert.equal(state.edits, 0);
    await lineHeight.fill('-.');
    await page.getByRole('button', { name: 'Update text', exact: true }).click();
    await idle(page);
    assert.equal(await lineHeight.inputValue(), '-.');
    assert.match(await page.locator('#notice').textContent(), /valid number/);
    assert.equal(state.edits, 0);
  } finally {
    await loaded.context.close();
  }
});

test('phone usability: a long font list scrolls inside its picker and keeps the chosen font when searching', async () => {
  const state = fixtureState();
  state.fonts = Array.from({ length: 80 }, (_, index) => ({
    id: `font-${index}`,
    name: `Bundled font ${String(index).padStart(2, '0')}`,
    style: 'sans',
    geometry: 'outline',
  }));
  const loaded = await phonePage(browser, state, 320);
  try {
    const { page } = loaded;
    await page.getByRole('button', { name: 'Edit selected text', exact: true }).click();
    await idle(page);
    await openTask(page, 'text-fonts');
    const font = page.locator('#text-edit-form [name=fontId]');
    await font.selectOption('font-40');
    await font.focus();
    await font.press('End');
    assert.equal(await font.inputValue(), 'font-79');
    assert.ok(await font.evaluate((element) => element.scrollTop > 0));
    assert.ok((await font.boundingBox()).height <= 160);
    await page.locator('#text-edit-form [name=fontSearch]').fill('font 01');
    assert.equal(await font.inputValue(), 'font-79');
    assert.equal(await font.locator('option').count(), 3);
    assert.equal(state.edits, 0);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

test('phone usability: older desktop permission hints do not grant edits and clearly request a PC update', async () => {
  const state = fixtureState();
  state.oldDesktop = true;
  const loaded = await phonePage(browser, state);
  try {
    assert.equal(await loaded.page.locator('#readonly-note').isVisible(), true);
    assert.equal(await loaded.page.locator('#readonly-title').textContent(), 'Update the PC app');
    assert.match(
      await loaded.page.locator('#readonly-message').textContent(),
      /cannot confirm editing access.*Update KerfDesk/,
    );
    assert.equal(await loaded.page.locator('#artwork-list input:enabled').count(), 0);
    await loaded.page.getByRole('button', { name: 'Edit', exact: true }).click();
    assert.equal(await loaded.page.locator('#edit-forms').isHidden(), true);
    assert.equal(state.edits, 0);
  } finally {
    await loaded.context.close();
  }
});

test('phone usability: choosing another text clears the draft and returns keyboard focus to the chooser', async () => {
  const loaded = await phonePage(browser);
  try {
    await loaded.page.getByRole('button', { name: 'Edit selected text', exact: true }).click();
    await idle(loaded.page);
    assert.equal(await loaded.page.locator('#text-source-controls').isHidden(), true);
    await loaded.page.locator('#text-edit-form [name=text]').fill('Draft only');
    await loaded.page.getByRole('button', { name: 'Choose another text', exact: true }).click();
    assert.equal(await loaded.page.locator('#text-source-controls').isVisible(), true);
    assert.equal(await loaded.page.locator('#text-editor').isHidden(), true);
    assert.equal(await loaded.page.locator('#text-edit-form [name=text]').inputValue(), '');
    assert.equal(
      await loaded.page
        .locator('#text-artwork-list')
        .evaluate((item) => item === globalThis.document.activeElement),
      true,
    );
    assert.equal(loaded.state.edits, 0);
  } finally {
    await loaded.context.close();
  }
});

test('phone draft resume: the same artwork and revision retain text, font and partial numbers without another read', async () => {
  const loaded = await phonePage(browser);
  try {
    const { page, state } = loaded;
    const form = page.locator('#text-edit-form');
    await page.getByRole('button', { name: 'Edit selected text', exact: true }).click();
    await idle(page);
    await form.locator('[name=text]').fill('DRAFT_UNSENT');
    await openTask(page, 'text-fonts');
    await form.locator('[name=fontId]').selectOption('serif');
    await form.locator('[name=fontSearch]').fill('script');
    await openTask(page, 'text-spacing');
    const drafts = { fontSizeMm: '', alignment: 'center', lineHeight: '-.', letterSpacing: '-' };
    await form.locator('[name=alignment]').selectOption(drafts.alignment);
    for (const name of ['fontSizeMm', 'lineHeight', 'letterSpacing'])
      await form.locator(`[name=${name}]`).fill(drafts[name]);
    await page.getByRole('button', { name: 'Design', exact: true }).click();
    await page.getByRole('button', { name: 'Edit selected text', exact: true }).click();
    await idle(page);
    assert.equal(await form.locator('[name=text]').inputValue(), 'DRAFT_UNSENT');
    assert.equal(await form.locator('[name=fontId]').inputValue(), 'serif');
    assert.equal(await form.locator('[name=fontSearch]').inputValue(), 'script');
    for (const [name, value] of Object.entries(drafts))
      assert.equal(await form.locator(`[name=${name}]`).inputValue(), value);
    assert.equal(
      await form
        .locator('[name=text]')
        .evaluate((item) => item === globalThis.document.activeElement),
      true,
    );
    assert.equal(state.commands.filter((item) => item.name === 'get_text').length, 1);
    assert.equal(state.edits, 0);
    await page.getByRole('button', { name: 'Choose another text', exact: true }).click();
    await openTask(page, 'edit-text-task');
    await page.getByRole('button', { name: 'Load text from PC', exact: true }).click();
    await idle(page);
    assert.equal(await form.locator('[name=text]').inputValue(), 'MCP test');
    assert.equal(await form.locator('[name=fontSizeMm]').inputValue(), '10');
    assert.equal(await form.locator('[name=fontId]').inputValue(), 'sans');
    assert.equal(state.commands.filter((item) => item.name === 'get_text').length, 2);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

test('phone draft resume: target change loads current text and a newer PC revision keeps the unsent draft until explicit discard', async () => {
  const state = fixtureState();
  state.extraText = { ...state.text, artworkId: 'text-2', text: 'Second artwork', fontSizeMm: 6 };
  const loaded = await phonePage(browser, state);
  try {
    const { page } = loaded;
    const form = page.locator('#text-edit-form');
    await page.getByRole('button', { name: 'Edit selected text', exact: true }).click();
    await idle(page);
    await form.locator('[name=text]').fill('First unsent draft');
    await page.getByRole('button', { name: 'Design', exact: true }).click();
    await page.locator('#artwork-list input[value="text-1"]').uncheck();
    await page.locator('#artwork-list input[value="text-2"]').check();
    await page.getByRole('button', { name: 'Edit selected text', exact: true }).click();
    await idle(page);
    assert.equal(await form.locator('[name=text]').inputValue(), 'Second artwork');
    assert.equal(await form.locator('[name=fontSizeMm]').inputValue(), '6');
    assert.deepEqual(
      state.commands.filter((item) => item.name === 'get_text').map((item) => item.args.artworkId),
      ['text-1', 'text-2'],
    );
    await form.locator('[name=text]').fill('Second unsent draft');
    state.revision += 1;
    state.text.text = 'Changed on PC';
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await idle(page);
    assert.equal(await page.locator('#text-editor').isHidden(), false);
    assert.equal(await form.locator('[name=text]').inputValue(), 'Second unsent draft');
    assert.equal(
      await page.getByRole('button', { name: 'Update text', exact: true }).isDisabled(),
      true,
    );
    await page.getByRole('button', { name: 'Discard drafts and refresh', exact: true }).click();
    await idle(page);
    assert.equal(await page.locator('#text-editor').isHidden(), true);
    assert.equal(await form.locator('[name=text]').inputValue(), '');
    await page.getByRole('button', { name: 'Design', exact: true }).click();
    await page.getByRole('button', { name: 'Edit selected text', exact: true }).click();
    await idle(page);
    assert.equal(await form.locator('[name=text]').inputValue(), 'Changed on PC');
    assert.equal(state.commands.filter((item) => item.name === 'get_text').length, 3);
    assert.equal(state.edits, 0);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

test('phone usability: empty, viewing-only, sharing-off and renewed opt-out explain the next step without leaking loaded text', async () => {
  const empty = fixtureState();
  empty.empty = true;
  empty.history = { canUndo: false, canRedo: false };
  const loaded = await phonePage(browser, empty);
  try {
    assert.match(await loaded.page.locator('#artwork-list').textContent(), /Open Edit/);
    assert.match(await loaded.page.locator('#history-status').textContent(), /No changes/);
    await loaded.page.getByRole('button', { name: 'Edit', exact: true }).click();
    assert.match(await loaded.page.locator('#text-load-status').textContent(), /No text yet/);
    assert.equal(await loaded.page.locator('#text-editor').isHidden(), true);
  } finally {
    await loaded.context.close();
  }
  const state = fixtureState();
  state.scopes = ['read'];
  const readonly = await phonePage(browser, state);
  try {
    assert.equal(await readonly.page.locator('#readonly-note').isVisible(), true);
    assert.match(
      await readonly.page.locator('#readonly-message').textContent(),
      /editing permission/,
    );
    assert.equal(await readonly.page.locator('#edit-selected-text').isHidden(), true);
    assert.equal(state.edits, 0);
  } finally {
    await readonly.context.close();
  }
  const optOut = await phonePage(browser);
  try {
    await optOut.page.getByRole('button', { name: 'Edit selected text', exact: true }).click();
    await idle(optOut.page);
    optOut.state.sharing = false;
    await optOut.page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await idle(optOut.page);
    assert.equal(await optOut.page.locator('#text-editor').isHidden(), true);
    assert.equal(await optOut.page.locator('#text-edit-form [name=text]').inputValue(), '');
    assert.equal(await optOut.page.locator('#text-sharing-note').isVisible(), true);
    assert.equal(await optOut.page.locator('#load-text').isDisabled(), true);
    assert.equal(optOut.state.edits, 0);
  } finally {
    await optOut.context.close();
  }
});

for (const width of [320, 390])
  test(`phone usability: readable controls, comfortable taps and task layouts fit ${width}px`, async () => {
    const loaded = await phonePage(browser, await visualState(), width);
    try {
      const { page, state } = loaded;
      await page.waitForFunction(
        () => globalThis.document.getElementById('workspace-preview').naturalWidth > 0,
      );
      assert.equal(
        await page.locator('#workspace-preview').evaluate((item) => item.naturalWidth),
        state.preview?.widthPx ?? 1,
      );
      assert.ok((await page.locator('.workspace-heading').boundingBox()).y < 120);
      for (const selector of ['#refresh', '#undo', '[data-view=edit]', '#edit-selected-text'])
        assert.ok((await page.locator(selector).boundingBox()).height >= 48);
      await capture(page, `phone-artwork-${width}-layout-fixture`);
      await page.getByRole('button', { name: 'Edit selected text', exact: true }).click();
      await idle(page);
      assert.equal(await page.locator('#add-text-task').getAttribute('open'), null);
      assert.equal(await page.locator('#rectangle-task').getAttribute('open'), null);
      for (const selector of ['#text-edit-form [name=text]', '#text-edit-form [name=fontSizeMm]'])
        assert.ok(
          await page
            .locator(selector)
            .evaluate((element) => parseFloat(globalThis.getComputedStyle(element).fontSize) >= 16),
        );
      assert.ok(
        await page.evaluate(
          () =>
            globalThis.document.documentElement.scrollWidth <=
            globalThis.document.documentElement.clientWidth,
        ),
      );
      await capture(page, `phone-edit-${width}-layout-fixture`);
      await openTask(page, 'text-fonts');
      await capture(page, `phone-fonts-${width}-layout-fixture`);
      assert.deepEqual(loaded.errors, []);
    } finally {
      await loaded.context.close();
    }
  });
