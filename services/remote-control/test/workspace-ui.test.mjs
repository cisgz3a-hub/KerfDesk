import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { appPage, notification } from './workspace-ui-support.mjs';
import {
  capture,
  fixtureState,
  idle,
  readResult,
  visualState,
  workspace,
} from './phone-workspace-support.mjs';

let browser;
before(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
after(async () => {
  await browser?.close();
});

test('MCP Apps: standard initialization, calls, bounded preview and selection/Undo/Redo', async () => {
  const loaded = await appPage(browser);
  try {
    const { frame, state, rpc } = loaded;
    assert.equal(rpc[0].method, 'ui/initialize');
    assert.equal(rpc[0].params.protocolVersion, '2026-01-26');
    assert.equal(await frame.locator('#preview').isVisible(), true);
    assert.equal(await frame.locator('#items script').count(), 0);
    assert.match(await frame.locator('#items').textContent(), /<script>literal artwork/);
    await frame.locator('input[value="rectangle-1"]').check();
    await frame.getByRole('button', { name: 'Use this selection', exact: true }).click();
    await idle(frame);
    const selection = state.commands.find((item) => item.name === 'set_selection');
    assert.deepEqual(selection.args.artworkIds, ['text-1', 'rectangle-1']);
    assert.equal(selection.args.expectedRevision, 'fixture-1');
    await frame.getByRole('button', { name: 'Undo', exact: true }).click();
    await idle(frame);
    await frame.getByRole('button', { name: 'Redo', exact: true }).click();
    await idle(frame);
    assert.equal(state.edits, 3);
    assert.equal(await frame.locator('canvas').count(), 0);
    assert.deepEqual(loaded.errors, []);
    await capture(loaded.page, 'portable-mcp-app-fixture');
  } finally {
    await loaded.context.close();
  }
});

test('MCP Apps: model tool result notifications replace the preview/workspace without trusting HTML', async () => {
  const loaded = await appPage(browser);
  try {
    const changed = workspace(loaded.state);
    changed.name = '<img src=x onerror=alert(1)>';
    await notification(loaded.page, changed);
    await loaded.frame.locator('#title').filter({ hasText: '<img src=x' }).waitFor();
    assert.equal(await loaded.frame.locator('#title img').count(), 0);
    await notification(loaded.page, { revision: 'fixture-1', status: 'disabled' });
    await loaded.frame.locator('#preview-message').filter({ hasText: 'Sharing is off' }).waitFor();
    assert.equal(await loaded.frame.locator('#preview').getAttribute('src'), null);
  } finally {
    await loaded.context.close();
  }
});

test('MCP Apps: display-only host still renders model results and never calls server tools', async () => {
  const state = fixtureState();
  state.displayOnly = true;
  const loaded = await appPage(browser, state);
  try {
    assert.equal(state.commands.length, 0);
    await notification(loaded.page, workspace(state));
    await loaded.frame.locator('#title').filter({ hasText: 'Phone workspace fixture' }).waitFor();
    assert.equal(
      await loaded.frame.getByRole('button', { name: 'Refresh', exact: true }).isDisabled(),
      true,
    );
    assert.equal(
      await loaded.frame.getByRole('button', { name: 'Undo', exact: true }).isDisabled(),
      true,
    );
    assert.equal(await loaded.frame.locator('#items input:enabled').count(), 0);
    assert.match(await loaded.frame.locator('#message').textContent(), /cannot call tools/);
  } finally {
    await loaded.context.close();
  }
});

test('MCP Apps: latched host origin rejects a same-window message from another origin', async () => {
  const loaded = await appPage(browser);
  try {
    await loaded.frame.evaluate(() => {
      globalThis.dispatchEvent(
        new MessageEvent('message', {
          source: globalThis.parent,
          origin: 'https://changed-host.test',
          data: {
            jsonrpc: '2.0',
            method: 'ui/notifications/tool-result',
            params: {
              structuredContent: {
                revision: 'wrong',
                artwork: [],
                selection: [],
                name: 'Changed parent origin',
              },
            },
          },
        }),
      );
    });
    assert.equal(await loaded.frame.locator('#title').textContent(), 'Phone workspace fixture');
    assert.equal(loaded.state.edits, 0);
  } finally {
    await loaded.context.close();
  }
});

test('MCP Apps: malformed workspace notification clears edit authority until a real refresh', async () => {
  const loaded = await appPage(browser);
  try {
    await notification(loaded.page, {
      revision: 'wrong',
      artwork: [],
      permissions: { canEdit: true },
    });
    await loaded.frame.locator('#message').filter({ hasText: 'could not be displayed' }).waitFor();
    assert.equal(
      await loaded.frame.getByRole('button', { name: 'Undo', exact: true }).isDisabled(),
      true,
    );
    assert.equal(await loaded.frame.locator('#preview').getAttribute('src'), null);
    await loaded.frame.getByRole('button', { name: 'Refresh', exact: true }).click();
    await idle(loaded.frame);
    assert.equal(await loaded.frame.locator('#title').textContent(), 'Phone workspace fixture');
    assert.equal(loaded.state.edits, 0);
  } finally {
    await loaded.context.close();
  }
});

test('MCP Apps: viewing-only and absent permission hints cannot issue writes', async () => {
  const state = fixtureState();
  state.scopes = ['read'];
  const loaded = await appPage(browser, state);
  try {
    assert.equal(
      await loaded.frame.getByRole('button', { name: 'Undo', exact: true }).isDisabled(),
      true,
    );
    assert.equal(await loaded.frame.locator('#items input:enabled').count(), 0);
    const changed = workspace(state);
    delete changed.permissions;
    await notification(loaded.page, changed);
    assert.equal(
      await loaded.frame
        .getByRole('button', { name: 'Use this selection', exact: true })
        .isDisabled(),
      true,
    );
    assert.match(
      await loaded.frame.locator('#access-note').textContent(),
      /cannot confirm editing access.*Update KerfDesk/,
    );
    assert.match(await loaded.frame.locator('#summary').textContent(), /Editing unavailable/);
    assert.equal(state.edits, 0);
  } finally {
    await loaded.context.close();
  }
});

test('MCP Apps: unrelated source or unknown response IDs cannot alter the workspace', async () => {
  const loaded = await appPage(browser);
  try {
    await loaded.frame.evaluate(() => {
      globalThis.dispatchEvent(
        new MessageEvent('message', {
          source: globalThis.window,
          data: {
            jsonrpc: '2.0',
            method: 'ui/notifications/tool-result',
            params: {
              structuredContent: {
                revision: 'wrong',
                artwork: [],
                selection: [],
                name: 'Untrusted sibling',
              },
            },
          },
        }),
      );
    });
    await loaded.page.evaluate(() => {
      globalThis.document.getElementById('widget').contentWindow.postMessage(
        {
          jsonrpc: '2.0',
          id: 99999,
          result: {
            structuredContent: {
              revision: 'wrong',
              artwork: [],
              selection: [],
              name: 'Unknown response',
            },
          },
        },
        '*',
      );
    });
    assert.equal(await loaded.frame.locator('#title').textContent(), 'Phone workspace fixture');
    assert.equal(loaded.state.edits, 0);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

test('MCP Apps: timed-out writes use the identical request ID on retry', async () => {
  const loaded = await appPage(browser);
  try {
    await loaded.page.clock.install();
    loaded.state.dropNextWrite = true;
    await loaded.frame.getByRole('button', { name: 'Undo', exact: true }).click();
    await loaded.page.waitForFunction(
      () =>
        globalThis.document
          .getElementById('widget')
          .contentDocument.body.getAttribute('aria-busy') === 'true',
    );
    await loaded.page.clock.fastForward(31000);
    await idle(loaded.frame);
    assert.equal(loaded.state.edits, 1);
    assert.equal(
      await loaded.frame
        .getByRole('button', { name: 'Retry last request', exact: true })
        .isVisible(),
      true,
    );
    await loaded.frame.getByRole('button', { name: 'Retry last request', exact: true }).click();
    await idle(loaded.frame);
    assert.equal(loaded.state.edits, 1);
    const writes = loaded.state.commands.filter((item) => item.name === 'undo');
    assert.deepEqual(writes[0].args, writes[1].args);
    await loaded.page.clock.resume();
  } finally {
    await loaded.context.close();
  }
});

test('MCP Apps: revocation clears private preview, text and selection controls', async () => {
  const loaded = await appPage(browser);
  try {
    loaded.state.revoked = true;
    await loaded.frame.getByRole('button', { name: 'Refresh', exact: true }).click();
    await idle(loaded.frame);
    assert.equal(await loaded.frame.locator('#preview').getAttribute('src'), null);
    assert.equal(await loaded.frame.locator('#items').textContent(), '');
    assert.equal(
      await loaded.frame.getByRole('button', { name: 'Undo', exact: true }).isDisabled(),
      true,
    );
    assert.match(await loaded.frame.locator('#message').textContent(), /revoked|reconnect/i);
    assert.equal(loaded.state.edits, 0);
  } finally {
    await loaded.context.close();
  }
});

test('MCP Apps privacy: cancelled access rejects late image/workspace notifications until a fresh permitted RPC read', async () => {
  const loaded = await appPage(browser, undefined, 390, { clock: true });
  try {
    const { page, frame, state } = loaded;
    const preview = readResult(state, 'get_workspace_preview');
    await page.evaluate(() =>
      globalThis.document.getElementById('widget').contentWindow.postMessage(
        {
          jsonrpc: '2.0',
          method: 'ui/notifications/tool-result',
          params: { isError: true, structuredContent: { error: { code: 'cancelled' } } },
        },
        '*',
      ),
    );
    await frame.locator('#summary').filter({ hasText: 'Refresh' }).waitFor();
    await notification(page, preview);
    await frame
      .locator('#preview-message')
      .filter({ hasText: 'Access needs refreshing' })
      .waitFor();
    assert.equal(await frame.locator('#preview').getAttribute('src'), null);
    await notification(page, workspace(state));
    await frame.locator('#title').filter({ hasText: 'Phone workspace fixture' }).waitFor();
    assert.equal(await frame.locator('#select').isDisabled(), true);
    await notification(page, preview);
    assert.equal(await frame.locator('#preview').getAttribute('src'), null);
    await frame.getByRole('button', { name: 'Refresh', exact: true }).click();
    await idle(frame);
    assert.equal(await frame.locator('#preview').isVisible(), true);
    assert.equal(await frame.locator('#select').isEnabled(), true);
    assert.equal(state.edits, 0);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

test('MCP Apps privacy: an initial display-only host can still show its first permitted preview without a workspace call', async () => {
  const state = fixtureState();
  state.displayOnly = true;
  const loaded = await appPage(browser, state);
  try {
    await notification(loaded.page, readResult(state, 'get_workspace_preview'));
    await loaded.frame.locator('#preview').waitFor();
    assert.equal(
      await loaded.frame.locator('#preview').evaluate((node) => node.naturalWidth > 0),
      true,
    );
    assert.equal(state.commands.length, 0);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

test('MCP Apps: malformed image and unsupported initialization remain inert', async () => {
  const loaded = await appPage(browser);
  try {
    await notification(loaded.page, {
      revision: 'fixture-1',
      status: 'ready',
      preview: {
        mimeType: 'image/svg+xml',
        data: '<svg onload=alert(1)>',
        widthPx: 1,
        heightPx: 1,
      },
    });
    await loaded.frame
      .locator('#preview-message')
      .filter({ hasText: 'Preview unavailable' })
      .waitFor();
    assert.equal(await loaded.frame.locator('#preview').getAttribute('src'), null);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
  const state = fixtureState();
  state.protocolVersion = 'unsupported';
  const invalid = await appPage(browser, state);
  try {
    assert.match(await invalid.frame.locator('#message').textContent(), /unsupported UI protocol/);
    assert.equal(state.commands.length, 0);
    assert.equal(
      await invalid.frame.getByRole('button', { name: 'Refresh', exact: true }).isDisabled(),
      true,
    );
  } finally {
    await invalid.context.close();
  }
});

test('MCP Apps: graceful host teardown acknowledges its ID and prevents later rendering or calls', async () => {
  const loaded = await appPage(browser);
  try {
    await loaded.page.evaluate(() => {
      globalThis.teardownAck = null;
      globalThis.addEventListener('message', (event) => {
        if (event.data.id === 'host-close-42' && event.data.result)
          globalThis.teardownAck = event.data;
      });
      globalThis.document
        .getElementById('widget')
        .contentWindow.postMessage(
          { jsonrpc: '2.0', id: 'host-close-42', method: 'ui/resource-teardown', params: {} },
          '*',
        );
    });
    await loaded.page.waitForFunction(() => globalThis.teardownAck?.id === 'host-close-42');
    assert.equal(await loaded.frame.locator('#preview').getAttribute('src'), null);
    assert.equal(await loaded.frame.locator('#items').textContent(), '');
    assert.equal(
      await loaded.frame.getByRole('button', { name: 'Refresh', exact: true }).isDisabled(),
      true,
    );
    await notification(loaded.page, workspace(loaded.state));
    assert.equal(await loaded.frame.locator('#title').textContent(), 'KerfDesk workspace');
    assert.equal(loaded.state.edits, 0);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

test('MCP Apps usability: empty history, empty workspace and viewing-only explain their next step', async () => {
  const state = fixtureState();
  state.empty = true;
  state.history = { canUndo: false, canRedo: false };
  const loaded = await appPage(browser, state);
  try {
    assert.match(await loaded.frame.locator('#items').textContent(), /Ask the assistant to add/);
    assert.match(await loaded.frame.locator('#history-status').textContent(), /No changes/);
    assert.equal(await loaded.frame.locator('#access-note').isHidden(), true);
    state.scopes = ['read'];
    await notification(loaded.page, workspace(state));
    assert.match(
      await loaded.frame.locator('#access-note').textContent(),
      /Viewing only.*editing permission/,
    );
    assert.equal(await loaded.frame.locator('#items input:enabled').count(), 0);
    assert.equal(state.edits, 0);
  } finally {
    await loaded.context.close();
  }
});

test('MCP Apps usability: a stale edit explains refresh and retains the selected draft until refreshed', async () => {
  const loaded = await appPage(browser);
  try {
    const { frame, state } = loaded;
    await frame.locator('input[value="rectangle-1"]').check();
    assert.match(await frame.locator('#selection-status').textContent(), /2 selected/);
    state.revision += 1;
    await frame.getByRole('button', { name: 'Use this selection', exact: true }).click();
    await idle(frame);
    assert.match(await frame.locator('#message').textContent(), /workspace changed.*Refresh/);
    assert.equal(await frame.locator('input[value="rectangle-1"]').isChecked(), true);
    assert.equal(await frame.locator('#select').isDisabled(), true);
    assert.equal(state.edits, 0);
    await frame.getByRole('button', { name: 'Refresh', exact: true }).click();
    await idle(frame);
    assert.equal(await frame.locator('input[value="rectangle-1"]').isChecked(), true);
    assert.equal(await frame.locator('#select').isDisabled(), true);
    await frame.getByRole('button', { name: 'Use the PC selection', exact: true }).click();
    assert.equal(await frame.locator('#select').isEnabled(), true);
    await frame.locator('input[value="rectangle-1"]').check();
    await frame.getByRole('button', { name: 'Use this selection', exact: true }).click();
    await idle(frame);
    const writes = state.commands.filter((item) => item.name === 'set_selection');
    assert.equal(writes[1].args.expectedRevision, 'fixture-2');
    assert.notEqual(writes[0].args.requestId, writes[1].args.requestId);
    assert.equal(state.edits, 1);
  } finally {
    await loaded.context.close();
  }
});

for (const width of [320, 390])
  test(`MCP Apps usability: ${width}px layout has readable rows, comfortable taps and keyboard selection`, async () => {
    const loaded = await appPage(browser, await visualState(), width);
    try {
      const { frame, state } = loaded;
      await frame.waitForFunction(
        () => globalThis.document.getElementById('preview').naturalWidth > 0,
      );
      assert.equal(
        await frame.locator('#preview').evaluate((item) => item.naturalWidth),
        state.preview?.widthPx ?? 1,
      );
      assert.ok(
        await frame.evaluate(
          () =>
            globalThis.document.documentElement.scrollWidth <=
            globalThis.document.documentElement.clientWidth,
        ),
      );
      for (const selector of ['#refresh', '#undo', '#select', '#items label'])
        assert.ok((await frame.locator(selector).first().boundingBox()).height >= 48);
      const rectangle = frame.locator('input[value="rectangle-1"]');
      await rectangle.focus();
      await rectangle.press('Space');
      assert.equal(await rectangle.isChecked(), true);
      assert.match(await frame.locator('#selection-status').textContent(), /2 selected/);
      assert.equal(state.edits, 0);
      await capture(loaded.page, `portable-mcp-app-${width}-layout-fixture`);
      assert.deepEqual(loaded.errors, []);
    } finally {
      await loaded.context.close();
    }
  });
