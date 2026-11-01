// @vitest-environment node
// Opt-in probe, rolling audit v6 K2 (ADR-356 Amendment 2): the window's desktop
// network transport against a renderer stall in real Chromium, where the task
// order behind K2-P1-1 and K2-P2-1 lives. It follows the audit refuter's
// probe:
// - Electron's main process runs KerfDesk's real `app://` machine-network
//   routes, bridge and session.
// - They talk over a loopback TCP socket to a fake grblHAL that answers each
//   `?` in order after 15 ms. It can hold one answer, or stop answering.
// - The page runs the real window connection and the real heartbeat on a
//   250 ms poll, and blocks its thread with one long task right after a tick.
// The sources are only stripped of their types (TypeScript `transpileModule`).
// Run it with KERFDESK_ELECTRON_PROBE=1; it starts Electron and takes about a
// minute.

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Vitest runs from the repository root.
const repo = (): string => process.cwd();
const MAIN_SOURCES = [
  'machine-network-routes',
  'machine-network-bridge',
  'machine-network-session',
  'machine-network-telnet',
  'machine-network-protocol',
  'app-route-guard',
];
const RENDERER_SOURCES = [
  'platform/electron/desktop-machine-network',
  'platform/electron/desktop-machine-network-api',
  'core/controllers/serial-wire-encoding',
  'ui/state/laser-stream-heartbeat',
];

type Trial = {
  readonly name: string;
  readonly holdReplyMs: number;
  readonly stallMs: number;
  readonly silent: boolean;
};

type TrialResult = Trial & {
  readonly lost: boolean;
  readonly lostAtTick: number | null;
  readonly stallTick: number;
  readonly closed: boolean;
  readonly linesAfterStall: number;
};

const TRIALS: readonly Trial[] = [
  // K2-P1-1: one reply late, so the tick before the stall saw nothing new.
  { name: 'late reply, 1.8 s stall', holdReplyMs: 400, stallMs: 1_800, silent: false },
  { name: 'late reply, 1.9 s stall', holdReplyMs: 400, stallMs: 1_900, silent: false },
  { name: 'late reply, 1.95 s stall', holdReplyMs: 400, stallMs: 1_950, silent: false },
  // K2-P2-1: a stall past the request's own 5 s timeout.
  { name: '5.4 s stall', holdReplyMs: 0, stallMs: 5_400, silent: false },
  // Control: a controller that goes silent must still be declared lost.
  { name: 'silent controller, 1.9 s stall', holdReplyMs: 0, stallMs: 1_900, silent: true },
];

const MAIN_SCRIPT = String.raw`
const { app, protocol, BrowserWindow } = require('electron');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const root = __dirname;
app.setPath('userData', path.join(root, 'user-data'));
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);
const { withMachineNetworkRoutes } = require('./main/machine-network-routes.js');
const { MachineNetworkBridge } = require('./main/machine-network-bridge.js');
const STATUS = '<Run|MPos:1.000,0.000,0.000|FS:1000,100>\r\n';
const server = net.createServer((socket) => {
  let partial = '';
  let silent = false;
  let holdNext = 0;
  let readyAt = 0;
  socket.on('error', () => undefined);
  socket.on('data', (chunk) => {
    for (const byte of chunk) {
      if (byte === 0x3f) {
        if (silent) continue;
        readyAt = Math.max(readyAt, Date.now() + (holdNext || 15));
        holdNext = 0;
        setTimeout(() => socket.destroyed || socket.write(STATUS), readyAt - Date.now());
      } else if (byte === 10) {
        if (partial.startsWith('$HOLD=')) holdNext = Number(partial.slice(6));
        if (partial === '$SILENT') silent = true;
        partial = '';
      } else if (byte !== 13) partial += String.fromCharCode(byte);
    }
  });
});
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
async function files(request) {
  const file = path.join(root, decodeURIComponent(new URL(request.url).pathname));
  if (!file.startsWith(root)) return new Response('Not found', { status: 404 });
  try {
    return new Response(fs.readFileSync(file), {
      headers: { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
app.whenReady().then(async () => {
  protocol.handle('app', withMachineNetworkRoutes(files, new MachineNetworkBridge()));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false },
  });
  try {
    await win.loadURL('app://app/probe.html#' + server.address().port);
    const result = await win.webContents.executeJavaScript('window.probeDone', true);
    process.stdout.write('PROBE_RESULT ' + result + '\n');
  } catch (error) {
    process.stdout.write('PROBE_ERROR ' + String(error) + '\n');
  }
  server.close();
  app.exit(0);
});
`;

