#!/usr/bin/env node
// No local server or real network. Playwright fulfils every harness/worker module
// from compiled repository bytes at an isolated synthetic secure origin.
// Run: node scripts/large-file-browser-bench.mjs --runs 3 --out report.json
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpus, totalmem, release } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url),
  viteRequire = createRequire(require.resolve('vite'));
const { build } = await import(pathToFileURL(viteRequire.resolve('esbuild')).href);
const args = process.argv.slice(2),
  option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const runs = Number(option('--runs') ?? 3);
if (!Number.isInteger(runs) || runs < 1 || runs > 10) throw new Error('--runs must be 1 to 10');
const entries = {
  'benchmark.mjs': 'scripts/large-file-browser-pipeline.mjs',
  'document-import-worker.ts': 'src/ui/import/document-import-worker.ts',
  'trace-worker.ts': 'src/ui/trace/trace-worker.ts',
  'convert-bitmap-worker.ts': 'src/ui/raster/convert-bitmap-worker.ts',
  'png-import-worker.ts': 'src/ui/import/png-import-worker.ts',
};
const modules = new Map();
for (const [name, entry] of Object.entries(entries)) {
  const result = await build({
    entryPoints: [resolve(root, entry)],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'chrome120',
    write: false,
    logLevel: 'error',
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.css': 'empty' },
  });
  modules.set(`/${name}`, result.outputFiles[0].text);
}
const moduleHashes = Object.fromEntries([...modules].map(([name, bytes]) => [name, hash(bytes)]));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1000, height: 800 },
    deviceScaleFactor: 1,
    serviceWorkers: 'block',
  });
  const requests = new Set(),
    workerRequests = new Set(),
    errors = [];
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'https://kerfdesk-benchmark.invalid')
      throw new Error(`Unexpected network request: ${url.origin}`);
    requests.add(url.pathname);
    const body = modules.get(url.pathname);
    if (body !== undefined) {
      if (url.pathname.includes('worker')) workerRequests.add(url.pathname);
      return route.fulfill({ status: 200, contentType: 'text/javascript', body });
    }
    if (url.pathname === '/')
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><meta charset="utf-8"><div id="trace" style="width:700px;height:500px"></div><canvas id="route" width="900" height="700"></canvas><script type="module" src="/benchmark.mjs"></script>',
      });
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('https://kerfdesk-benchmark.invalid/');
  await page.waitForFunction(() => globalThis.kerfdeskBenchmark !== undefined, { timeout: 60000 });
  const fixtures = await page.evaluate(() => globalThis.kerfdeskBenchmark.fixtures());
  const maskParity = await page.evaluate(() => globalThis.kerfdeskBenchmark.verifyMaskParity());
  const pinned = {
    svgSha256: '00f845086323e7096435aa75c1dfe7018c215458da9f910dc4e09f68a8860757',
    rgbaSha256: '1532db902d9fafd00abf879e9cf79dc7666ee1a00699170a0acb4d91dc2d26e1',
    pngSha256: 'b865fcd733410318112d2cd2ebc5beb31161971f2a105aabb0fe207390a72a0d',
    pagedPngSha256: '9e83e688498e9496b7f5d14e9c40dd2de246a909dac64a7958cdc1ce71d2b9d1',
  };
  for (const [key, value] of Object.entries(pinned))
    if (fixtures[key] !== value) throw new Error(`Fixture drift: ${key}`);
  const results = [];
  for (const name of ['svg50000', 'sparse4096', 'sparse4096Paged']) {
    await page.evaluate((name) => globalThis.kerfdeskBenchmark.run(name), name);
    const samples = [];
    for (let trial = 0; trial < runs; trial += 1)
      samples.push(await page.evaluate((name) => globalThis.kerfdeskBenchmark.run(name), name));
    const expected = JSON.stringify({ hashes: samples[0].outputHashes, counts: samples[0].counts });
    if (
      samples.some(
        (sample) =>
          JSON.stringify({ hashes: sample.outputHashes, counts: sample.counts }) !== expected,
      )
    )
      throw new Error(`${name} output drift across runs`);
    const totals = samples.map((sample) => sample.totalMs).sort((a, b) => a - b);
    results.push({
      name,
      medianMs: totals[Math.floor(totals.length / 2)],
      minMs: totals[0],
      maxMs: totals.at(-1),
      samples,
    });
    process.stderr.write(`${name}: ${results.at(-1).medianMs.toFixed(1)} ms median\n`);
  }
  if (errors.length > 0) throw new Error(errors.join('\n'));
  const report = {
    format: 'kerfdesk.browser-component-pipeline-benchmark',
    schemaVersion: 1,
    fixtureVersion: 1,
    createdAt: new Date().toISOString(),
    gitHead: git(['rev-parse', 'HEAD']),
    workingTreeDirty: git(['status', '--porcelain']).length > 0,
    browser: browser.version(),
    userAgent: await page.evaluate(() => navigator.userAgent),
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    cpu: cpus()[0]?.model,
    logicalCpuCount: cpus().length,
    systemMemoryBytes: totalmem(),
    osRelease: release(),
    warmups: 1,
    runs,
    moduleHashes,
    fixtures,
    maskParity,
    requestedModules: [...requests],
    nativeWorkerModules: [...workerRequests],
    fixedConfiguration: {
      device: 'Generic GRBL v1.1 reference profile',
      bedMm: [600, 600],
      speedMmPerMin: 1000,
      powerPercent: 50,
      imageLinesPerMm: 10,
      dither: 'threshold',
      optimization: 'source-order, inside-first off, drawn start',
      trace: 'Line Art default, original 4096 grid, no boundary, fixed commit device memory 8 GB',
      imagePlacement:
        'Imported 409.6 mm at default 254 DPI, scaled to 128 mm square (31.25%); original bytes unchanged',
      svgPaint:
        'Native fill paint/operation override retained; default scanline fill, 0.1 mm hatch spacing and 5 mm overscan',
      canvasPixels: [900, 700],
    },
    scope:
      'Browser component pipeline: original in-memory File read/import, native decoder/workers, shared trace preparation/commit, SVG presentation, traced vector and raster CAM, native canvas preview paint/readback, deterministic G-code and output parse. Fixture generation, initial module load, output hashing and OS file chooser/disk latency are excluded. Component APIs use a review fixture project; this is not timed full application interaction, controller transport, physical motion/material, competitor speed, or peak memory.',
    results,
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (option('--out')) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(resolve(option('--out')), json);
  }
  process.stdout.write(json);
} finally {
  await browser.close();
}
function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}
function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}
