import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';
import { ORIGIN, start, connectDesktop, pairPhone, workspace, authorizeMcp } from './support.mjs';

const closeSocket = (socket) => {
  if (socket && socket.readyState < 2) socket.close();
};
function syntheticDesktop(desktop, commands, suppliedOperations) {
  let revision = 1;
  let workspaceName = workspace.name;
  const gates = new Map();
  let operations = suppliedOperations ?? [
    {
      id: 'op-1',
      type: 'laser_vector',
      name: 'Laser cut',
      enabled: true,
      powerPercent: 30,
      speedMmPerMin: 1000,
      passes: 1,
    },
  ];
  desktop.socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.type !== 'command') return;
    const { name, args } = message.command;
    commands.push({ name, args });
    let result;
    if (name === 'get_workspace')
      result = {
        ...workspace,
        name: workspaceName,
        revision: `audit-${revision}`,
        artwork: [
          {
            id: 'artwork-1',
            type: 'text',
            name: '<script>synthetic</script>',
            bounds: { xMm: 0, yMm: 0, widthMm: 50, heightMm: 10 },
          },
        ],
        operations: structuredClone(operations),
        totalArtwork: 1,
        totalOperations: operations.length,
      };
    else if (name === 'get_app_status')
      result = {
        revision: `audit-${revision}`,
        app: { name: 'KerfDesk', version: '1.0.4', platform: 'desktop' },
        edition: { mode: 'free' },
        updates: { available: false },
      };
    else if (name === 'get_machine')
      result = {
        revision: `audit-${revision}`,
        machine: {
          id: 'machine-1',
          name: 'Audit machine',
          mode: 'laser',
          bedWidthMm: 300,
          bedHeightMm: 300,
        },
      };
    else if (name === 'review_job')
      result = {
        revision: `audit-${revision}`,
        status: 'ready',
        mode: 'laser',
        warnings: [],
        frame: { required: true, complete: false },
      };
    else if (name === 'list_material_recipes')
      result = { revision: `audit-${revision}`, recipes: [], total: 0, truncated: false };
    else {
      if (name === 'update_operation') {
        const operation = operations.find((item) => item.id === args.operationId);
        if (operation) Object.assign(operation, args.patch);
      }
      revision += 1;
      result = { revision: `audit-${revision}` };
    }
    const respond = () => desktop.send({ type: 'result', requestId: message.requestId, result });
    const gate = gates.get(name);
    if (gate) {
      gates.delete(name);
      gate.respond = respond;
      gate.arrived();
    } else respond();
  });
  function holdNext(name) {
    const gate = { respond: null, arrived: null };
    const reached = new Promise((resolve) => {
      gate.arrived = resolve;
    });
    gates.set(name, gate);
    return {
      reached,
      release() {
        if (gates.get(name) === gate) gates.delete(name);
        const respond = gate.respond;
        gate.respond = null;
        respond?.();
      },
    };
  }
  return {
    renameWorkspace(name) {
      workspaceName = name;
    },
    replaceOperations(next) {
      operations = next;
    },
    getOperation(id) {
      return structuredClone(operations.find((operation) => operation.id === id));
    },
    holdNextAppStatus() {
      return holdNext('get_app_status');
    },
    holdNextWorkspace() {
      return holdNext('get_workspace');
    },
  };
}
async function browserPage(worker, cookies = [], callbackOrigin = null, receipts = []) {
  const browser = await chromium.launch({
    ...(process.env.KERFDESK_TEST_BROWSER === 'chromium' ? {} : { channel: 'chrome' }),
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  if (cookies.length) await context.addCookies(cookies);
  await context.route('**/*', async (route) => {
    const request = route.request();
    if (callbackOrigin && new URL(request.url()).origin === callbackOrigin) {
      await route.continue();
      return;
    }
    if (!request.url().startsWith(ORIGIN + '/')) {
      await route.abort();
      return;
    }
    const response = await worker.dispatchFetch(request.url(), {
      method: request.method(),
      headers: request.headers(),
      body: request.postData() ?? undefined,
      redirect: 'manual',
    });
    receipts.push({
      method: request.method(),
      path: new URL(request.url()).pathname,
      status: response.status,
      origin: request.headers().origin ?? null,
    });
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    });
  });
  return { browser, context, page: await context.newPage() };
}
test(
  'mobile Chrome: pairing needs PC approval; no canvas, token storage or numeric draft coercion',
  { timeout: 40_000 },
  async () => {
    const worker = start();
    let desktop;
    let browser;
    try {
      desktop = await connectDesktop(worker);
      const commands = [];
      const fixture = syntheticDesktop(desktop, commands);
      desktop.send({ type: 'pair.create', requestId: crypto.randomUUID() });
      const offer = await desktop.inbox.next('pair.offer');
      const loaded = await browserPage(worker);
      browser = loaded.browser;
      const page = loaded.page;
      await page.goto(`${ORIGIN}/control?deviceId=${desktop.deviceId}`);
      await page.locator('[name=deviceId]').fill(desktop.deviceId);
      await page.locator('[name=code]').fill(offer.code);
      await page.locator('[name=edit]').check();
      await page.getByRole('button', { name: 'Request PC approval' }).click();
      const request = await desktop.inbox.next('pair.request');
      assert.equal(await page.locator('#workspace-area').isHidden(), true);
      assert.equal(commands.length, 0);
      desktop.send({
        type: 'pair.decide',
        pairingId: request.pairingId,
        approved: true,
        scopes: ['read', 'edit'],
      });
      await page.locator('#workspace-area').waitFor({ state: 'visible' });
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      await page.locator('#operation-form [name=powerPercent]').waitFor({ state: 'visible' });
      await page.waitForFunction(
        () => document.querySelector('#operation-form [name=powerPercent]').value === '30',
      );
      const power = page.locator('#operation-form [name=powerPercent]');
      await power.fill('');
      assert.equal(await power.inputValue(), '');
      await power.fill('25');
      assert.equal(await power.inputValue(), '25');
      await page.getByRole('button', { name: 'Apply settings' }).click();
      await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
      const operation = commands.find((command) => command.name === 'update_operation');
      assert.equal(operation.args.patch.powerPercent, 25);
      assert.equal(operation.args.expectedRevision, 'audit-1');
      assert.match(operation.args.requestId, /^[0-9a-f-]{36}$/);
      assert.equal(fixture.getOperation('op-1').powerPercent, 25);
      assert.equal(await power.inputValue(), '25');
      const text = page.locator('#text-form');
      await text.locator('[name=text]').fill('Audit text');
      await text.locator('[name=xMm]').fill('-');
      await text.locator('button').click();
      await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
      assert.equal(
        commands.some((command) => command.name === 'add_text'),
        false,
      );
      assert.equal(await text.locator('[name=xMm]').inputValue(), '-');
      for (const [name, value] of Object.entries({
        xMm: '-2.5',
        yMm: ' 3.25 ',
        widthMm: '40.5',
        fontSizeMm: '8',
      }))
        await text.locator(`[name=${name}]`).fill(value);
      await text.locator('button').click();
      await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
      const addedText = commands.find((command) => command.name === 'add_text');
      assert.deepEqual(
        Object.fromEntries(
          ['text', 'xMm', 'yMm', 'widthMm', 'fontSizeMm'].map((name) => [
            name,
            addedText.args[name],
          ]),
        ),
        { text: 'Audit text', xMm: -2.5, yMm: 3.25, widthMm: 40.5, fontSizeMm: 8 },
      );
      assert.equal(addedText.args.expectedRevision, 'audit-2');
      const rectangle = page.locator('#rectangle-form');
      await rectangle.locator('[name=xMm]').fill('');
      await rectangle.locator('button').click();
      assert.equal(
        commands.some((command) => command.name === 'add_rectangle'),
        false,
      );
      for (const [name, value] of Object.entries({
        xMm: '10.5',
        yMm: '-20.25',
        widthMm: '5.75',
        heightMm: '6.25',
      }))
        await rectangle.locator(`[name=${name}]`).fill(value);
      await rectangle.locator('button').click();
      await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
      const addedRectangle = commands.find((command) => command.name === 'add_rectangle');
      assert.deepEqual(
        Object.fromEntries(
          ['xMm', 'yMm', 'widthMm', 'heightMm'].map((name) => [name, addedRectangle.args[name]]),
        ),
        { xMm: 10.5, yMm: -20.25, widthMm: 5.75, heightMm: 6.25 },
      );
      assert.equal(addedRectangle.args.expectedRevision, 'audit-3');
      assert.equal(await page.locator('canvas').count(), 0);
      const storage = await page.evaluate(() => ({
        local: Object.keys(localStorage),
        session: Object.keys(sessionStorage),
        cookies: document.cookie,
      }));
      assert.deepEqual(storage.local, []);
      assert.deepEqual(storage.session, []);
      assert.equal(storage.cookies, '');
      assert.equal(
        await page.locator('body').evaluate((body) => body.scrollWidth <= window.innerWidth),
        true,
      );
      assert.ok(await page.getByText('<script>synthetic</script>', { exact: true }).count());
      await page.reload();
      await page.locator('#workspace-area').waitFor({ state: 'visible' });
      await page.getByRole('button', { name: 'Disconnect this phone' }).click();
      await page.locator('#pair-card').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#workspace-area').isHidden(), true);
    } finally {
      await browser?.close();
      closeSocket(desktop?.socket);
      await worker.dispose();
    }
  },
);

