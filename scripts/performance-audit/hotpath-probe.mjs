#!/usr/bin/env node
/* global self, document, Worker */
// Isolated production-component probes. No app, server, hardware, or external network.
// node scripts/performance-audit/hotpath-probe.mjs --out audit/report.json
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cpus, freemem, release, totalmem } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const origin = 'https://kerfdesk-hotpath-audit.invalid';
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const runs = Number(option('--runs') ?? 3);
if (!Number.isInteger(runs) || runs < 1 || runs > 10) throw Error('--runs must be 1 to 10');
if (args.includes('--out') && !option('--out')) throw Error('--out requires a filename');
const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve('vite'));
const { build } = await import(pathToFileURL(viteRequire.resolve('esbuild')).href);
const fixture = JSON.parse(readFileSync(resolve(root, 'e2e/fixtures/project-basic.lf2'), 'utf8'));
const probeSource = `
import { beginArtworkSpriteFrame, drawArtworkSprite, resetArtworkSpritesForTests } from './src/ui/workspace/artwork-sprite-cache.ts';
import { editPathsNodesByDelta } from './src/ui/state/path-node-edit-geometry.ts';
import { packProjectMessage } from './src/ui/packed-project-transfer.ts';
(${installProbe.toString()})({ beginArtworkSpriteFrame, drawArtworkSprite, resetArtworkSpritesForTests, editPathsNodesByDelta, packProjectMessage });
`;
const compiled = await build({
  stdin: { contents: probeSource, resolveDir: root, sourcefile: 'hotpath-probe-browser.mjs' },
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'chrome120',
  write: false,
  logLevel: 'error',
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.css': 'empty' },
});
const modules = new Map([
  ['/probe.mjs', compiled.outputFiles[0].text],
  ['/echo-worker.mjs', `(${installEchoWorker.toString()})();`],
]);
const git = (values) => execFileSync('git', values, { cwd: root, encoding: 'utf8' }).trim();
const sourceHead = git(['rev-parse', 'HEAD']);
const initialStatus = git(['status', '--porcelain']);
const memoryAtStart = freemem();
const browser = await chromium.launch({ channel: option('--channel') ?? 'chrome', headless: true });
const errors = [];
const requests = new Set();
try {
  const context = await browser.newContext({
    viewport: { width: 1000, height: 800 },
    deviceScaleFactor: 1,
    serviceWorkers: 'block',
  });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      errors.push(`Unexpected network request: ${url.origin}`);
      return route.abort('blockedbyclient');
    }
    requests.add(url.pathname);
    const body = modules.get(url.pathname);
    if (body !== undefined) return route.fulfill({ contentType: 'text/javascript', body });
    if (url.pathname === '/')
      return route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><meta charset="utf-8"><canvas id="canvas" width="800" height="600"></canvas><script type="module" src="/probe.mjs"></script>',
      });
    return route.abort('blockedbyclient');
  });
  let userAgent;
  async function runCase(kind, parameters) {
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.goto(origin);
      await page.waitForFunction(() => globalThis.hotpathProbe !== undefined, { timeout: 60_000 });
      userAgent ??= await page.evaluate(() => navigator.userAgent);
      const result = await page.evaluate(
        ({ kind, parameters, runs, fixture }) =>
          globalThis.hotpathProbe[kind](parameters, runs, fixture),
        { kind, parameters, runs, fixture },
      );
      process.stderr.write(`${kind} ${JSON.stringify(parameters)} complete\n`);
      return result;
    } finally {
      await page.close();
    }
  }
  const sprites = [];
  for (const keys of [8, 9, 16]) sprites.push(await runCase('sprites', { keys }));
  const nodeEdits = [];
  for (const segments of [10_000, 50_000, 100_000]) {
    for (const selected of [1, 10, 100])
      nodeEdits.push(await runCase('nodeEdit', { segments, selected }));
  }
  const transfers = [];
  for (const points of [50_000, 200_000, 1_000_000])
    transfers.push(await runCase('transfer', { points }));
  if (errors.length > 0) throw Error(errors.join('\n'));
  if (sourceHead !== git(['rev-parse', 'HEAD']))
    throw Error('Git HEAD changed during measurements');
  const report = {
    format: 'kerfdesk.browser-hotpath-component-audit',
    schemaVersion: 1,
    fixtureVersion: 1,
    createdAt: new Date().toISOString(),
    gitHead: sourceHead,
    workingTreeDirty: initialStatus.length > 0,
    initialGitStatus: initialStatus,
    browser: browser.version(),
    userAgent,
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    cpu: cpus()[0]?.model,
    logicalCpuCount: cpus().length,
    systemMemoryBytes: totalmem(),
    freeSystemMemoryBytesAtStart: memoryAtStart,
    osRelease: release(),
    warmups: 1,
    runs,
    moduleHashes: Object.fromEntries([...modules].map(([name, text]) => [name, sha256(text)])),
    requestedModules: [...requests],
    scope:
      'Isolated esbuild production components in headless Chrome with native Canvas2D and Worker. Not a full-app interaction, displayed FPS, hardware, output compilation, or peak-memory measurement. Fixture creation, validation, module loading, and worker startup are outside timed sections. Cases run serially in fresh pages. Sprite paint counts are the main cache evidence; GPU completion is not timed.',
    timingNotes: {
      sprites:
        'One warm-up three-pass sequence, then sampled sequences; reset before every sequence. Distinct tiny 32x32-pixel sprites fit far below the pixel budget. Native canvas painting uses 4,000 line segments per key.',
      nodeEdits:
        'One immutable canonical straight-segment curve, edited by the production curve-node function. K anchors are spaced along its N segments. Each sample starts from the same original geometry. Includes production compatibility materialisation, excludes correctness checks.',
      transfers:
        'One project with a polyline and its canonical straight-line curve. Worker echoes the complete payload; packed buffers transfer back. Raw roundtrip includes two structured clones; packed roundtrip excludes packing and includes transfer both ways. Cold packing is recorded from the first warm-up, subsequent samples reuse the production immutable-path cache. No receiver unpacking is included.',
    },
    sprites,
    nodeEdits,
    transfers,
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (option('--out')) {
    const destination = resolve(option('--out'));
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, json);
  }
  process.stdout.write(json);
} finally {
  await browser.close();
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function installEchoWorker() {
  self.onmessage = (event) => {
    const { id, payload, transfer } = event.data;
    self.postMessage({ id, payload, transfer }, transfer);
  };
  self.postMessage({ ready: true });
}

function installProbe(api) {
  const identity = {
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotationDeg: 0,
    mirrorX: false,
    mirrorY: false,
  };
  const assert = (ok, message) => {
    if (!ok) throw Error(message);
  };
  const stats = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return {
      median: sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle],
      min: sorted[0],
      max: sorted.at(-1),
    };
  };
  const pointAt = (index) => ({ x: index, y: index % 7 });
  const curvePath = (pointCount) => {
    const points = Array.from({ length: pointCount }, (_, index) => pointAt(index));
    return {
      color: '#ff0000',
      polylines: [{ closed: false, points }],
      curves: [
        {
          start: points[0],
          closed: false,
          segments: points.slice(1).map((to) => ({ kind: 'line', to })),
        },
      ],
    };
  };
  function spriteSequence(keys) {
    api.resetArtworkSpritesForTests();
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    assert(ctx !== null, 'Native Canvas2D missing');
    const paints = new Array(keys).fill(0);
    const requests = Array.from({ length: keys }, (_, index) => ({
      ctx,
      key: {},
      transform: identity,
      view: { scale: 1, offsetX: (index % 4) * 40, offsetY: Math.floor(index / 4) * 40 },
      styleKey: 'audit-stroke',
      measure: () => ({ minX: 0, minY: 0, maxX: 26, maxY: 26 }),
      paint: (target, view) => {
        paints[index] += 1;
        target.strokeStyle = '#000000';
        target.lineWidth = 1;
        target.beginPath();
        target.moveTo(view.offsetX, view.offsetY);
        for (let segment = 1; segment <= 4000; segment += 1)
          target.lineTo(view.offsetX + (segment % 26), view.offsetY + ((segment * 7) % 26));
        target.stroke();
      },
    }));
    const passes = [];
    for (let pass = 0; pass < 3; pass += 1) {
      api.beginArtworkSpriteFrame();
      const before = paints.reduce((sum, n) => sum + n, 0);
      const started = performance.now();
      for (const request of requests) assert(api.drawArtworkSprite(request), 'Sprite was rejected');
      const elapsedMs = performance.now() - started;
      const paintCalls = paints.reduce((sum, n) => sum + n, 0) - before;
      passes.push({ elapsedMs, paintCalls });
    }
    assert(passes[0].paintCalls === keys, 'Initial sprites did not all paint');
    assert(
      passes.slice(1).every((pass) => pass.paintCalls === 0),
      'Stable sprites were repainted',
    );
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    assert(
      pixels.some((value, index) => index % 4 === 3 && value > 0),
      'Sprite canvas is blank',
    );
    api.resetArtworkSpritesForTests();
    return { passes, perKeyPaintCalls: paints, nonBlank: true };
  }
  function sprites({ keys }, runs) {
    spriteSequence(keys);
    const samples = Array.from({ length: runs }, () => spriteSequence(keys));
    const expected = JSON.stringify(samples[0].passes.map((pass) => pass.paintCalls));
    assert(
      samples.every(
        (sample) => JSON.stringify(sample.passes.map((pass) => pass.paintCalls)) === expected,
      ),
      'Sprite counts varied between samples',
    );
    return {
      keys,
      passesPerSample: 3,
      spritePixelsPerKey: 1024,
      paintCallsPerPass: samples[0].passes.map((pass) => pass.paintCalls),
      passMs: [0, 1, 2].map((pass) =>
        stats(samples.map((sample) => sample.passes[pass].elapsedMs)),
      ),
      samples,
    };
  }
  function nodeEdit({ segments, selected }, runs) {
    const original = curvePath(segments + 1);
    const refs = Array.from({ length: selected }, (_, index) => ({
      objectId: 'curve',
      pathIndex: 0,
      polylineIndex: 0,
      pointIndex: Math.floor(((index + 1) * segments) / (selected + 1)),
      geometry: 'curve',
    }));
    const selectedIndices = new Set(refs.map((ref) => ref.pointIndex));
    assert(selectedIndices.size === selected, 'Selection indices are not unique');
    function sample() {
      const started = performance.now();
      const result = api.editPathsNodesByDelta([original], refs, 2, 3);
      const elapsedMs = performance.now() - started;
      const curve = result?.paths[0]?.curves?.[0];
      assert(curve?.segments.length === segments, 'Edited curve length changed');
      assert(
        result.paths[0].polylines[0].points.length === segments + 1,
        'Compatibility point count changed',
      );
      let changed = 0;
      for (let index = 0; index <= segments; index += 1) {
        const source =
          index === 0 ? original.curves[0].start : original.curves[0].segments[index - 1].to;
        const actual = index === 0 ? curve.start : curve.segments[index - 1].to;
        const expected = pointAt(index);
        const moved = selectedIndices.has(index);
        assert(source.x === expected.x && source.y === expected.y, 'Input geometry was mutated');
        assert(
          actual.x === expected.x + (moved ? 2 : 0) && actual.y === expected.y + (moved ? 3 : 0),
          'Unexpected edited anchor',
        );
        const compatibility = result.paths[0].polylines[0].points[index];
        assert(
          compatibility.x === actual.x && compatibility.y === actual.y,
          'Compatibility geometry differs',
        );
        if (moved) changed += 1;
      }
      assert(changed === selected, 'Changed anchor count differs');
      return {
        elapsedMs,
        changedAnchors: changed,
        segments: curve.segments.length,
        sourceUnchanged: true,
      };
    }
    sample();
    const samples = Array.from({ length: runs }, sample);
    return {
      segments,
      selectedAnchors: selected,
      editMs: stats(samples.map((value) => value.elapsedMs)),
      samples,
    };
  }
  async function transfer({ points }, runs, fixture) {
    const project = {
      ...fixture,
      scene: {
        ...fixture.scene,
        objects: [
          {
            ...fixture.scene.objects[0],
            id: 'transfer-fixture',
            paths: [curvePath(points)],
            bounds: { minX: 0, minY: 0, maxX: points - 1, maxY: 6 },
            transform: identity,
          },
        ],
      },
    };
    const worker = new Worker('/echo-worker.mjs', { type: 'module' });
    let sequence = 0;
    let pending;
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Worker startup timed out')), 30_000);
      worker.onmessage = (event) => {
        if (event.data.ready) {
          clearTimeout(timer);
          resolve();
          return;
        }
        const current = pending;
        if (!current || current.id !== event.data.id) return;
        pending = undefined;
        clearTimeout(current.timer);
        current.resolve({ echo: event.data, roundtripMs: performance.now() - current.started });
      };
      worker.onerror = (event) => {
        clearTimeout(timer);
        reject(Error(event.message));
        if (pending) {
          clearTimeout(pending.timer);
          pending.reject(Error(event.message));
          pending = undefined;
        }
      };
    });
    function echo(payload, buffers) {
      const id = ++sequence;
      let synchronousPostMs;
      const response = new Promise((resolve, reject) => {
        const started = performance.now();
        const timer = setTimeout(() => {
          pending = undefined;
          reject(Error('Worker echo timed out'));
        }, 60_000);
        pending = { id, started, timer, resolve, reject };
        try {
          const beforePost = performance.now();
          worker.postMessage({ id, payload, transfer: buffers }, buffers);
          synchronousPostMs = performance.now() - beforePost;
        } catch (error) {
          clearTimeout(timer);
          pending = undefined;
          reject(error);
        }
      });
      return response.then((value) => ({ ...value, synchronousPostMs }));
    }
    function validateRaw(received) {
      const path = received.scene.objects[0].paths[0];
      assert(
        path.polylines[0].points.length === points && path.curves[0].segments.length === points - 1,
        'Raw echo geometry count mismatch',
      );
      for (const index of [0, Math.floor(points / 2), points - 1]) {
        const point = path.polylines[0].points[index];
        assert(point.x === index && point.y === index % 7, 'Raw echo coordinate mismatch');
      }
    }
    async function rawSample() {
      const result = await echo(project, []);
      validateRaw(result.echo.payload);
      return {
        synchronousPostMs: result.synchronousPostMs,
        roundtripMs: result.roundtripMs,
        pointsVerified: points,
      };
    }
    async function packedSample() {
      const started = performance.now();
      const packed = api.packProjectMessage(project);
      const packingMs = performance.now() - started;
      const bytes = packed.transfer.reduce((sum, buffer) => sum + buffer.byteLength, 0);
      assert(packed.message.kind === 'packed-project' && bytes > 0, 'Fixture was not packed');
      const result = await echo(packed.message, packed.transfer);
      assert(
        packed.transfer.every((buffer) => buffer.byteLength === 0),
        'Sending buffers were not detached',
      );
      const path = result.echo.payload.geometry[0].paths[0];
      assert(
        path.polylines.xy.length === points * 2 && path.curves.derived === true,
        'Packed echo geometry mismatch',
      );
      assert(
        result.echo.transfer.reduce((sum, buffer) => sum + buffer.byteLength, 0) === bytes,
        'Returned buffer byte count differs',
      );
      for (const index of [0, Math.floor(points / 2), points - 1])
        assert(
          path.polylines.xy[index * 2] === index && path.polylines.xy[index * 2 + 1] === index % 7,
          'Packed echo coordinate mismatch',
        );
      assert(
        project.scene.objects[0].paths[0].polylines[0].points.length === points,
        'Packing changed source geometry',
      );
      return {
        packingMs,
        synchronousPostMs: result.synchronousPostMs,
        roundtripMs: result.roundtripMs,
        packingAndRoundtripMs: packingMs + result.roundtripMs,
        transferredBytes: bytes,
        pointsVerified: points,
        senderBuffersDetached: true,
      };
    }
    try {
      await ready;
      await rawSample();
      const coldPackedWarmup = await packedSample();
      const raw = [],
        packed = [];
      for (let run = 0; run < runs; run += 1) {
        if (run % 2 === 0) {
          raw.push(await rawSample());
          packed.push(await packedSample());
        } else {
          packed.push(await packedSample());
          raw.push(await rawSample());
        }
      }
      const summary = (samples, fields) =>
        Object.fromEntries(
          fields.map((field) => [field, stats(samples.map((value) => value[field]))]),
        );
      return {
        points,
        canonicalLineSegments: points - 1,
        coldPackedWarmup,
        raw: { ...summary(raw, ['synchronousPostMs', 'roundtripMs']), samples: raw },
        packed: {
          ...summary(packed, [
            'packingMs',
            'synchronousPostMs',
            'roundtripMs',
            'packingAndRoundtripMs',
          ]),
          samples: packed,
        },
      };
    } finally {
      if (pending) clearTimeout(pending.timer);
      worker.terminate();
    }
  }
  globalThis.hotpathProbe = { sprites, nodeEdit, transfer };
}
