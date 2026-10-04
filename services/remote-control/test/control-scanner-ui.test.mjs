import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import {
  cameraReady,
  qrPixels,
  scannerPage,
  scannerState,
  SCANNER_CODE,
  SCANNER_DEVICE,
  SCANNER_LINK,
  SCANNER_ORIGIN,
  startScanner,
  visible,
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

test('camera scan fills a valid pairing link, stops video and requires an explicit approval request', async () => {
  const loaded = await scannerPage(browser, { values: [SCANNER_LINK] });
  try {
    const p = loaded.page;
    assert.equal(await p.evaluate(() => globalThis.scannerFixture.calls.length), 0);
    await startScanner(p);
    await p.waitForFunction(
      () => globalThis.document.querySelector('#pair-form [name=code]').value === 'ScannerTest123',
    );
    const result = await scannerState(p);
    assert.equal(result.device, SCANNER_DEVICE);
    assert.equal(result.code, SCANNER_CODE);
    assert.equal(result.edit, false);
    assert.equal(result.control, false);
    assert.equal(result.requests, 0);
    assert.equal(result.storage, 0);
    assert.equal(result.stopped, 1);
    assert.equal(result.tracksEnded, true);
    assert.equal(result.attached, false);
    assert.equal(result.maximum, 1);
    assert.deepEqual(await p.evaluate(() => globalThis.scannerFixture.calls[0]), {
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    assert.deepEqual(await p.evaluate(() => globalThis.scannerFixture.config), {
      formats: ['qr_code'],
    });
    assert.match(await p.locator('#pair-status').textContent(), /request approval/);
    assert.equal(new URL(p.url()).hash, '');
    assert.ok(
      loaded.requests.every(
        (item) => item.method === 'GET' && new URL(item.url).origin === SCANNER_ORIGIN,
      ),
    );
    await p.locator('#pair-form button[type=submit]').click();
    assert.equal((await scannerState(p)).requests, 1);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

test('invalid QR data stays in the scanner, does not expose its content or change existing fields', async () => {
  const secret = 'NeverDisplayThis123';
  const bad = 'https://outside.test/control#device=' + SCANNER_DEVICE + '&code=' + secret;
  const loaded = await scannerPage(browser, { values: [bad] });
  try {
    await startScanner(loaded.page);
    await cameraReady(loaded.page);
    const result = await scannerState(loaded.page);
    assert.equal(result.device, 'previous-computer');
    assert.equal(result.code, 'previous-code');
    assert.equal(result.requests, 0);
    assert.equal(result.storage, 0);
    assert.equal(result.stopped, 0);
    assert.match(
      await loaded.page.locator('#pair-scanner-status').textContent(),
      /not a KerfDesk pairing/,
    );
    assert.equal((await loaded.page.locator('body').innerText()).includes(secret), false);
    assert.equal(
      loaded.requests.some(
        (item) => item.url.includes(secret) || new URL(item.url).origin !== SCANNER_ORIGIN,
      ),
      false,
    );
    await loaded.page.locator('#cancel-pair-scanner').click();
    assert.equal((await scannerState(loaded.page)).tracksEnded, true);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

for (const mode of ['deny', 'missing', 'busy'])
  test(
    'camera scan explains ' + mode + ' without submitting or changing pairing fields',
    async () => {
      const loaded = await scannerPage(browser, { cameraMode: mode });
      try {
        await startScanner(loaded.page);
        await loaded.page.locator('#pair-scanner').waitFor({ state: 'hidden' });
        const result = await scannerState(loaded.page);
        assert.equal(result.code, 'previous-code');
        assert.equal(result.requests, 0);
        assert.equal(await loaded.page.locator('#scan-pairing').isEnabled(), true);
        assert.match(
          await loaded.page.locator('#pair-status').textContent(),
          /not allowed|No usable camera|busy or unavailable/,
        );
        assert.deepEqual(loaded.errors, []);
      } finally {
        await loaded.context.close();
      }
    },
  );

test('camera API unavailable keeps manual setup usable and never asks for camera access', async () => {
  const loaded = await scannerPage(browser, {
    init: () =>
      Object.defineProperty(globalThis.navigator, 'mediaDevices', {
        configurable: true,
        value: undefined,
      }),
  });
  try {
    await loaded.page.locator('#scan-pairing').click();
    assert.equal(await loaded.page.evaluate(() => globalThis.scannerFixture.calls.length), 0);
    assert.equal(await loaded.page.locator('#pair-scanner').isHidden(), true);
    assert.match(
      await loaded.page.locator('#pair-status').textContent(),
      /unavailable in this browser/,
    );
    assert.equal((await scannerState(loaded.page)).requests, 0);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

test('busy pairing setup disables camera admission until the surrounding page enables it', async () => {
  const loaded = await scannerPage(browser, { values: [SCANNER_LINK] });
  try {
    const p = loaded.page;
    await p.evaluate(() => globalThis.scanner.setEnabled(false));
    assert.equal(await p.locator('#scan-pairing').isDisabled(), true);
    await p.locator('#scan-pairing').evaluate((button) => button.click());
    assert.equal(await p.evaluate(() => globalThis.scannerFixture.calls.length), 0);
    assert.equal(await p.locator('#pair-scanner').isHidden(), true);
    await p.evaluate(() => globalThis.scanner.setEnabled(true));
    await startScanner(p);
    await p.waitForFunction(
      () => globalThis.document.querySelector('#pair-form [name=code]').value === 'ScannerTest123',
    );
    assert.equal((await scannerState(p)).requests, 0);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

test('disabling an active scan fences its late result and keeps admission disabled until re-enabled', async () => {
  const loaded = await scannerPage(browser, { detectorMode: 'hold' });
  try {
    const p = loaded.page;
    await startScanner(p);
    await cameraReady(p);
    await p.evaluate(() => globalThis.scanner.setEnabled(false));
    assert.equal((await scannerState(p)).tracksEnded, true);
    assert.equal(await p.locator('#scan-pairing').isDisabled(), true);
    await p.evaluate((link) => globalThis.scannerFixture.releaseDetect([link]), SCANNER_LINK);
    await p.clock.runFor(501);
    assert.equal((await scannerState(p)).code, 'previous-code');
    assert.equal(await p.locator('#scan-pairing').isDisabled(), true);
    await p.evaluate((link) => {
      globalThis.scannerFixture.detectorMode = 'native';
      globalThis.scannerFixture.values.push(link);
      globalThis.scanner.setEnabled(true);
    }, SCANNER_LINK);
    await startScanner(p);
    await p.waitForFunction(
      () => globalThis.document.querySelector('#pair-form [name=code]').value === 'ScannerTest123',
    );
    assert.equal((await scannerState(p)).requests, 0);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

for (const action of ['cancel', 'hide', 'pagehide', 'disconnect', 'submit', 'track-ended'])
  test(
    'camera tracks stop on ' + action + ' and late native detection cannot fill or submit',
    async () => {
      const loaded = await scannerPage(browser, { detectorMode: 'hold' });
      try {
        const p = loaded.page;
        await startScanner(p);
        await cameraReady(p);
        if (action === 'cancel') await p.locator('#cancel-pair-scanner').click();
        else if (action === 'hide') await visible(p, true);
        else
          await p.evaluate((value) => {
            if (value === 'pagehide')
              globalThis.dispatchEvent(new globalThis.PageTransitionEvent('pagehide'));
            if (value === 'disconnect') globalThis.scanner.stop();
            if (value === 'submit')
              globalThis.document
                .querySelector('#pair-form')
                .dispatchEvent(new globalThis.Event('submit', { bubbles: true, cancelable: true }));
            if (value === 'track-ended')
              globalThis.scannerFixture.stream
                .getVideoTracks()[0]
                .dispatchEvent(new globalThis.Event('ended'));
          }, action);
        assert.equal((await scannerState(p)).tracksEnded, true);
        await p.evaluate((value) => globalThis.scannerFixture.releaseDetect([value]), SCANNER_LINK);
        await p.clock.runFor(501);
        const result = await scannerState(p);
        assert.equal(result.code, 'previous-code');
        assert.equal(result.attached, false);
        assert.equal(result.requests, action === 'submit' ? 1 : 0);
        assert.equal(await p.locator('#pair-scanner').isHidden(), true);
        assert.deepEqual(loaded.errors, []);
      } finally {
        await loaded.context.close();
      }
    },
  );

test('cancelled camera permission request releases a late stream and lets a replacement scan succeed', async () => {
  const loaded = await scannerPage(browser, { cameraMode: 'hold' });
  try {
    const p = loaded.page;
    await startScanner(p);
    await p.locator('#cancel-pair-scanner').click();
    await p.evaluate(() => globalThis.scannerFixture.releaseCamera());
    await p.waitForFunction(() => globalThis.scannerFixture.tracks.length > 0);
    assert.equal((await scannerState(p)).code, 'previous-code');
    assert.equal((await scannerState(p)).attached, false);
    await p.evaluate((link) => {
      globalThis.scannerFixture.cameraMode = 'ok';
      globalThis.scannerFixture.values.push(link);
    }, SCANNER_LINK);
    await startScanner(p);
    await p.waitForFunction(
      () => globalThis.document.querySelector('#pair-form [name=code]').value === 'ScannerTest123',
    );
    assert.equal((await scannerState(p)).device, SCANNER_DEVICE);
    assert.equal((await scannerState(p)).requests, 0);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

test('unanswered camera permission is bounded and a late approval cannot reopen the stopped scan', async () => {
  const loaded = await scannerPage(browser, { cameraMode: 'hold' });
  try {
    await startScanner(loaded.page);
    await loaded.page.clock.runFor(15_001);
    assert.match(await loaded.page.locator('#pair-status').textContent(), /Scanning did not start/);
    assert.equal(await loaded.page.locator('#scan-pairing').isEnabled(), true);
    await loaded.page.evaluate(() => globalThis.scannerFixture.releaseCamera());
    await loaded.page.waitForFunction(() => globalThis.scannerFixture.tracks.length > 0);
    assert.equal((await scannerState(loaded.page)).attached, false);
    assert.equal((await scannerState(loaded.page)).code, 'previous-code');
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

test('hung native detector stops camera with useful retry feedback and ignores its late valid result', async () => {
  const loaded = await scannerPage(browser, { detectorMode: 'hold' });
  try {
    await startScanner(loaded.page);
    await cameraReady(loaded.page);
    await loaded.page.clock.runFor(5001);
    assert.match(
      await loaded.page.locator('#pair-status').textContent(),
      /reader stopped responding/,
    );
    assert.equal((await scannerState(loaded.page)).tracksEnded, true);
    await loaded.page.evaluate(
      (link) => globalThis.scannerFixture.releaseDetect([link]),
      SCANNER_LINK,
    );
    await loaded.page.clock.runFor(501);
    assert.equal((await scannerState(loaded.page)).code, 'previous-code');
    assert.equal((await scannerState(loaded.page)).requests, 0);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

for (const mode of ['absent', 'unsupported', 'throw'])
  test(
    'self-hosted decoder reads the actual desktop QR geometry when native detection is ' + mode,
    async () => {
      const loaded = await scannerPage(browser, {
        detectorMode: mode,
        qr: await qrPixels(),
        inverted: mode === 'unsupported',
      });

      try {
        await startScanner(loaded.page);
        await loaded.page.waitForFunction(
          () =>
            globalThis.document.querySelector('#pair-form [name=code]').value === 'ScannerTest123',
        );
        const result = await scannerState(loaded.page);
        assert.equal(result.device, SCANNER_DEVICE);
        assert.equal(result.requests, 0);
        assert.equal(result.storage, 0);
        assert.equal(result.tracksEnded, true);
        assert.ok(
          loaded.requests.some(
            (item) => item.url === SCANNER_ORIGIN + '/control-scanner-decoder.js',
          ),
        );
        assert.ok(loaded.requests.every((item) => new URL(item.url).origin === SCANNER_ORIGIN));
        assert.deepEqual(loaded.errors, []);
      } finally {
        await loaded.context.close();
      }
    },
  );

test('a native reader returning no results gets a local decoder check without overlapping reads', async () => {
  const loaded = await scannerPage(browser, { qr: await qrPixels() });
  try {
    await startScanner(loaded.page);
    await cameraReady(loaded.page);
    await loaded.page.clock.runFor(801);
    await loaded.page.waitForFunction(
      () => globalThis.document.querySelector('#pair-form [name=code]').value === 'ScannerTest123',
    );
    const result = await scannerState(loaded.page);
    assert.equal(result.device, SCANNER_DEVICE);
    assert.equal(result.maximum, 1);
    assert.equal(result.requests, 0);
    assert.equal(result.tracksEnded, true);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

test('decoder asset failure stops camera and preserves manual setup', async () => {
  const loaded = await scannerPage(browser, {
    detectorMode: 'absent',
    decoderUnavailable: true,
  });
  try {
    await startScanner(loaded.page);
    await loaded.page.locator('#pair-scanner').waitFor({ state: 'hidden' });
    assert.equal((await scannerState(loaded.page)).tracksEnded, true);
    assert.equal((await scannerState(loaded.page)).code, 'previous-code');
    assert.equal((await scannerState(loaded.page)).requests, 0);
    assert.equal(await loaded.page.locator('#scan-pairing').isEnabled(), true);
    assert.match(
      await loaded.page.locator('#pair-status').textContent(),
      /QR scanning is unavailable/,
    );
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

test('a delayed native format check cannot reopen or use the camera after cancellation', async () => {
  const loaded = await scannerPage(browser, {
    detectorMode: 'holdFormats',
    values: [SCANNER_LINK],
  });
  try {
    await startScanner(loaded.page);
    await loaded.page.waitForFunction(
      () => typeof globalThis.scannerFixture.releaseFormats === 'function',
    );
    await loaded.page.locator('#cancel-pair-scanner').click();
    assert.equal((await scannerState(loaded.page)).tracksEnded, true);
    await loaded.page.evaluate(() => globalThis.scannerFixture.releaseFormats());
    await loaded.page.clock.runFor(501);
    assert.equal((await scannerState(loaded.page)).code, 'previous-code');
    assert.equal((await scannerState(loaded.page)).requests, 0);
    assert.equal(await loaded.page.evaluate(() => globalThis.scannerFixture.detections), 0);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});

test('an abandoned scan is bounded, releases its camera and does not create an approval request', async () => {
  const loaded = await scannerPage(browser);
  try {
    await startScanner(loaded.page);
    await cameraReady(loaded.page);
    await loaded.page.clock.fastForward(120_001);
    assert.equal((await scannerState(loaded.page)).tracksEnded, true);
    assert.equal((await scannerState(loaded.page)).code, 'previous-code');
    assert.equal((await scannerState(loaded.page)).requests, 0);
    assert.match(await loaded.page.locator('#pair-status').textContent(), /after two minutes/);
    assert.equal(await loaded.page.locator('#scan-pairing').isEnabled(), true);
    assert.deepEqual(loaded.errors, []);
  } finally {
    await loaded.context.close();
  }
});