for (const pairedOnStartup of [true, false])
  test(
    `mobile Chrome: ${pairedOnStartup ? 'saved approval startup' : 'pairing approval timer'} holds Apply until detail reads settle`,
    { timeout: 30_000 },
    async () => {
      const worker = start();
      let desktop;
      let browser;
      let detailDelay;
      try {
        desktop = await connectDesktop(worker);
        const commands = [];
        const fixture = syntheticDesktop(desktop, commands);
        detailDelay = fixture.holdNextAppStatus();
        let cookies = [];
        if (pairedOnStartup) {
          const phone = await pairPhone(worker, desktop);
          const [name, value] = phone.cookie.split('=');
          cookies = [
            { name, value, url: ORIGIN, httpOnly: true, secure: true, sameSite: 'Strict' },
          ];
        }
        const receipts = [];
        const loaded = await browserPage(worker, cookies, null, receipts);
        browser = loaded.browser;
        const page = loaded.page;
        await page.goto(`${ORIGIN}/control`);
        if (!pairedOnStartup) {
          await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
          desktop.send({ type: 'pair.create', requestId: crypto.randomUUID() });
          const offer = await desktop.inbox.next('pair.offer');
          await page.locator('[name=deviceId]').fill(desktop.deviceId);
          await page.locator('[name=code]').fill(offer.code);
          await page.locator('[name=edit]').check();
          await page.getByRole('button', { name: 'Request PC approval' }).click();
          const request = await desktop.inbox.next('pair.request');
          await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
          assert.ok(
            receipts.some((item) => item.path === '/api/pair/status' && item.status === 200),
          );
          desktop.send({
            type: 'pair.decide',
            pairingId: request.pairingId,
            approved: true,
            scopes: ['read', 'edit'],
          });
        }
        await detailDelay.reached;
        await page.getByRole('button', { name: 'Edit', exact: true }).click();
        const apply = page.getByRole('button', { name: 'Apply settings' });
        assert.equal(await page.locator('body').getAttribute('aria-busy'), 'true');
        assert.equal(await apply.isDisabled(), true);
        const power = page.locator('#operation-form [name=powerPercent]');
        await power.fill('');
        await power.fill('25');
        assert.equal(
          commands.some((command) => command.name === 'update_operation'),
          false,
        );
        detailDelay.release();
        await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
        await apply.click();
        await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
        const writes = commands.filter((command) => command.name === 'update_operation');
        assert.equal(writes.length, 1);
        assert.equal(writes[0].args.patch.powerPercent, 25);
        assert.equal(writes[0].args.expectedRevision, 'audit-1');
        assert.equal(fixture.getOperation('op-1').powerPercent, 25);
        assert.equal(await power.inputValue(), '25');
        assert.equal(await page.locator('#notice').textContent(), 'Updated on your computer.');
        assert.equal(await apply.isEnabled(), true);
      } finally {
        detailDelay?.release();
        await browser?.close();
        closeSocket(desktop?.socket);
        await worker.dispose();
      }
    },
  );

