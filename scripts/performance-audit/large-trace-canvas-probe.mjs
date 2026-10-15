/* global window */
// Opt-in paired renderer probe. Run: node scripts/performance-audit/large-trace-canvas-probe.mjs
// Optional: --baseline=<git-ref>. Uses a disposable browser and no web server.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, posix, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const option = (name, fallback) =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const baselineRef = option('baseline', 'HEAD');
const origin = 'https://kerfdesk-canvas-probe.invalid';
const run = new Date().toISOString().replaceAll(':', '-');
const output = join(root, 'artifacts', 'large-trace-canvas', run);
const sourceDir = 'src/ui/workspace';
const cachePath = `${sourceDir}/artwork-sprite-cache.ts`;
const sha = (value) => createHash('sha256').update(value).digest('hex');
const source = await readFile(join(root, cachePath), 'utf8');
const baseline = execFileSync('git', ['show', `${baselineRef}:${cachePath}`], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 2_000_000,
});
assert.notEqual(sha(source), sha(baseline), 'Baseline and candidate cache sources are identical');
await mkdir(output, { recursive: true });
const urlRoot = `/${relative(root, output).replaceAll('\\', '/')}`;
const receipt = {
  kind: 'paired-drawScene-renderer-probe',
  baselineRef,
  baselineCommit: execFileSync('git', ['rev-parse', baselineRef], {
    cwd: root,
    encoding: 'utf8',
  }).trim(),
  fixture: { kind: 'synthetic-dense-contours', version: 1, contours: 1500, pointsPerContour: 120 },
  cacheSources: { baselineSha256: sha(baseline), candidateSha256: sha(source) },
  viewport: 'Canvas backing pixels equal CSS pixels; deviceScaleFactor=1',
  limitations: [
    'Actual drawScene and display resolution in native Chrome, not the full React application or installed Electron.',
    'Synthetic 180000-point rounded contours form one Fill trace object; actual tracing is outside this probe.',
    'drawJsMs measures synchronous drawScene submission; one final pixel readback verifies the settled image outside interaction timings.',
    'Frame intervals are scheduling telemetry, not displayed FPS or newly rendered artwork rates.',
    'Project/source geometry and output settings are hash-checked; emitted G-code and hardware are outside this renderer probe.',
  ],
  results: [],
  errors: [],
};