const PAGE_SCRIPT = String.raw`
import { createDesktopMachineNetwork } from './r/platform/electron/desktop-machine-network.js';
import { detectActiveStreamHeartbeatLoss } from './r/ui/state/laser-stream-heartbeat.js';
const port = Number(location.hash.slice(1));
const TRIALS = JSON.parse(decodeURIComponent(document.body.dataset.trials));
const STALL_TICK = 8;
const LAST_TICK = STALL_TICK + 14;
const stall = new MessageChannel();
async function run(trial) {
  const ref = await createDesktopMachineNetwork().serialForTarget('127.0.0.1', port, 'grblhal-raw').requestPort();
  const serial = await ref.open({ baudRate: 115200 });
  const state = { sequence: 0, stallEnded: false, linesAfterStall: 0, closed: false };
  serial.onLine((line) => {
    if (!line.startsWith('<')) return;
    state.sequence += 1;
    if (state.stallEnded) state.linesAfterStall += 1;
  });
  serial.onClose(() => { state.closed = true; });
  stall.port1.onmessage = (event) => {
    const end = performance.now() + event.data;
    while (performance.now() < end) { /* the page's long task */ }
    state.stallEnded = true;
  };
  const streamer = { status: 'streaming', completed: 0 };
  let probe = null;
  let lostAtTick = null;
  await new Promise((done) => {
    let tick = 0;
    const handle = setInterval(() => {
      tick += 1;
      const now = Date.now();
      const observation = { sessionEpoch: 1, positionEpoch: 1, sequence: state.sequence, observedAt: now };
      const verdict = detectActiveStreamHeartbeatLoss(streamer, observation, probe, now, serial.inputReadThrough?.() ?? now);
      probe = verdict.probe;
      if (verdict.lost && lostAtTick === null) lostAtTick = tick;
      if (tick === STALL_TICK - 2 && trial.silent) void serial.write('$SILENT\n').catch(() => undefined);
      if (tick === STALL_TICK - 2 && trial.holdReplyMs > 0) void serial.write('$HOLD=' + trial.holdReplyMs + '\n').catch(() => undefined);
      void serial.write('?').catch(() => undefined);
      if (tick === STALL_TICK - 1) stall.port2.postMessage(trial.stallMs);
      if (tick === LAST_TICK) { clearInterval(handle); done(); }
    }, 250);
  });
  const closed = state.closed;
  await serial.close();
  return { ...trial, lost: lostAtTick !== null, lostAtTick, stallTick: STALL_TICK, closed, linesAfterStall: state.linesAfterStall };
}
window.probeDone = (async () => {
  const results = [];
  for (const trial of TRIALS) results.push(await run(trial));
  return JSON.stringify(results);
})();
`;

function transpile(source: string, out: string, module: ts.ModuleKind): void {
  const compiled = ts.transpileModule(readFileSync(source, 'utf8'), {
    compilerOptions: { module, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  // The page loads ES modules by URL, so extensionless imports get `.js`.
  const code =
    module === ts.ModuleKind.ESNext
      ? compiled.replace(/(from\s+['"])(\.{1,2}\/[^'"]+?)(?<!\.js)(['"])/g, '$1$2.js$3')
      : compiled;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, code);
}

function stage(root: string): void {
  for (const name of MAIN_SOURCES)
    transpile(
      join(repo(), 'electron', `${name}.ts`),
      join(root, 'main', `${name}.js`),
      ts.ModuleKind.CommonJS,
    );
  for (const name of RENDERER_SOURCES)
    transpile(
      join(repo(), 'src', `${name}.ts`),
      join(root, 'r', `${name}.js`),
      ts.ModuleKind.ESNext,
    );
  writeFileSync(join(root, 'main.cjs'), MAIN_SCRIPT);
  writeFileSync(join(root, 'probe.mjs'), PAGE_SCRIPT);
  writeFileSync(
    join(root, 'probe.html'),
    `<!doctype html><body data-trials="${encodeURIComponent(JSON.stringify(TRIALS))}">` +
      '<script type="module" src="probe.mjs"></script></body>',
  );
}

function runElectron(root: string): Promise<TrialResult[]> {
  const electron = createRequire(join(repo(), 'package.json'))('electron') as string;
  const env = { ...process.env };
  delete env['ELECTRON_RUN_AS_NODE'];
  return new Promise((settle, fail) => {
    const child = spawn(electron, [join(root, 'main.cjs')], { env });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', fail);
    child.on('close', () => {
      const line = output.split('\n').find((entry) => entry.startsWith('PROBE_RESULT '));
      if (line === undefined) fail(new Error(`The Electron probe gave no result:\n${output}`));
      else settle(JSON.parse(line.slice('PROBE_RESULT '.length)) as TrialResult[]);
    });
  });
}

describe.skipIf(process.env['KERFDESK_ELECTRON_PROBE'] !== '1')(
  'desktop network transport against a renderer stall in Electron',
  () => {
    it('keeps a healthy network job through the stall and still finds a silent controller', async () => {
      const root = mkdtempSync(join(tmpdir(), 'kerfdesk-k2-probe-'));
      try {
        stage(root);
        const results = await runElectron(root);
        console.info(JSON.stringify(results, null, 2));
        for (const result of results.filter((entry) => !entry.silent)) {
          expect(result, result.name).toMatchObject({ lost: false, closed: false });
          expect(result.linesAfterStall, result.name).toBeGreaterThan(0);
        }
        const silent = results.find((entry) => entry.silent);
        const stallTick = silent?.stallTick ?? 0;
        expect(silent?.lost).toBe(true);
        // Never on the late tick right after the stall. On this transport the
        // verdict also waits for a read issued after the silence began to come
        // back empty, and the main process holds an empty read for up to 1 s:
        // four ticks after the first one that could judge (measured: tick 13).
        expect(silent?.lostAtTick).toBeGreaterThan(stallTick);
        expect(silent?.lostAtTick).toBeLessThanOrEqual(stallTick + 1 + 5);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }, 180_000);
  },
);