for (const failure of ['offline PC', 'workspace error', 'second session error'])
  test(
    `mobile Chrome: saved read approval keeps scopes and Refresh through ${failure}`,
    { timeout: 30_000 },
    async () => {
      const worker = start();
      let desktop;
      let browser;
      try {
        desktop = await connectDesktop(worker);
        const commands = [];
        syntheticDesktop(desktop, commands);
        const phone = await pairPhone(worker, desktop, ['read']);
        const [name, value] = phone.cookie.split('=');
        const loaded = await browserPage(worker, [
          { name, value, url: ORIGIN, httpOnly: true, secure: true, sameSite: 'Strict' },
        ]);
        browser = loaded.browser;
        const page = loaded.page;
        let healthy = false;
        let sessionReads = 0;
        await page.route('**/api/session', async (route) => {
          sessionReads += 1;
          if (!healthy && failure === 'offline PC')
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ ...phone.session, online: false }),
            });
          else if (!healthy && failure === 'second session error' && sessionReads === 2)
            await route.fulfill({
              status: 503,
              contentType: 'application/json',
              body: JSON.stringify({ error: { code: 'failed' } }),
            });
          else await route.fallback();
        });
        await page.route('**/api/client/command', async (route) => {
          if (
            !healthy &&
            failure === 'workspace error' &&
            route.request().postDataJSON().name === 'get_workspace'
          )
            await route.fulfill({
              status: 503,
              contentType: 'application/json',
              body: JSON.stringify({ error: { code: 'failed' } }),
            });
          else await route.fallback();
        });
        await page.goto(`${ORIGIN}/control`);
        await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
        assert.equal(await page.locator('#workspace-area').isVisible(), true);
        assert.equal(await page.locator('#pair-card').isHidden(), true);
        await page.getByRole('button', { name: 'Edit', exact: true }).click();
        assert.equal(await page.locator('#edit-forms').isHidden(), true);
        assert.equal(await page.locator('#readonly-note').isVisible(), true);
        assert.equal(await page.locator('#save-selection').isHidden(), true);
        assert.equal(await page.locator('#operation-form button').isDisabled(), true);
        assert.equal(await page.locator('#notice').getAttribute('data-kind'), 'error');
        const refresh = page.getByRole('button', { name: 'Refresh', exact: true });
        assert.equal(await refresh.isEnabled(), true);
        healthy = true;
        await refresh.click();
        await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
        assert.equal(await page.locator('#workspace-name').textContent(), workspace.name);
        assert.equal(await page.locator('#edit-forms').isHidden(), true);
        assert.equal(await page.locator('#readonly-note').isVisible(), true);
        assert.equal(await page.locator('#artwork-list input:enabled').count(), 0);
        assert.equal(await page.locator('#notice').textContent(), 'Workspace refreshed.');
        assert.equal(
          commands.some((command) => command.name === 'update_operation'),
          false,
        );
      } finally {
        await browser?.close();
        closeSocket(desktop?.socket);
        await worker.dispose();
      }
    },
  );