// Only the cache import is substituted. Both variants execute the same current
// drawScene/object-display source and the same current production dependencies.
for (const [variant, cache] of [
  ['baseline', baseline],
  ['candidate', source],
]) {
  const directory = join(output, variant);
  await mkdir(directory);
  const imports = new Map([
    [`/${sourceDir}/artwork-sprite-cache`, `${urlRoot}/${variant}/cache-observer.ts`],
    [`/${sourceDir}/object-display`, `${urlRoot}/${variant}/object-display.ts`],
  ]);
  for (const name of ['draw-scene.ts', 'object-display.ts']) {
    const original = await readFile(join(root, sourceDir, name), 'utf8');
    receipt[`${name}Sha256`] = sha(original);
    await writeFile(join(directory, name), rewriteImports(original, imports));
  }
  await writeFile(join(directory, 'cache.ts'), rewriteImports(cache, new Map()));
  await writeFile(join(directory, 'cache-observer.ts'), observerSource());
}
const entry = `
import * as probe from './scripts/performance-audit/large-trace-canvas-browser.mjs';
import * as baselineDraw from '.${urlRoot}/baseline/draw-scene.ts';
import * as baselineCache from '.${urlRoot}/baseline/cache-observer.ts';
import * as candidateDraw from '.${urlRoot}/candidate/draw-scene.ts';
import * as candidateCache from '.${urlRoot}/candidate/cache-observer.ts';
probe.configure({ baseline: { draw: baselineDraw, cache: baselineCache }, candidate: { draw: candidateDraw, cache: candidateCache } });
globalThis.canvasProbe = probe;
`;
console.log('canvas-probe: bundling production drawScene and both cache variants');
const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve('vite'));
const { build } = await import(pathToFileURL(viteRequire.resolve('esbuild')).href);
const compiled = await build({
  stdin: { contents: entry, resolveDir: root, sourcefile: 'canvas-probe-entry.mjs' },
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'chrome120',
  write: false,
  logLevel: 'error',
  external: ['harfbuzzjs'],
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.env': '{"MODE":"desktop","DEV":false,"PROD":true}',
    __BUILD_TIME__: '"probe"',
    __GIT_SHA__: '"probe"',
    __APP_VERSION__: '"probe"',
  },
  loader: { '.css': 'empty' },
  plugins: [
    {
      name: 'probe-root-imports',
      setup(builder) {
        builder.onResolve({ filter: /^\/(src|artifacts)\// }, (args) =>
          builder.resolve(join(root, args.path.slice(1)), { resolveDir: root, kind: args.kind }),
        );
        // This vector-only fixture never loads text fonts; retain URL strings
        // without bundling every unrelated font binary into the measurement page.
        builder.onResolve({ filter: /\?url$/ }, (args) => ({
          path: args.path,
          namespace: 'unused-font-url',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'unused-font-url' }, (args) => ({
          contents: `export default ${JSON.stringify(args.path)};`,
          loader: 'js',
        }));
      },
    },
  ],
});
const bundle = compiled.outputFiles[0].text;
receipt.bundleSha256 = sha(bundle);
await writeFile(join(output, 'probe.mjs'), bundle);
if (process.argv.includes('--compile-only')) {
  console.log(JSON.stringify({ compiled: true, bundle: join(output, 'probe.mjs') }));
  process.exit(0);
}
let browser;
try {
  console.log('canvas-probe: opening isolated headless browser');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  page.on('pageerror', (error) => receipt.errors.push(String(error)));
  page.on('console', (message) => {
    if (message.text().startsWith('canvas-probe:')) console.log(message.text());
  });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort('blockedbyclient');
    if (url.pathname === '/probe.mjs')
      return route.fulfill({ contentType: 'text/javascript', body: bundle });
    if (url.pathname === '/')
      return route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><body style="margin:0;background:#fff"><canvas id="workspace"></canvas><script type="module" src="/probe.mjs"></script></body>',
      });
    return route.abort('blockedbyclient');
  });
  await page.goto(origin);
  await page.waitForFunction(() => window.canvasProbe !== undefined, { timeout: 30_000 });
  const fixture = JSON.parse(await readFile(join(root, 'e2e/fixtures/project-basic.lf2'), 'utf8'));
  receipt.artwork = await bounded(
    page.evaluate((fixture) => window.canvasProbe.prepare(fixture), fixture),
    30_000,
    'dense fixture preparation',
  );
  console.log(JSON.stringify({ phase: 'prepared', ...receipt.artwork }));
  receipt.browserVersion = browser.version();
  for (const size of [
    { width: 1920, height: 1080 },
    { width: 3840, height: 2160 },
  ]) {
    await page.setViewportSize(size);
    for (const variant of ['baseline', 'candidate']) {
      const result = await bounded(
        page.evaluate(async (args) => window.canvasProbe.measure(args), {
          variant,
          size,
        }),
        90_000,
        `${variant} ${size.width} renderer measurement`,
      );
      receipt.results.push(result);
      await page.screenshot({ path: join(output, `${variant}-${size.width}x${size.height}.png`) });
      console.log(JSON.stringify({ phase: 'measured', ...result }));
    }
  }
  receipt.preservation = await page.evaluate(() => window.canvasProbe.verifyPreservation());
  assert.equal(receipt.preservation.projectBefore, receipt.preservation.projectAfter);
  for (const result of receipt.results) {
    for (const phase of result.phases) {
      const calls = phase.cache.calls;
      assert(calls > 0, 'Actual drawScene did not request sprites');
      if (result.variant === 'baseline') {
        assert.equal(
          phase.cache.fallbacks,
          calls,
          'Baseline no longer reproduces clipped-sprite fallback',
        );
      } else {
        assert.equal(phase.cache.fallbacks, 0, 'Fixed renderer fell back to direct dense painting');
        assert.equal(
          phase.cache.paints,
          0,
          'Warm interaction unexpectedly rerasterized the dense trace',
        );
        assert.equal(phase.cache.hits, calls);
      }
    }
  }
  assert.deepEqual(receipt.errors, []);
  receipt.passed = true;
} catch (error) {
  receipt.passed = false;
  receipt.failure = String(error.stack ?? error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await writeFile(join(output, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(
    JSON.stringify({
      passed: receipt.passed,
      receipt: join(output, 'receipt.json'),
      failure: receipt.failure,
    }),
  );
}

function rewriteImports(text, replacements) {
  return text.replace(/(from\s+)(['"])(\.[^'"]+)\2/g, (_match, prefix, quote, specifier) => {
    const absolute = posix.resolve(`/${sourceDir}`, specifier);
    return `${prefix}${quote}${replacements.get(absolute) ?? absolute}${quote}`;
  });
}

async function bounded(pending, timeoutMs, phase) {
  let timer;
  try {
    return await Promise.race([
      pending,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${phase} exceeded ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function observerSource() {
  return `import * as implementation from './cache';
export { SPRITE_MIN_DISPLAY_SEGMENTS, SPRITE_SETTLE_MS, SPRITE_PAD_PX } from './cache';
export const stats = { calls: 0, hits: 0, fallbacks: 0, paints: 0, measures: 0 };
export function clearStats() { for (const key of Object.keys(stats)) stats[key] = 0; }
export function beginArtworkSpriteFrame() { implementation.beginArtworkSpriteFrame(); }
export function resetArtworkSpritesForTests() { implementation.resetArtworkSpritesForTests(); clearStats(); }
export function drawArtworkSprite(request) {
  stats.calls++;
  const before = stats.paints;
  const served = implementation.drawArtworkSprite({ ...request,
    measure: () => { stats.measures++; return request.measure(); },
    paint: (...args) => { stats.paints++; request.paint(...args); },
  });
  if (!served) stats.fallbacks++;
  else if (stats.paints === before) stats.hits++;
  return served;
}
`;
}
