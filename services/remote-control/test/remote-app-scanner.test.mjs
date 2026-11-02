import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, launch, ORIGIN, phonePage } from './remote-app-support.mjs';
import {
  installScannerCamera,
  qrPixels,
  SCANNER_CODE,
  SCANNER_DEVICE,
  visible,
} from './control-scanner-support.mjs';

const APP_LINK = `${ORIGIN}/app/#device=${SCANNER_DEVICE}&code=${SCANNER_CODE}`;

let browser;
before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
});

async function scanPage(options) {
  const state = fixture({ errors: [] });
  const loaded = await phonePage(browser, state, {
    paired: false,
    init: { script: installScannerCamera, arg: { qr: await qrPixels(APP_LINK), ...options } },
  });
  await loaded.page.getByRole('button', { name: /Scan the code on your PC/ }).click();
  return { ...loaded, state };
}
async function readsPairing(page) {
  await page.getByLabel('Computer ID').waitFor({ timeout: 8000 });
  assert.equal(await page.getByLabel('Computer ID').inputValue(), SCANNER_DEVICE);
  assert.equal(await page.getByLabel('Pairing code').inputValue(), SCANNER_CODE);
  assert.equal(
    await page.evaluate(() =>
      globalThis.scannerFixture.stream.getTracks().every((track) => track.readyState === 'ended'),
    ),
    true,
  );
}

for (const [detectorMode, reader] of [
  ['native', 'finds nothing'],
  ['throw', 'fails'],
  ['unsupported', 'lacks QR support'],
  ['absent', 'missing'],
])
  test(`phone scanner reads the PC's QR code when the platform reader ${reader}`, async () => {
    const { page, context, state } = await scanPage({ detectorMode });
    try {
      await readsPairing(page);
      assert.deepEqual(state.errors, []);
    } finally {
      await context.close();
    }
  });

test('phone scanner asks for a rear camera with enough resolution to read a dense code', async () => {
  const { page, context } = await scanPage({ detectorMode: 'absent' });
  try {
    await readsPairing(page);
    const [constraints] = await page.evaluate(() => globalThis.scannerFixture.calls);
    assert.equal(constraints.audio, false);
    assert.deepEqual(constraints.video.facingMode, { ideal: 'environment' });
    assert.ok(constraints.video.width.ideal >= 1280 && constraints.video.height.ideal >= 720);
  } finally {
    await context.close();
  }
});

test('phone scanner resumes the camera after the page returns to the foreground', async () => {
  const { page, context } = await scanPage({ detectorMode: 'hold' });
  try {
    await page.waitForFunction(() => globalThis.scannerFixture.detections > 0);
    await visible(page, true);
    await page.waitForFunction(() =>
      globalThis.scannerFixture.stream.getTracks().every((track) => track.readyState === 'ended'),
    );
    await page.evaluate(() => {
      globalThis.scannerFixture.detectorMode = 'absent';
      globalThis.scannerFixture.releaseDetect([]);
    });
    await visible(page, false);
    await readsPairing(page);
    assert.equal(await page.evaluate(() => globalThis.scannerFixture.calls.length), 2);
  } finally {
    await context.close();
  }
});

for (const [cameraMode, message] of [
  ['deny', /Allow the camera/],
  ['missing', /No camera was found/],
  ['busy', /in use by another app/],
])
  test(`phone scanner explains a ${cameraMode} camera instead of showing a dead viewfinder`, async () => {
    const { page, context } = await scanPage({ cameraMode });
    try {
      await page.getByText(message).waitFor();
    } finally {
      await context.close();
    }
  });