test(
  'mobile Chrome: disconnect clears the previous PC before a replacement read approval loads',
  { timeout: 30_000 },
  async () => {
    const worker = start();
    let previous;
    let replacement;
    let browser;
    let workspaceDelay;
    try {
      previous = await connectDesktop(worker);
      const commands = [];
      syntheticDesktop(previous, commands).renameWorkspace('Previous PC workspace');
      const phone = await pairPhone(worker, previous);
      const [name, value] = phone.cookie.split('=');
      const receipts = [];
      const loaded = await browserPage(
        worker,
        [{ name, value, url: ORIGIN, httpOnly: true, secure: true, sameSite: 'Strict' }],
        null,
        receipts,
      );
      browser = loaded.browser;
      const page = loaded.page;
      await page.goto(`${ORIGIN}/control`);
      await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
      assert.equal(await page.locator('#workspace-name').textContent(), 'Previous PC workspace');
      assert.ok(await page.locator('#artwork-list label').count());
      assert.ok(await page.locator('#details-list .detail').count());
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      await page.locator('#operation-form [name=powerPercent]').fill('55');
      await page.locator('#disconnect').click();
      await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
      assert.ok(receipts.some((item) => item.path === '/api/client/revoke' && item.status === 200));
      assert.equal(
        (await worker.dispatchFetch(`${ORIGIN}/api/session`, { headers: { Cookie: phone.cookie } }))
          .status,
        401,
      );
      assert.equal(await page.locator('#pair-card').isVisible(), true);
      assert.equal(await page.locator('#readonly-note').isHidden(), true);
      assert.equal(await page.locator('#edit-forms').isHidden(), true);
      for (const selector of [
        '#workspace-name',
        '#workspace-meta',
        '#artwork-list',
        '#details-list',
      ])
        assert.equal(await page.locator(selector).textContent(), '');
      assert.equal(await page.locator('#operation-list option').count(), 0);
      assert.equal(await page.locator('#operation-form [name=powerPercent]').inputValue(), '');
      replacement = await connectDesktop(worker);
      const fixture = syntheticDesktop(replacement, commands);
      fixture.renameWorkspace('Replacement PC workspace');
      workspaceDelay = fixture.holdNextWorkspace();
      replacement.send({ type: 'pair.create', requestId: crypto.randomUUID() });
      const offer = await replacement.inbox.next('pair.offer');
      await page.locator('[name=deviceId]').fill(replacement.deviceId);
      await page.locator('[name=code]').fill(offer.code);
      await page.locator('[name=edit]').uncheck();
      await page.getByRole('button', { name: 'Request PC approval' }).click();
      const request = await replacement.inbox.next('pair.request');
      await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
      replacement.send({
        type: 'pair.decide',
        pairingId: request.pairingId,
        approved: true,
        scopes: ['read'],
      });
      await workspaceDelay.reached;
      assert.equal(await page.locator('#workspace-area').isVisible(), true);
      assert.equal(await page.locator('#edit-forms').isHidden(), true);
      assert.equal(await page.locator('#readonly-note').isVisible(), true);
      for (const selector of [
        '#workspace-name',
        '#workspace-meta',
        '#artwork-list',
        '#details-list',
      ])
        assert.equal(await page.locator(selector).textContent(), '');
      assert.equal(await page.locator('#operation-list option').count(), 0);
      assert.equal(await page.locator('#operation-form [name=powerPercent]').inputValue(), '');
      workspaceDelay.release();
      await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
      assert.equal(await page.locator('#workspace-name').textContent(), 'Replacement PC workspace');
      assert.equal(await page.locator('#edit-forms').isHidden(), true);
      assert.equal(await page.locator('#artwork-list input:enabled').count(), 0);
      assert.equal(
        commands.some((command) => command.name === 'update_operation'),
        false,
      );
    } finally {
      workspaceDelay?.release();
      await browser?.close();
      closeSocket(previous?.socket);
      closeSocket(replacement?.socket);
      await worker.dispose();
    }
  },
);

