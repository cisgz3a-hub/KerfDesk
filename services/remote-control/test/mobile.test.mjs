import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { ORIGIN, start, connectDesktop, pairPhone, workspace, authorizeMcp } from './support.mjs';

const closeSocket = (socket) => {
  if (socket && socket.readyState < 2) socket.close();
};
function syntheticDesktop(desktop, commands) {
  let revision = 1;
  desktop.socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.type !== 'command') return;
    const { name, args } = message.command;
    commands.push({ name, args });
    let result;
    if (name === 'get_workspace')
      result = {
        ...workspace,
        revision: `audit-${revision}`,
        artwork: [
          {
            id: 'artwork-1',
            type: 'text',
            name: '<script>synthetic</script>',
            bounds: { xMm: 0, yMm: 0, widthMm: 50, heightMm: 10 },
          },
        ],
        operations: [
          {
            id: 'op-1',
            type: 'laser_vector',
            name: 'Laser cut',
            enabled: true,
            powerPercent: 30,
            speedMmPerMin: 1000,
            passes: 1,
          },
        ],
        totalArtwork: 1,
        totalOperations: 1,
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
      revision += 1;
      result = { revision: `audit-${revision}` };
    }
    desktop.send({ type: 'result', requestId: message.requestId, result });
  });
}
async function browserPage(worker, cookies = [], allowSyntheticCallback = false, receipts = []) {
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
    if (
      allowSyntheticCallback &&
      request.url().startsWith('https://audit-client.example/callback')
    ) {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body>Synthetic MCP callback</body></html>',
      });
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
      syntheticDesktop(desktop, commands);
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
      await page.waitForFunction(
        () => document.querySelector('#notice').textContent === 'Updated on your computer.',
      );
      const operation = commands.find((command) => command.name === 'update_operation');
      assert.equal(operation.args.patch.powerPercent, 25);
      assert.equal(operation.args.expectedRevision, 'audit-1');
      assert.match(operation.args.requestId, /^[0-9a-f-]{36}$/);
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

test(
  'mobile Chrome: explicit MCP consent returns through the approved client callback',
  { timeout: 30_000 },
  async () => {
    const worker = start();
    let desktop;
    let browser;
    try {
      desktop = await connectDesktop(worker);
      const phone = await pairPhone(worker, desktop, ['read']);
      let consentUrl;
      await authorizeMcp(worker, phone, 'kerfdesk:read', {
        beforeConsent(url) {
          consentUrl = url.href;
        },
      });
      const [name, value] = phone.cookie.split('=');
      const receipts = [];
      const loaded = await browserPage(
        worker,
        [{ name, value, url: ORIGIN, httpOnly: true, secure: true, sameSite: 'Strict' }],
        true,
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
        await loaded.page.waitForURL('https://audit-client.example/callback?**', { timeout: 8000 });
      } catch {
        throw new Error(
          `MCP callback did not load. Browser reported a form-action CSP rejection: ${browserErrors.some((message) => message.includes('form-action'))}. Sanitized routes: ${JSON.stringify(receipts)}.`,
        );
      }
      const callback = new URL(loaded.page.url());
      assert.ok(callback.searchParams.get('code'));
      assert.equal(callback.searchParams.get('ownerSecret'), null);
      assert.equal(callback.searchParams.get('access_token'), null);
    } finally {
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
