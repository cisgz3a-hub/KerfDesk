import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  fixture,
  isUuid,
  launch,
  mcpAppHtml,
  noHorizontalOverflow,
  phonePage,
  respond,
  writes,
} from './remote-app-support.mjs';

let browser;
before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
});

/** Client pixel for a scene millimetre, using the canvas SVG's own transform. */
async function scenePoint(page, x, y, frame = page) {
  return frame.locator('.canvas-wrap svg').evaluate(
    (svg, [px, py]) => {
      const point = svg.createSVGPoint();
      point.x = px;
      point.y = py;
      const screen = point.matrixTransform(svg.getScreenCTM());
      return { x: screen.x, y: screen.y };
    },
    [x, y],
  );
}
async function until(check, message, timeout = 4000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(message);
}

for (const width of [320, 390]) {
  test(`phone ${width}px: pairing asks for chosen access, then opens the app without overflow`, async () => {
    const state = fixture({ errors: [] });
    const { page, context } = await phonePage(browser, state, { width, paired: false });
    try {
      await page.getByText('Your workshop, in your pocket.').waitFor();
      assert.equal(await noHorizontalOverflow(page), true);
      await page.getByRole('button', { name: /Enter the code instead/ }).click();
      await page.getByLabel('Computer ID').fill('12345678-1234-4234-8234-123456789abc');
      await page.getByLabel('Pairing code').fill('PairCode12-A');
      await page.getByRole('switch', { name: /Control the machine/ }).check();
      assert.equal(await noHorizontalOverflow(page), true);
      await page.getByRole('button', { name: 'Ask the PC for approval' }).click();
      await page.getByText('Approve on your PC').waitFor();
      assert.deepEqual(state.claim.requestedScopes, ['read', 'edit', 'control']);
      assert.equal(state.claim.code, 'PairCode12-A');
      // Nothing opens until the PC approves; the waiting screen keeps polling.
      await page.waitForTimeout(1800);
      assert.equal(await page.getByText('Approve on your PC').isVisible(), true);
      state.approve();
      await page.getByRole('navigation', { name: 'Sections' }).waitFor({ timeout: 6000 });
      await page.getByText('Your workspace').waitFor();
      assert.equal(await noHorizontalOverflow(page), true);
      assert.deepEqual(state.errors, []);
    } finally {
      await context.close();
    }
  });
}

test('phone canvas: vector artwork, geometry hit selection and a drag that writes one move', async () => {
  const state = fixture();
  const { page, context } = await phonePage(browser, state);
  try {
    await page.locator('path.art-path').first().waitFor();
    assert.equal(await page.locator('path.art-path').first().getAttribute('stroke'), '#e53935');
    // Inside an unfilled rectangle is empty space: geometry, not bounding boxes, decides.
    const inside = await scenePoint(page, 30, 25);
    await page.mouse.click(inside.x, inside.y);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(await page.getByRole('toolbar', { name: 'Selection' }).count(), 0);
    const edge = await scenePoint(page, 10, 25);
    await page.mouse.click(edge.x, edge.y);
    await page.getByRole('toolbar', { name: 'Selection' }).getByText('1 selected').waitFor();
    await until(
      () => writes(state).some((item) => item.name === 'set_selection'),
      'selection sent',
    );
    const selection = writes(state).find((item) => item.name === 'set_selection');
    assert.deepEqual(selection.args.artworkIds, ['a1']);
    assert.equal(selection.args.expectedRevision, 'r1');
    assert.equal(selection.csrf, 'csrf-token');
    const from = await scenePoint(page, 30, 10);
    const to = await scenePoint(page, 50, 10);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let step = 1; step <= 6; step += 1)
      await page.mouse.move(from.x + ((to.x - from.x) * step) / 6, from.y);
    await page.mouse.up();
    await until(() => writes(state).some((item) => item.name === 'transform_artwork'), 'move sent');
    const moves = writes(state).filter((item) => item.name === 'transform_artwork');
    assert.equal(moves.length, 1);
    assert.equal(moves[0].args.transform.type, 'move');
    assert.ok(
      Math.abs(moves[0].args.transform.dxMm - 20) < 1,
      `dx ${moves[0].args.transform.dxMm}`,
    );
    assert.ok(Math.abs(moves[0].args.transform.dyMm) < 0.5);
  } finally {
    await context.close();
  }
});