test(
  'mobile Chrome: a changed approved client clears old PC data even with the same device label',
  { timeout: 30_000 },
  async () => {
    const worker = start();
    let previous;
    let replacement;
    let browser;
    let workspaceDelay;
    try {
      previous = await connectDesktop(worker);
      const commands = [];
      syntheticDesktop(previous, commands).renameWorkspace('Previous PC workspace');
      const phone = await pairPhone(worker, previous);
      const [name, value] = phone.cookie.split('=');
      const loaded = await browserPage(worker, [
        { name, value, url: ORIGIN, httpOnly: true, secure: true, sameSite: 'Strict' },
      ]);
      browser = loaded.browser;
      const page = loaded.page;
      await page.goto(`${ORIGIN}/control`);
      await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      await page.locator('#operation-form [name=powerPercent]').fill('55');
      assert.equal(await page.locator('#workspace-name').textContent(), 'Previous PC workspace');
      replacement = await connectDesktop(worker);
      const fixture = syntheticDesktop(replacement, commands);
      fixture.renameWorkspace('Replacement PC workspace');
      const nextPhone = await pairPhone(worker, replacement, ['read']);
      assert.equal(nextPhone.session.deviceLabel, phone.session.deviceLabel);
      assert.notEqual(nextPhone.clientId, phone.clientId);
      const [nextName, nextValue] = nextPhone.cookie.split('=');
      // A second browser tab can replace the shared HttpOnly session cookie legitimately.
      await loaded.context.addCookies([
        {
          name: nextName,
          value: nextValue,
          url: ORIGIN,
          httpOnly: true,
          secure: true,
          sameSite: 'Strict',
        },
      ]);
      workspaceDelay = fixture.holdNextWorkspace();
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      await workspaceDelay.reached;
      assert.equal(await page.locator('#workspace-area').isVisible(), true);
      assert.equal(await page.locator('#edit-forms').isHidden(), true);
      assert.equal(await page.locator('#readonly-note').isVisible(), true);
      assert.equal(await page.locator('#save-selection').isHidden(), true);
      for (const selector of [
        '#workspace-name',
        '#workspace-meta',
        '#artwork-list',
        '#details-list',
      ])
        assert.equal(await page.locator(selector).textContent(), '');
      assert.equal(await page.locator('#operation-list option').count(), 0);
      assert.equal(await page.locator('#operation-form [name=powerPercent]').inputValue(), '');
      workspaceDelay.release();
      await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
      assert.equal(await page.locator('#workspace-name').textContent(), 'Replacement PC workspace');
      assert.equal(await page.locator('#edit-forms').isHidden(), true);
      assert.equal(await page.locator('#artwork-list input:enabled').count(), 0);
      assert.equal(
        commands.some((command) => command.name === 'update_operation'),
        false,
      );
    } finally {
      workspaceDelay?.release();
      await browser?.close();
      closeSocket(previous?.socket);
      closeSocket(replacement?.socket);
      await worker.dispose();
    }
  },
);

