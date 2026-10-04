import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

export const SCANNER_ORIGIN = 'https://scanner-fixture.test';
export const SCANNER_DEVICE = 'dae5d95f-d68b-4cfe-809c-af23bf8fa629';
export const SCANNER_CODE = 'ScannerTest123';
export const SCANNER_LINK =
  'https://kerfdesk-phone-control.cisgz3a.workers.dev/control#device=' +
  SCANNER_DEVICE +
  '&code=' +
  SCANNER_CODE;
const publicRoot = new URL('../public/', import.meta.url);
let encoder;

export async function qrPixels(text = SCANNER_LINK) {
  if (!encoder) {
    const result = await build({
      entryPoints: [
        fileURLToPath(new URL('../../../src/core/barcode/qr-encode.ts', import.meta.url)),
      ],
      bundle: true,
      platform: 'node',
      format: 'esm',
      write: false,
    });
    encoder = await import(
      'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')
    );
  }
  const result = encoder.encodeQr(text, { errorCorrection: 'M' });
  if (!result.ok) throw new Error('Synthetic pairing QR fixture could not be encoded.');
  return { size: result.symbol.size, modules: Array.from(result.symbol.modules) };
}

export function installScannerCamera(options = {}) {
  const runtime = {
    calls: [],
    tracks: [],
    detections: 0,
    decoding: 0,
    maximum: 0,
    values: options.values ?? [],
    cameraMode: options.cameraMode ?? 'ok',
    detectorMode: options.detectorMode ?? 'native',
  };
  globalThis.scannerFixture = runtime;
  function frameStream() {
    const canvas = globalThis.document.createElement('canvas');
    const qr = options.qr;
    canvas.width = canvas.height = qr ? (qr.size + 8) * 8 : 512;
    const context = canvas.getContext('2d');
    context.fillStyle = options.inverted ? '#000' : '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = options.inverted ? '#fff' : '#000';
    if (qr)
      for (let y = 0; y < qr.size; y++)
        for (let x = 0; x < qr.size; x++)
          if (qr.modules[y * qr.size + x]) context.fillRect((x + 4) * 8, (y + 4) * 8, 8, 8);
    const stream = canvas.captureStream(10);
    for (const track of stream.getTracks()) {
      const original = track.stop.bind(track);
      track.stop = () => {
        runtime.tracks.push(track.id);
        original();
      };
    }
    runtime.stream = stream;
    runtime.canvas = canvas;
    stream.getVideoTracks()[0].requestFrame?.();
    return stream;
  }
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: async (constraints) => {
        runtime.calls.push(constraints);
        if (runtime.cameraMode === 'hold')
          await new Promise((resolve) => {
            runtime.releaseCamera = resolve;
          });
        const name = {
          deny: 'NotAllowedError',
          missing: 'NotFoundError',
          busy: 'NotReadableError',
        }[runtime.cameraMode];
        if (name) throw new globalThis.DOMException('Synthetic camera request failed.', name);
        return frameStream();
      },
    },
  });
  if (runtime.detectorMode === 'absent') globalThis.BarcodeDetector = undefined;
  else
    globalThis.BarcodeDetector = class {
      static async getSupportedFormats() {
        if (runtime.detectorMode === 'holdFormats')
          await new Promise((resolve) => {
            runtime.releaseFormats = resolve;
          });
        return runtime.detectorMode === 'unsupported' ? ['code_128'] : ['qr_code'];
      }
      constructor(config) {
        runtime.config = config;
      }
      async detect() {
        runtime.detections++;
        runtime.decoding++;
        runtime.maximum = Math.max(runtime.maximum, runtime.decoding);
        try {
          if (runtime.detectorMode === 'throw') throw new Error('Synthetic unsupported detector.');
          if (runtime.detectorMode === 'hold')
            return await new Promise((resolve) => {
              runtime.releaseDetect = (value) => resolve(value.map((rawValue) => ({ rawValue })));
            });
          const value = runtime.values.shift();
          return typeof value === 'string' ? [{ rawValue: value }] : [];
        } finally {
          runtime.decoding--;
        }
      }
    };
}