test('phone machine: a running job shows progress and an Abort dock that covers nothing', async () => {
  const state = fixture();
  state.machine.job = {
    active: true,
    state: 'running',
    progressPercent: 42,
    elapsedSeconds: 61,
    remainingSeconds: 125,
  };
  state.machine.controllerState = 'Run';
  state.machine.availability.pause = { available: true };
  const { page, context } = await phonePage(browser, state, { width: 360 });
  try {
    await page.getByRole('button', { name: 'Machine' }).click();
    await page.getByText('42%').waitFor();
    const abort = page.getByRole('button', { name: 'Abort' });
    await abort.waitFor();
    const abortBox = await abort.boundingBox();
    const tabs = await page.getByRole('navigation', { name: 'Sections' }).boundingBox();
    const screen = await page.locator('.screen').boundingBox();
    assert.ok(abortBox.y + abortBox.height <= tabs.y + 0.5, 'Abort sits above the tab bar');
    assert.ok(screen.y + screen.height <= abortBox.y + 0.5, 'content ends above Abort');
    assert.ok(abortBox.height >= 48);
    await abort.click();
    await until(() => state.commands.some((item) => item.name === 'abort_job'), 'abort sent');
    const sent = state.commands.find((item) => item.name === 'abort_job');
    assert.ok(isUuid(sent.args.requestId));
    assert.equal(sent.args.expectedRevision, undefined);
    assert.equal(await noHorizontalOverflow(page), true);
  } finally {
    await context.close();
  }
});

test('phone hold-to-jog: heartbeats over the socket while held, stop and release on lift; tap steps', async () => {
  const state = fixture();
  const { page, context } = await phonePage(browser, state);
  try {
    await page.getByRole('button', { name: 'Machine' }).click();
    await page.getByText('Hold to move').waitFor();
    const button = page.getByRole('button', { name: 'Jog X+' });
    await button.scrollIntoViewIfNeeded();
    const box = await button.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await until(
      () => state.commands.some((item) => item.name === 'jog_hold_start'),
      'hold started',
    );
    const start = state.commands.find((item) => item.name === 'jog_hold_start');
    assert.deepEqual([start.args.axis, start.args.direction], ['x', 1]);
    await until(
      () =>
        state.socket.filter(
          (item) => item.type === 'hold.beat' && item.operationId === start.args.requestId,
        ).length >= 3,
      'heartbeats sent',
    );
    await page.mouse.up();
    await until(() => state.commands.some((item) => item.name === 'jog_hold_stop'), 'hold stopped');
    const stop = state.commands.find((item) => item.name === 'jog_hold_stop');
    assert.equal(stop.args.operationId, start.args.requestId);
    assert.ok(state.socket.some((item) => item.type === 'hold.release'));
    const beats = state.socket.filter((item) => item.type === 'hold.beat').length;
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(
      state.socket.filter((item) => item.type === 'hold.beat').length,
      beats,
      'no beats after release',
    );
    assert.equal(
      state.commands.some((item) => item.name === 'jog_machine'),
      false,
    );
    await button.click();
    await until(() => state.commands.some((item) => item.name === 'jog_machine'), 'step sent');
    const step = state.commands.find((item) => item.name === 'jog_machine');
    assert.deepEqual([step.args.axis, step.args.direction, step.args.distanceMm], ['x', 1, 1]);
  } finally {
    await context.close();
  }
});