test(
  'mobile Chrome: saved approval detail failure stays recoverable through Refresh',
  { timeout: 30_000 },
  async () => {
    const worker = start();
    let desktop;
    let browser;
    try {
      desktop = await connectDesktop(worker);
      const commands = [];
      syntheticDesktop(desktop, commands);
      const phone = await pairPhone(worker, desktop);
      const [name, value] = phone.cookie.split('=');
      const loaded = await browserPage(worker, [
        { name, value, url: ORIGIN, httpOnly: true, secure: true, sameSite: 'Strict' },
      ]);
      browser = loaded.browser;
      const page = loaded.page;
      let failed = false;
      await page.route('**/api/client/command', async (route) => {
        if (route.request().postDataJSON().name === 'get_app_status' && !failed) {
          failed = true;
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: { code: 'failed' } }),
          });
        } else await route.fallback();
      });
      await page.goto(`${ORIGIN}/control`);
      await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
      assert.equal(failed, true);
      assert.equal(await page.locator('#workspace-area').isVisible(), true);
      assert.equal(await page.locator('#pair-card').isHidden(), true);
      assert.equal(await page.locator('#notice').getAttribute('data-kind'), 'error');
      assert.match(await page.locator('#notice').textContent(), /Refresh the workspace/);
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
      assert.equal(await page.locator('#notice').textContent(), 'Workspace refreshed.');
      assert.ok(commands.some((command) => command.name === 'get_app_status'));
      assert.equal(
        commands.some((command) => command.name === 'update_operation'),
        false,
      );
    } finally {
      await browser?.close();
      closeSocket(desktop?.socket);
      await worker.dispose();
    }
  },
);

test(
  'mobile Chrome: applying twice preserves the second operation; refresh falls back only after deletion',
  { timeout: 30_000 },
  async () => {
    const worker = start();
    let desktop;
    let browser;
    try {
      desktop = await connectDesktop(worker);
      const commands = [];
      const operations = [
        {
          id: 'op-cut',
          type: 'laser_vector',
          name: 'Cut outside',
          enabled: true,
          powerPercent: 30,
          speedMmPerMin: 1000,
          passes: 1,
        },
        {
          id: 'op-score',
          type: 'laser_vector',
          name: 'Mark details',
          enabled: true,
          powerPercent: 60,
          speedMmPerMin: 2000,
          passes: 2,
        },
      ];
      const fixture = syntheticDesktop(desktop, commands, operations);
      const phone = await pairPhone(worker, desktop);
      const [name, value] = phone.cookie.split('=');
      const loaded = await browserPage(worker, [
        { name, value, url: ORIGIN, httpOnly: true, secure: true, sameSite: 'Strict' },
      ]);
      browser = loaded.browser;
      const page = loaded.page;
      await page.goto(`${ORIGIN}/control`);
      await page.locator('#workspace-area').waitFor({ state: 'visible' });
      await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      const selection = page.locator('#operation-list');
      await selection.selectOption('op-score');
      const power = page.locator('#operation-form [name=powerPercent]');
      await power.press('Home');
      await power.press('Delete');
      assert.equal(await power.inputValue(), '0');
      await power.fill('87');
      await page.locator('#operation-form [name=speedMmPerMin]').fill('-');
      await page.locator('#operation-form [name=passes]').fill('');
      const beforeIdle = commands.length;
      await page.clock.install();
      await page.clock.fastForward(10 * 60_000);
      assert.equal(await power.inputValue(), '87');
      assert.equal(await page.locator('#operation-form [name=speedMmPerMin]').inputValue(), '-');
      assert.equal(await page.locator('#operation-form [name=passes]').inputValue(), '');
      assert.equal(await selection.inputValue(), 'op-score');
      assert.equal(commands.length, beforeIdle);
      await page.clock.resume();
      await page.locator('#operation-form [name=powerPercent]').fill('55');
      await page.locator('#operation-form [name=speedMmPerMin]').fill('2000');
      await page.locator('#operation-form [name=passes]').fill('2');
      await page.getByRole('button', { name: 'Apply settings' }).click();
      await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
      await page.waitForFunction(
        () => document.querySelector('#notice').textContent === 'Updated on your computer.',
      );
      assert.equal(await selection.inputValue(), 'op-score');
      assert.equal(await page.locator('#operation-form [name=powerPercent]').inputValue(), '55');
      await page.locator('#operation-form [name=speedMmPerMin]').fill('3333');
      await page.getByRole('button', { name: 'Apply settings' }).click();
      await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
      await page.waitForFunction(
        () => document.querySelector('#notice').textContent === 'Updated on your computer.',
      );
      const writes = commands.filter((command) => command.name === 'update_operation');
      assert.equal(writes.length, 2);
      assert.deepEqual(
        writes.map((command) => command.args.operationId),
        ['op-score', 'op-score'],
      );
      assert.equal(operations[0].powerPercent, 30);
      assert.equal(operations[0].speedMmPerMin, 1000);
      assert.equal(operations[1].powerPercent, 55);
      assert.equal(operations[1].speedMmPerMin, 3333);
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
      await page.waitForFunction(
        () => document.querySelector('#notice').textContent === 'Workspace refreshed.',
      );
      assert.equal(await selection.inputValue(), 'op-score');
      fixture.replaceOperations([operations[1], operations[0]]);
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
      assert.equal(await selection.inputValue(), 'op-score');
      assert.equal(await power.inputValue(), '55');
      fixture.replaceOperations([operations[0]]);
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector('#operation-list').options.length === 1,
      );
      assert.equal(await selection.inputValue(), 'op-cut');
      assert.equal(await page.locator('#operation-form [name=powerPercent]').inputValue(), '30');
      fixture.replaceOperations([]);
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector('#operation-list').options.length === 0,
      );
      assert.equal(await selection.inputValue(), '');
      assert.equal(await page.getByRole('button', { name: 'Apply settings' }).isDisabled(), true);
    } finally {
      await browser?.close();
      closeSocket(desktop?.socket);
      await worker.dispose();
    }
  },
);

