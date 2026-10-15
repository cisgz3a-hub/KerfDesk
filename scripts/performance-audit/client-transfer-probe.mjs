#!/usr/bin/env node
/* global self */
// Real client dispatch -> native Worker unpack. Compilation is deliberately excluded.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const baseline = args.includes('--baseline');
const out = arg('--out');
if (!out) throw Error('--out is required');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const head = git('rev-parse', 'HEAD');
const baselineHead = baseline
  ? git('rev-parse', '--verify', `${arg('--baseline-ref') ?? head}^{commit}`)
  : null;
const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve('vite'));
const { build } = await import(pathToFileURL(viteRequire.resolve('esbuild')).href);
const fixture = JSON.parse(readFileSync(resolve(root, 'e2e/fixtures/project-basic.lf2'), 'utf8'));
const clientPaths = [
  'src/ui/laser/output-preparation-worker-client.ts',
  'src/ui/workspace/design-scene-worker-client.ts',
];
const sourceFiles = Object.fromEntries(
  clientPaths.map((path) => [
    path,
    baseline ? git('show', `${baselineHead}:${path}`) : readFileSync(resolve(root, path), 'utf8'),
  ]),
);
const plugins = [
  {
    name: 'audited-client-snapshot',
    setup(build) {
      build.onLoad(
        { filter: /(?:output-preparation|design-scene)-worker-client\.ts$/ },
        ({ path }) => {
          const relative = path.slice(root.length + 1).replaceAll('\\', '/');
          return { contents: sourceFiles[relative], loader: 'ts', resolveDir: dirname(path) };
        },
      );
    },
  },
];
async function bundle(contents, usePlugins = false) {
  const result = await build({
    stdin: { contents, resolveDir: root, sourcefile: 'client-transfer-browser.mjs' },
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'chrome120',
    write: false,
    logLevel: 'error',
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.css': 'empty' },
    plugins: usePlugins ? plugins : [],
  });
  return result.outputFiles[0].text;
}
const main = await bundle(
  `
import { prepareSaveOutputOffThread, resetOutputPreparationWorkerForTests } from './src/ui/laser/output-preparation-worker-client.ts';
import { computeDesignSceneSourceOffThread, resetDesignSceneWorkerForTests } from './src/ui/workspace/design-scene-worker-client.ts';
(${install.toString()})({ prepareSaveOutputOffThread, resetOutputPreparationWorkerForTests, computeDesignSceneSourceOffThread, resetDesignSceneWorkerForTests });
`,
  true,
);
const worker = await bundle(`
import { unpackProjectMessage } from './src/ui/packed-project-transfer.ts';
(${installReceiver.toString()})(unpackProjectMessage);
`);
const origin = 'https://kerfdesk-client-transfer.invalid';
const modules = new Map([
  ['/probe.mjs', main],
  ['/output-preparation-worker.ts', worker],
  ['/design-scene-worker.ts', worker],
]);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
const cases = [];
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/')
      return route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><script type="module" src="/probe.mjs"></script>',
      });
    const body = modules.get(url.pathname);
    if (body === undefined) return route.abort();
    return route.fulfill({ contentType: 'text/javascript', body });
  });
  for (const client of ['output', 'design']) {
    for (const points of [50_000, 200_000, 1_000_000]) {
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(origin);
      await page.waitForFunction(() => globalThis.clientTransferProbe !== undefined);
      const result = await page.evaluate(
        ({ client, points, fixture }) => globalThis.clientTransferProbe(client, points, fixture),
        { client, points, fixture },
      );
      cases.push(result);
      process.stderr.write(
        `${baseline ? 'baseline' : 'fixed'} ${client} ${points}: ${result.medianClientCallMs.toFixed(2)} ms sync\n`,
      );
      await page.close();
    }
  }
  if (errors.length) throw Error(errors.join('\n'));
  const report = {
    format: 'kerfdesk.actual-client-project-transfer',
    createdAt: new Date().toISOString(),
    baseline,
    gitHead: head,
    baselineSourceHead: baselineHead,
    browser: browser.version(),
    node: process.version,
    cpu: cpus()[0]?.model,
    sourceHashes: Object.fromEntries(
      Object.entries(sourceFiles).map(([name, source]) => [name, hash(source)]),
    ),
    moduleHashes: { main: hash(main), worker: hash(worker) },
    scope:
      'Actual output/design clients, native Worker, exact production unpacker. Baseline uses the two client files at baselineSourceHead. Worker validates every fixture point and canonical segment then returns a tiny receipt, without compiling or rendering. Client call includes packing and synchronous postMessage; roundtrip includes receiver unpack and validation. Worker startup is paid in the first cold sample only. Three warm samples follow. No end-to-end output speed claim.',
    cases,
  };
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(resolve(out), `${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser.close();
}

function hash(source) {
  return createHash('sha256').update(source).digest('hex');
}

function install(api) {
  const assert = (condition, message) => {
    if (!condition) throw Error(message);
  };
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  globalThis.clientTransferProbe = async (client, points, fixture) => {
    const polyline = {
      closed: false,
      points: Array.from({ length: points }, (_, i) => ({ x: i, y: i % 7 })),
    };
    const curves = [
      {
        start: polyline.points[0],
        closed: false,
        segments: polyline.points.slice(1).map((to) => ({ kind: 'line', to })),
      },
    ];
    const project = {
      ...fixture,
      scene: {
        ...fixture.scene,
        objects: [
          {
            ...fixture.scene.objects[0],
            paths: [{ color: '#000000', polylines: [polyline], curves }],
          },
        ],
      },
    };
    const outputScope = {
      cutSelectedGraphics: false,
      useSelectionOrigin: false,
      selectedObjectIds: [],
    };
    const snapshot = { evaluatedAtIso: '2026-10-14T00:00:00.000Z' };
    async function sample() {
      const started = performance.now();
      const pending =
        client === 'output'
          ? api.prepareSaveOutputOffThread({ kind: 'save', project, options: {}, snapshot })
          : api.computeDesignSceneSourceOffThread(project, outputScope);
      const clientCallMs = performance.now() - started;
      assert(pending !== null, 'Client has no worker');
      const result = await pending;
      const roundtripMs = performance.now() - started;
      const receipt = client === 'output' ? JSON.parse(result.gcode) : result;
      assert(receipt.points === points && receipt.exact === true, 'Receiver geometry mismatch');
      assert(
        polyline.points.length === points && polyline.points[points - 1].x === points - 1,
        'Source changed',
      );
      return { clientCallMs, roundtripMs, ...receipt };
    }
    try {
      const cold = await sample();
      const samples = [];
      for (let i = 0; i < 3; i += 1) samples.push(await sample());
      return {
        client,
        points,
        cold,
        samples,
        medianClientCallMs: median(samples.map((x) => x.clientCallMs)),
        medianRoundtripMs: median(samples.map((x) => x.roundtripMs)),
        medianUnpackMs: median(samples.map((x) => x.unpackMs)),
      };
    } finally {
      api.resetOutputPreparationWorkerForTests();
      api.resetDesignSceneWorkerForTests();
    }
  };
}

function installReceiver(unpack) {
  self.onmessage = (event) => {
    const data = event.data;
    if (data.port) {
      data.port.close();
      return;
    }
    const request = data.kind === 'prepare' ? data.request : data;
    const started = performance.now();
    const project = unpack(request.project);
    const unpackMs = performance.now() - started;
    const path = project.scene.objects[0].paths[0];
    const points = path.polylines[0].points;
    const curve = path.curves[0];
    let exact =
      curve.segments.length === points.length - 1 && curve.start.x === 0 && curve.start.y === 0;
    for (let i = 0; i < points.length; i += 1) {
      exact &&= points[i].x === i && points[i].y === i % 7;
      if (i > 0)
        exact &&=
          curve.segments[i - 1].kind === 'line' &&
          curve.segments[i - 1].to.x === i &&
          curve.segments[i - 1].to.y === i % 7;
    }
    if (data.kind === 'prepare')
      exact &&= request.snapshot.evaluatedAtIso === '2026-10-14T00:00:00.000Z';
    const receipt = {
      points: points.length,
      exact,
      packed: request.project.kind === 'packed-project',
      unpackMs,
    };
    self.postMessage(
      data.kind === 'prepare'
        ? {
            requestId: data.requestId,
            response: {
              kind: 'save',
              result: {
                kind: 'emitted',
                gcode: JSON.stringify(receipt),
                preflight: { ok: true, issues: [] },
              },
            },
          }
        : { id: data.id, kind: 'scene', source: receipt },
    );
  };
}