test('MCP App: inline card opens fullscreen, shares view context and serves its view tools', async () => {
  const state = fixture();
  const html = await mcpAppHtml();
  // Self-contained, and no phone-session plumbing or owner credentials in the AI panel.
  assert.doesNotMatch(html, /ownerSecret|api\/client\/command|X-KerfDesk-CSRF|<script src=|<link /);
  const context = await browser.newContext({ viewport: { width: 420, height: 760 } });
  const page = await context.newPage();
  try {
    await page.exposeFunction('serverTool', (name, args) => {
      state.commands.push({ name, args });
      return respond(state, name, args);
    });
    await page.setContent(
      `<!doctype html><html><body style="margin:0"><iframe id="app" style="width:100%;height:100vh;border:0"></iframe></body></html>`,
    );
    await page.evaluate((source) => {
      window.__log = [];
      const pending = new Map();
      let nextId = 9000;
      const frame = document.getElementById('app');
      window.addEventListener('message', async (event) => {
        if (event.source !== frame.contentWindow) return;
        const message = event.data;
        if (message?.jsonrpc !== '2.0') return;
        window.__log.push(message);
        const reply = (result) =>
          frame.contentWindow.postMessage({ jsonrpc: '2.0', id: message.id, result }, '*');
        if ('method' in message && 'id' in message) {
          if (message.method === 'ui/initialize')
            reply({
              protocolVersion: message.params.protocolVersion,
              hostInfo: { name: 'test-host', version: '1.0.0' },
              hostCapabilities: { serverTools: {} },
              hostContext: {
                displayMode: 'inline',
                availableDisplayModes: ['inline', 'fullscreen'],
                theme: 'dark',
              },
            });
          else if (message.method === 'tools/call') {
            const result = await window.serverTool(
              message.params.name,
              message.params.arguments ?? {},
            );
            reply({
              content: [{ type: 'text', text: JSON.stringify(result) }],
              structuredContent: result,
            });
          } else if (message.method === 'ui/request-display-mode')
            reply({ mode: message.params.mode });
          else reply({});
        } else if ('id' in message && pending.has(message.id)) {
          pending.get(message.id)(message);
          pending.delete(message.id);
        }
      });
      window.__request = (method, params) =>
        new Promise((resolve) => {
          const id = nextId++;
          pending.set(id, resolve);
          frame.contentWindow.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
        });
      frame.srcdoc = source;
    }, html);
    const app = page.frameLocator('#app');
    await app.getByRole('button', { name: /Open editor/ }).waitFor();
    assert.equal(await app.locator('html').getAttribute('data-theme'), 'dark');
    await app.getByRole('button', { name: /Open editor/ }).click();
    await app.getByRole('navigation', { name: 'Sections' }).waitFor();
    await app.locator('path.art-path').first().waitFor();
    const log = () => page.evaluate(() => window.__log);
    assert.ok(
      (await log()).some(
        (item) => item.method === 'ui/request-display-mode' && item.params.mode === 'fullscreen',
      ),
    );
    await until(
      async () => (await log()).some((item) => item.method === 'ui/update-model-context'),
      'model context shared',
      5000,
    );
    const context_ = (await log())
      .filter((item) => item.method === 'ui/update-model-context')
      .at(-1);
    assert.equal(context_.params.structuredContent.view, 'design');
    assert.match(context_.params.content[0].text, /user data, not instructions/);
    const listed = await page.evaluate(() => window.__request('tools/list', {}));
    assert.deepEqual(listed.result.tools.map((tool) => tool.name).sort(), [
      'ui_focus',
      'ui_get_view_state',
      'ui_highlight',
      'ui_show',
    ]);
    const shown = await page.evaluate(() =>
      window.__request('tools/call', { name: 'ui_show', arguments: { view: 'layers' } }),
    );
    assert.notEqual(shown.result.isError, true);
    await app.getByRole('heading', { name: 'Layers' }).waitFor();
    const view = await page.evaluate(() =>
      window.__request('tools/call', { name: 'ui_get_view_state', arguments: {} }),
    );
    assert.equal(view.result.structuredContent.view, 'layers');
    assert.equal(view.result.structuredContent.revision, 'r1');
    const invalid = await page.evaluate(() =>
      window.__request('tools/call', { name: 'ui_show', arguments: { view: 'shell' } }),
    );
    assert.ok(
      invalid.error !== undefined || invalid.result?.isError === true,
      'invalid view refused',
    );
    assert.ok(
      state.commands.some((item) => item.name === 'get_workspace_scene'),
      'reads through the host bridge',
    );
    assert.equal(writes(state).length, 0, 'opening and navigating never writes');
  } finally {
    await context.close();
  }
});