test(
  'mobile Chrome: explicit MCP consent returns through the approved client callback',
  { timeout: 30_000 },
  async () => {
    const worker = start();
    let desktop;
    let browser;
    const callbacks = [];
    const callbackServer = createServer((request, response) => {
      const url = new URL(request.url, 'http://127.0.0.1');
      callbacks.push({
        method: request.method,
        path: url.pathname,
        hasCode: !!url.searchParams.get('code'),
        referrer: request.headers.referer ?? null,
      });
      response.writeHead(url.pathname === '/callback' ? 200 : 404, {
        'Content-Type': 'text/html',
      });
      response.end('<html><body>Synthetic MCP callback</body></html>');
    });
    try {
      await new Promise((resolve) => callbackServer.listen(0, '127.0.0.1', resolve));
      const redirectUri = `http://127.0.0.1:${callbackServer.address().port}/callback`;
      desktop = await connectDesktop(worker);
      const phone = await pairPhone(worker, desktop, ['read']);
      let consentUrl;
      await authorizeMcp(worker, phone, 'kerfdesk:read', {
        redirectUri,
        beforeConsent(url) {
          consentUrl = url.href;
        },
      });
      const [name, value] = phone.cookie.split('=');
      const receipts = [];
      const loaded = await browserPage(
        worker,
        [{ name, value, url: ORIGIN, httpOnly: true, secure: true, sameSite: 'Strict' }],
        new URL(redirectUri).origin,
        receipts,
      );
      browser = loaded.browser;
      const browserErrors = [];
      loaded.page.on('console', (message) => {
        if (message.type() === 'error') browserErrors.push(message.text());
      });
      await loaded.page.goto(consentUrl);
      await loaded.page.getByRole('button', { name: 'Allow access', exact: true }).click();
      try {
        await loaded.page.waitForURL(
          (url) => url.origin === new URL(redirectUri).origin && url.pathname === '/callback',
          { timeout: 8000 },
        );
      } catch {
        throw new Error(
          `MCP callback did not load. Browser reported a form-action CSP rejection: ${browserErrors.some((message) => message.includes('form-action'))}. Sanitized routes: ${JSON.stringify(receipts)}.`,
        );
      }
      const callback = new URL(loaded.page.url());
      await loaded.page.getByText('Synthetic MCP callback', { exact: true }).waitFor();
      assert.equal(
        callback.searchParams.get('state'),
        new URL(consentUrl).searchParams.get('state'),
      );
      assert.deepEqual(callbacks, [
        { method: 'GET', path: '/callback', hasCode: true, referrer: null },
      ]);
      assert.ok(callback.searchParams.get('code'));
      assert.equal(callback.searchParams.get('ownerSecret'), null);
      assert.equal(callback.searchParams.get('access_token'), null);
    } finally {
      await browser?.close();
      await new Promise((resolve) => callbackServer.close(resolve));
      closeSocket(desktop?.socket);
      await worker.dispose();
    }
  },
);

