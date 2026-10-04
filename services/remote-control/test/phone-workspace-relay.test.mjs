import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { ORIGIN, start, connectDesktop, pairPhone } from './support.mjs';
import { capture, fixtureState, idle, openTask, readResult } from './phone-workspace-support.mjs';

test(
  'workerd phone page: approved frontend modules, CSP-rendered PNG, text edit and revoke',
  { timeout: 30000 },
  async () => {
    const worker = start();
    let desktop, browser;
    const state = fixtureState();
    try {
      desktop = await connectDesktop(worker);
      desktop.socket.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);
        if (message.type !== 'command') return;
        const { name, args } = message.command;
        state.commands.push({ name, args });
        let result = readResult(state, name);
        if (!result) {
          if (name !== 'update_text') throw new Error('Unexpected fixture write');
          Object.assign(state.text, args.patch);
          state.revision += 1;
          state.edits += 1;
          result = {
            revision: `fixture-${state.revision}`,
            changedArtworkIds: [args.artworkId],
            changedFields: Object.keys(args.patch),
          };
        }
        desktop.send({ type: 'result', requestId: message.requestId, result });
      });
      const phone = await pairPhone(worker, desktop, ['read', 'edit']);
      browser = await chromium.launch({ channel: 'chrome', headless: true });
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      const [cookieName, cookieValue] = phone.cookie.split('=');
      await context.addCookies([
        {
          name: cookieName,
          value: cookieValue,
          url: ORIGIN,
          httpOnly: true,
          secure: true,
          sameSite: 'Strict',
        },
      ]);
      const paths = [];
      await context.route('**/*', async (route) => {
        const request = route.request();
        if (!request.url().startsWith(ORIGIN + '/')) return route.abort();
        const response = await worker.dispatchFetch(request.url(), {
          method: request.method(),
          headers: request.headers(),
          body: request.postData() ?? undefined,
          redirect: 'manual',
        });
        paths.push({ path: new URL(request.url()).pathname, status: response.status });
        await route.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: Buffer.from(await response.arrayBuffer()),
        });
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(ORIGIN + '/control');
      await idle(page);
      await page.waitForFunction(
        () => globalThis.document.getElementById('workspace-preview').naturalWidth > 0,
      );
      assert.equal(
        await page.locator('#workspace-preview').evaluate((image) => image.naturalWidth),
        1,
      );
      for (const path of ['/control-edit.js', '/control-model.js', '/control-workspace.js'])
        assert.ok(paths.some((entry) => entry.path === path && entry.status === 200));
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      await page.getByRole('button', { name: 'Load text from PC', exact: true }).click();
      await idle(page);
      await page.locator('#text-edit-form [name=text]').fill('Real relay edited text');
      await openTask(page, 'text-spacing');
      await page.locator('#text-edit-form [name=letterSpacing]').fill('.25');
      await page.getByRole('button', { name: 'Update text', exact: true }).click();
      await idle(page);
      assert.equal(state.edits, 1);
      assert.equal(state.text.text, 'Real relay edited text');
      assert.equal(state.text.letterSpacing, 0.25);
      assert.equal(await page.locator('canvas').count(), 0);
      assert.deepEqual(errors, []);
      await capture(page, 'workerd-phone-edit-fixture');
      await openTask(page, 'connection-options');
      await page.getByRole('button', { name: 'Disconnect this phone', exact: true }).click();
      await idle(page);
      assert.equal(await page.locator('#workspace-area').isHidden(), true);
      assert.equal(await page.locator('#workspace-preview').getAttribute('src'), null);
      assert.ok(paths.some((entry) => entry.path === '/api/client/revoke' && entry.status === 200));
    } finally {
      await browser?.close();
      if (desktop?.socket.readyState < 2) desktop.socket.close();
      await worker.dispose();
    }
  },
);