const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/control.css"><link rel="stylesheet" href="/control-scanner.css"></head><body><main class="shell"><section class="card" id="pair-card"><h2>Connect to your computer</h2><button id="scan-pairing" class="secondary" type="button">Scan QR code</button><section id="pair-scanner" hidden><video id="pair-scanner-video" autoplay muted playsinline></video><p id="pair-scanner-status" role="status" aria-live="polite"></p><button id="cancel-pair-scanner" type="button">Cancel scan</button></section><form id="pair-form"><label>Computer ID<input name="deviceId" value="previous-computer"></label><label>Pairing code<input name="code" value="previous-code"></label><label>Name for this phone<input name="clientLabel" value="My phone"></label><label><input name="edit" type="checkbox">Request editing permission</label><label><input name="control" type="checkbox">Request machine control</label><button type="submit">Request PC approval</button></form><p id="pair-status" role="status">The code expires after five minutes and works once.</p></section></main><script type="module">import { bindPairingScanner } from '/control-scanner.js'; globalThis.scanner = bindPairingScanner(); globalThis.pairRequests = 0; document.querySelector('#pair-form').addEventListener('submit', (event) => { event.preventDefault(); globalThis.pairRequests++; }); document.body.dataset.ready = 'true';</script></body></html>`;

export async function scannerPage(browser, options = {}) {
  const context = await browser.newContext({
    viewport: { width: options.width ?? 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.clock.install();
  await page.addInitScript(installScannerCamera, options);
  if (options.init) await page.addInitScript(options.init);
  const errors = [],
    requests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    requests.push({ url: route.request().url(), method: route.request().method() });
    if (url.origin !== SCANNER_ORIGIN) return route.abort();
    if (options.decoderUnavailable && url.pathname === '/control-scanner-decoder.js')
      return route.abort();
    if (url.pathname === '/control') return route.fulfill({ contentType: 'text/html', body: html });
    if (!/^\/control(?:-scanner(?:-[a-z]+)?)?\.(?:js|css)$/.test(url.pathname))
      return route.abort();
    return route.fulfill({
      contentType: url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css',
      body: await readFile(new URL(url.pathname.slice(1), publicRoot), 'utf8'),
    });
  });
  await page.goto(SCANNER_ORIGIN + '/control');
  await page.waitForFunction(() => globalThis.document.body.dataset.ready === 'true');
  return { context, page, errors, requests };
}

export async function startScanner(page) {
  await page.locator('#scan-pairing').click();
  await page.waitForFunction(() => globalThis.scannerFixture.calls.length > 0);
}

export async function cameraReady(page) {
  await page.waitForFunction(
    () =>
      globalThis.scannerFixture.detections > 0 ||
      globalThis.document.querySelector('#pair-form [name=code]').value === 'ScannerTest123',
  );
}

export async function visible(page, hidden) {
  await page.evaluate((value) => {
    Object.defineProperty(globalThis.document, 'hidden', { configurable: true, value });
    globalThis.document.dispatchEvent(new globalThis.Event('visibilitychange'));
  }, hidden);
}

export async function scannerState(page) {
  return page.evaluate(() => ({
    device: globalThis.document.querySelector('#pair-form [name=deviceId]').value,
    code: globalThis.document.querySelector('#pair-form [name=code]').value,
    edit: globalThis.document.querySelector('#pair-form [name=edit]').checked,
    control: globalThis.document.querySelector('#pair-form [name=control]').checked,
    requests: globalThis.pairRequests,
    storage: globalThis.localStorage.length + globalThis.sessionStorage.length,
    stopped: globalThis.scannerFixture.tracks.length,
    tracksEnded:
      globalThis.scannerFixture.stream
        ?.getTracks()
        .every((track) => track.readyState === 'ended') ?? false,
    maximum: globalThis.scannerFixture.maximum,
    attached: globalThis.document.querySelector('#pair-scanner-video').srcObject !== null,
  }));
}

/** Real phone markup and modules; hold the initial session read to reproduce loading admission. */
export async function pendingPhonePage(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [],
    requests = [];
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await page.addInitScript(installScannerCamera);
  page.on('pageerror', (error) => errors.push(error.message));
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    requests.push({ url: route.request().url(), method: route.request().method() });
    if (url.origin !== SCANNER_ORIGIN) return route.abort();
    if (url.pathname === '/api/session') {
      await pending;
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ status: 'none' }),
      });
    }
    const file = url.pathname === '/control' ? 'control.html' : url.pathname.slice(1);
    if (!/^control(?:-[a-z]+)*\.(?:html|js|css)$/.test(file) && file !== 'pairing.js')
      return route.abort();
    return route.fulfill({
      contentType: file.endsWith('.js')
        ? 'text/javascript'
        : file.endsWith('.css')
          ? 'text/css'
          : 'text/html',
      body: await readFile(new URL(file, publicRoot), 'utf8'),
    });
  });
  await page.goto(SCANNER_ORIGIN + '/control');
  await page.waitForFunction(() => globalThis.document.body.getAttribute('aria-busy') === 'true');
  return { context, page, errors, requests, release };
}