for (const pairedOnStartup of [true, false])
  test(
    `mobile Chrome: ${pairedOnStartup ? 'saved read approval' : 'polling read approval'} hides editing before the workspace reply`,
    { timeout: 30_000 },
    async () => {
      const worker = start();
      let desktop;
      let browser;
      let workspaceDelay;
      try {
        desktop = await connectDesktop(worker);
        const commands = [];
        const fixture = syntheticDesktop(desktop, commands);
        workspaceDelay = fixture.holdNextWorkspace();
        let cookies = [];
        if (pairedOnStartup) {
          const phone = await pairPhone(worker, desktop, ['read']);
          const [name, value] = phone.cookie.split('=');
          cookies = [
            { name, value, url: ORIGIN, httpOnly: true, secure: true, sameSite: 'Strict' },
          ];
        }
        const loaded = await browserPage(worker, cookies);
        browser = loaded.browser;
        const page = loaded.page;
        await page.goto(`${ORIGIN}/control`);
        if (!pairedOnStartup) {
          await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
          desktop.send({ type: 'pair.create', requestId: crypto.randomUUID() });
          const offer = await desktop.inbox.next('pair.offer');
          await page.locator('[name=deviceId]').fill(desktop.deviceId);
          await page.locator('[name=code]').fill(offer.code);
          await page.getByRole('button', { name: 'Request PC approval' }).click();
          const request = await desktop.inbox.next('pair.request');
          await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
          desktop.send({
            type: 'pair.decide',
            pairingId: request.pairingId,
            approved: true,
            scopes: ['read'],
          });
        }
        await workspaceDelay.reached;
        await page.getByRole('button', { name: 'Edit', exact: true }).click();
        assert.equal(await page.locator('body').getAttribute('aria-busy'), 'true');
        assert.equal(await page.locator('#edit-forms').isHidden(), true);
        assert.equal(await page.locator('#readonly-note').isVisible(), true);
        assert.equal(await page.locator('#save-selection').isHidden(), true);
        workspaceDelay.release();
        await page.waitForFunction(() => document.body.getAttribute('aria-busy') === 'false');
        assert.equal(await page.locator('#edit-forms').isHidden(), true);
        assert.equal(await page.locator('#readonly-note').isVisible(), true);
        assert.equal(await page.locator('#artwork-list input:enabled').count(), 0);
        assert.equal(
          commands.some((command) => command.name === 'update_operation'),
          false,
        );
      } finally {
        workspaceDelay?.release();
        await browser?.close();
        closeSocket(desktop?.socket);
        await worker.dispose();
      }
    },
  );

test(
  'mobile Chrome: read approval hides edit forms and rejects an external consent return URL',
  { timeout: 30_000 },
  async () => {
    const worker = start();
    let desktop;
    let browser;
    try {
      desktop = await connectDesktop(worker);
      syntheticDesktop(desktop, []);
      const phone = await pairPhone(worker, desktop, ['read']);
      const [name, value] = phone.cookie.split('=');
      const loaded = await browserPage(worker, [
        { name, value, url: ORIGIN, httpOnly: true, secure: true, sameSite: 'Strict' },
      ]);
      browser = loaded.browser;
      await loaded.page.goto(
        `${ORIGIN}/control?continue=https%3A%2F%2Fforeign.example%2Fauthorize`,
      );
      await loaded.page.locator('#workspace-area').waitFor({ state: 'visible' });
      await loaded.page.getByRole('button', { name: 'Edit', exact: true }).click();
      assert.equal(await loaded.page.locator('#edit-forms').isHidden(), true);
      assert.equal(await loaded.page.locator('#readonly-note').isVisible(), true);
      assert.equal(new URL(loaded.page.url()).origin, ORIGIN);
    } finally {
      await browser?.close();
      closeSocket(desktop?.socket);
      await worker.dispose();
    }
  },
);
