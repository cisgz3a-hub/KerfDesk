/* global process, console, URL, Response, setTimeout, clearTimeout, require, __dirname */
/* eslint-disable @typescript-eslint/no-require-imports -- Electron CommonJS main entry registers its scheme before app readiness. */
// Run after pnpm build:electron-main and pnpm build:bundle:desktop:
// pnpm exec electron scripts/verify-offline-nesting-runtime.cjs --output <report.json>
// No machine APIs or user profile are opened. Tests the shipped worker/WASM,
// native protocol isolation and CSP together in a hidden sandboxed renderer.
const { app, BrowserWindow, protocol, net, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const outputIndex = process.argv.indexOf('--output');
const output = outputIndex < 0 ? null : process.argv[outputIndex + 1];
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kerfdesk-offline-nesting-'));
app.setPath('userData', profile);
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);
const logs = [];
let watchdog;

function finish(report, exitCode) {
  clearTimeout(watchdog);
  const result = { electron: process.versions.electron, profile, ...report, logs };
  if (output) {
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(result, null, 2));
  }
  console.log(JSON.stringify({ ok: exitCode === 0, ...report.summary, output }));
  app.exit(exitCode);
}

function polygon(points) {
  return {
    type: 'general',
    is_path: false,
    elements: points.map((p, index) => ({
      type: 'LineSegment',
      start: { x: p[0], y: p[1] },
      end: { x: points[(index + 1) % points.length][0], y: points[(index + 1) % points.length][1] },
    })),
  };
}

function fixture() {
  return {
    objective: 'BinPacking',
    bin_types: [
      {
        ...polygon([
          [0, 0],
          [100, 0],
          [100, 100],
          [0, 100],
        ]),
        copies: 10,
        copies_min: 0,
        cost: 10000,
        item_bin_minimum_spacing: 1,
      },
    ],
    item_types: [
      {
        copies: 8,
        copies_min: 8,
        profit: 816,
        allowed_rotations: [0, 90, 180, 270].map((angle) => ({
          start: angle,
          end: angle,
          mirror: false,
        })),
        shapes: [
          polygon([
            [0, 0],
            [40, 0],
            [40, 12],
            [12, 12],
            [12, 40],
            [0, 40],
          ]),
        ],
      },
    ],
    parameters: {
      item_item_minimum_spacing: 2,
      leftover_mode: 'BottomLeft',
      open_dimension_xy_aspect_ratio: -1,
    },
  };
}

app
  .whenReady()
  .then(async () => {
    watchdog = setTimeout(() => finish({ error: 'Native runtime probe timed out.' }, 1), 45000);
    const { rendererResponsePolicyHeaders, withRendererIsolation } = await import(
      pathToFileURL(path.join(root, 'dist-electron/renderer-isolation.js')).href
    );
    const { mainWindowWebPreferences } = await import(
      pathToFileURL(path.join(root, 'dist-electron/desktop-window-options.js')).href
    );
    const csp = fs
      .readFileSync(path.join(root, 'dist/web/_headers'), 'utf8')
      .match(/Content-Security-Policy: (.*)/)?.[1];
    if (!csp || /(?:^|\s)'unsafe-eval'(?:\s|;|$)/.test(csp))
      throw new Error('The probe requires the production policy without JavaScript unsafe-eval.');
    session.defaultSession.webRequest.onHeadersReceived((details, callback) =>
      callback({
        responseHeaders: rendererResponsePolicyHeaders(csp, details.responseHeaders),
      }),
    );
    const assetRoot = path.join(root, 'dist/web');
    protocol.handle('app', async (request) => {
      const url = new URL(request.url);
      if (url.hostname !== 'app') return new Response('Not Found', { status: 404 });
      logs.push({ request: url.pathname });
      if (url.pathname === '/')
        return withRendererIsolation(
          new Response('<!doctype html><title>Offline nesting runtime verification</title>', {
            headers: { 'Content-Type': 'text/html' },
          }),
        );
      const file = path.resolve(assetRoot, url.pathname.replace(/^\/+/, ''));
      const relative = path.relative(assetRoot, file);
      if (relative.startsWith('..') || path.isAbsolute(relative))
        return new Response('', { status: 404 });
      return withRendererIsolation(await net.fetch(pathToFileURL(file).href));
    });
    const win = new BrowserWindow({ show: false, webPreferences: mainWindowWebPreferences(false) });
    win.webContents.on('console-message', (event) =>
      logs.push({ console: event.message, level: event.level }),
    );
    await win.loadURL('app://app/');
    const result = await win.webContents.executeJavaScript(`(async () => {
    const isolated = crossOriginIsolated;
    const messages = await new Promise(resolve => {
      const collected = [];
      const worker = new Worker('app://app/packing-solver-worker.js');
      const done = value => { clearTimeout(timer); worker.terminate(); resolve(value); };
      const timer = setTimeout(() => done([...collected, { kind: 'timeout' }]), 30000);
      worker.onerror = event => done([...collected, { kind: 'error', message: event.message || String(event) }]);
      worker.onmessage = event => {
        collected.push(event.data);
        if (event.data.kind === 'complete' || event.data.kind === 'error') done(collected);
      };
      worker.postMessage({ kind: 'start', instance: ${JSON.stringify(JSON.stringify(fixture()))} });
    });
    return { isolated, messages };
  })()`);
    const certificates = result.messages
      .filter((message) => message.kind === 'certificate')
      .map((message) => JSON.parse(message.certificate));
    const best = certificates.at(-1);
    const items = best?.bins.flatMap((bin) => bin.items) ?? [];
    const summary = {
      isolated: result.isolated,
      certificates: certificates.length,
      bins: best?.bins.length ?? 0,
      items: items.length,
    };
    const ok =
      result.isolated &&
      result.messages.at(-1)?.kind === 'complete' &&
      summary.bins === 1 &&
      summary.items === 8 &&
      items.every((item) => item.id === 0 && item.mirror === false) &&
      !logs.some((entry) => entry.level === 'error');
    win.destroy();
    finish({ summary, ...result }, ok ? 0 : 1);
  })
  .catch((error) => finish({ error: String(error), stack: error.stack }, 1));
