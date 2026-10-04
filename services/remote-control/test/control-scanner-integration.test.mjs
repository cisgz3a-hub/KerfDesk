import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { capture, fixtureState, phonePage } from './phone-workspace-support.mjs';
import { widerFixtureFont } from './machine-ui-support.mjs';
import { assertNoOverflow } from './live-ui-support.mjs';
import {
  installScannerCamera,
  pendingPhonePage,
  qrPixels,
  SCANNER_CODE,
  SCANNER_DEVICE,
  SCANNER_LINK,
} from './control-scanner-support.mjs';

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

test('the actual phone page wires scanning to pairing without requesting approval or machine/editing permission', async () => {
  const state = fixtureState();
  state.unpaired = true;
  const loaded = await phonePage(browser, state, 390, { init: installScannerCamera });
  const claims = [];
  loaded.page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/pair/claim') claims.push(request.url());
  });
  try {
    const p = loaded.page;
    assert.equal(await p.evaluate(() => globalThis.scannerFixture.calls.length), 0);
    await p.evaluate((link) => globalThis.scannerFixture.values.push(link), SCANNER_LINK);
    await p.locator('#scan-pairing').click();
    await p.waitForFunction(
      () => globalThis.document.querySelector('#pair-form [name=code]').value === 'ScannerTest123',
    );
    assert.equal(await p.locator('#pair-form [name=deviceId]').inputValue(), SCANNER_DEVICE);
    assert.equal(await p.locator('#pair-form [name=code]').inputValue(), SCANNER_CODE);
    assert.equal(await p.locator('#pair-form [name=edit]').isChecked(), false);
    assert.equal(await p.locator('#pair-form [name=control]').isChecked(), false);
    assert.equal(
      await p.evaluate(() =>
        globalThis.scannerFixture.stream.getTracks().every((track) => track.readyState === 'ended'),
      ),
      true,
    );
    assert.equal(await p.locator('#pair-scanner').isHidden(), true);
    assert.deepEqual(claims, []);
    assert.deepEqual(state.commands, []);
    assert.equal(
      await p.evaluate(() => globalThis.localStorage.length + globalThis.sessionStorage.length),
      0,
    );
    assert.match(await p.locator('#pair-status').textContent(), /request approval/);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

test('initial session loading prevents a scan from being admitted and later cancelled by its response', async () => {
  const loaded = await pendingPhonePage(browser);
  try {
    const p = loaded.page;
    assert.equal(await p.locator('#scan-pairing').isDisabled(), true);
    await p.locator('#scan-pairing').evaluate((button) => button.click());
    assert.equal(await p.evaluate(() => globalThis.scannerFixture.calls.length), 0);
    assert.equal(await p.locator('#pair-scanner').isHidden(), true);
    loaded.release();
    await p.waitForFunction(() => globalThis.document.body.getAttribute('aria-busy') === 'false');
    assert.equal(await p.locator('#scan-pairing').isEnabled(), true);
    await p.evaluate((link) => globalThis.scannerFixture.values.push(link), SCANNER_LINK);
    await p.locator('#scan-pairing').click();
    await p.waitForFunction(
      () => globalThis.document.querySelector('#pair-form [name=code]').value === 'ScannerTest123',
    );
    assert.equal(
      await p.evaluate(() =>
        globalThis.scannerFixture.stream.getTracks().every((track) => track.readyState === 'ended'),
      ),
      true,
    );
    assert.equal(await p.locator('#pair-form [name=deviceId]').inputValue(), SCANNER_DEVICE);
    assert.equal(
      loaded.requests.some((request) => request.method !== 'GET'),
      false,
    );
    assert.deepEqual(loaded.errors, []);
  } finally {
    loaded.release();
    await loaded.context.close();
  }
});

for (const width of [320, 390])
  test(
    'the integrated phone scanner fits ' +
      width +
      'px with wider fonts and reachable cancel controls',
    async () => {
      const state = fixtureState();
      state.unpaired = true;
      const loaded = await phonePage(browser, state, width, { init: installScannerCamera });
      try {
        const p = loaded.page;
        await widerFixtureFont(p);
        await p.evaluate(installScannerCamera, { qr: await qrPixels(), detectorMode: 'hold' });
        await p.locator('#scan-pairing').click();
        await p.waitForFunction(() => globalThis.scannerFixture.detections > 0);
        await p.locator('#pair-scanner').scrollIntoViewIfNeeded();
        assert.equal(await p.locator('#pair-scanner').isVisible(), true);
        assert.equal(
          await p
            .locator('#pair-scanner-video')
            .evaluate((video) => video.videoWidth > 0 && video.muted && video.playsInline),
          true,
        );
        const cancel = await p.locator('#cancel-pair-scanner').boundingBox();
        assert.ok(cancel.height >= 44 && cancel.width >= 44);
        await assertNoOverflow(p);
        await capture(p, 'phone-scanner-' + width + '-wider-font-synthetic-camera');
        await p.locator('#cancel-pair-scanner').click();
        assert.equal(
          await p.evaluate(() =>
            globalThis.scannerFixture.stream
              .getTracks()
              .every((track) => track.readyState === 'ended'),
          ),
          true,
        );
        assert.equal(await p.locator('#pair-scanner').isHidden(), true);
        assert.equal(await p.locator('#scan-pairing').isEnabled(), true);
        assert.equal(await p.locator('#pair-form [name=code]').inputValue(), '');
        assert.deepEqual(loaded.errors, []);
      } finally {
        await loaded.context.close();
      }
    },
  );

test('a pairing fragment that cannot be removed also blocks the actual phone camera scanner', async () => {
  const state = fixtureState();
  state.unpaired = true;
  const loaded = await phonePage(browser, state, 390, {
    suffix: '#device=' + SCANNER_DEVICE + '&code=' + SCANNER_CODE,
    init: () => {
      globalThis.history.replaceState = () => {
        throw new Error('Synthetic history mutation denied.');
      };
      globalThis.scannerCameraRequests = 0;
      Object.defineProperty(globalThis.navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: async () => {
            globalThis.scannerCameraRequests++;
            throw new Error('No camera should be requested.');
          },
        },
      });
    },
  });
  try {
    assert.equal(await loaded.page.locator('#scan-pairing').isDisabled(), true);
    await loaded.page.locator('#scan-pairing').evaluate((button) => button.click());
    assert.equal(await loaded.page.evaluate(() => globalThis.scannerCameraRequests), 0);
    assert.equal(await loaded.page.locator('#pair-form [name=code]').inputValue(), '');
    assert.equal(state.sessionReads ?? 0, 0);
    assert.deepEqual(state.commands, []);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});
