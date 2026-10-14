// Local production-bundle startup probe. No deployment or hardware access.
/* global MutationObserver, document, requestAnimationFrame */
// node scripts/performance-audit/startup-probe.mjs --out <report.json>
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { cpus, totalmem } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const bundle = resolve(root, 'dist/web');
const args = process.argv.slice(2);
const verifyLibrary = args.includes('--verify-library');
const outputArgs = args.filter((arg) => arg !== '--verify-library');
if (outputArgs.length !== 2 || outputArgs[0] !== '--out')
  throw new Error('Usage: --out report.json [--verify-library]');
const out = resolve(outputArgs[1]);
mkdirSync(dirname(out), { recursive: true });
if (!existsSync(resolve(bundle, 'index.html'))) throw new Error('Build the web bundle first.');
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon',
};
const assets = new Map();
// Keep filesystem/compression warm consistently across fresh browser contexts.
function loadAssets(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      loadAssets(path);
      continue;
    }
    const bytes = readFileSync(path);
    assets.set(path, {
      bytes: bytes.length,
      gzip: gzipSync(bytes),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      type: mime[extname(path)] ?? 'application/octet-stream',
    });
  }
}
loadAssets(bundle);
const server = createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const path = resolve(bundle, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!path.startsWith(bundle + sep)) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    const asset = assets.get(path);
    if (!asset) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': asset.type,
      'Content-Encoding': 'gzip',
      'Content-Length': asset.gzip.length,
      'Cache-Control': 'no-store',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    });
    res.end(asset.gzip);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
let librarySmoke = null;
try {
  for (let trial = 0; trial < 4; trial++) {
    const context = await browser.newContext({
      viewport: { width: 1500, height: 950 },
      serviceWorkers: 'block',
    });
    const externalRequests = [];
    await context.route('**/*', (route) => {
      if (
        route
          .request()
          .url()
          .startsWith(origin + '/')
      )
        return route.continue();
      externalRequests.push(route.request().url());
      return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      globalThis.__audit = { longTasks: [], lcpMs: null, cls: 0, readyMs: null };
      new PerformanceObserver((list) => {
        for (const e of list.getEntries())
          globalThis.__audit.longTasks.push({ startMs: e.startTime, durationMs: e.duration });
      }).observe({ type: 'longtask', buffered: true });
      new PerformanceObserver((list) => {
        globalThis.__audit.lcpMs = list.getEntries().at(-1)?.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) if (!e.hadRecentInput) globalThis.__audit.cls += e.value;
      }).observe({ type: 'layout-shift', buffered: true });
      const watch = new MutationObserver(() => {
        if (globalThis.__audit.readyMs !== null) return;
        if (
          document.querySelector('canvas[aria-label="KerfDesk workspace"]') &&
          [...document.querySelectorAll('button')].some((b) =>
            b.textContent.includes('Continue with Free'),
          )
        ) {
          requestAnimationFrame(() => {
            globalThis.__audit.readyMs ??= performance.now();
          });
        }
      });
      watch.observe(document, { subtree: true, childList: true });
    });
    const cdp = await context.newCDPSession(page);
    if (trial === 3) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.start');
    }
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    const welcome = page.getByRole('dialog', { name: 'Choose your KerfDesk workspace' });
    await welcome.waitFor({ timeout: 60000 });
    await page.waitForFunction(() => globalThis.__audit.readyMs !== null, { timeout: 60000 });
    const toWelcome = await page.evaluate(() => ({
      ...globalThis.__audit,
      longTasks: [...globalThis.__audit.longTasks],
    }));
    await welcome.getByRole('button', { name: 'Continue with Free', exact: true }).click();
    await welcome.waitFor({ state: 'hidden' });
    await page.locator('canvas[aria-label="KerfDesk workspace"]').waitFor();
    const acceptedMs = await page.evaluate(() => performance.now());
    await page.waitForTimeout(750);
    const metrics = await page.evaluate(() => ({
      ...globalThis.__audit,
      paints: performance.getEntriesByType('paint').map((e) => ({ name: e.name, ms: e.startTime })),
      navigation: performance.getEntriesByType('navigation')[0].toJSON(),
      resources: performance.getEntriesByType('resource').map((e) => ({
        name: new URL(e.name).pathname,
        type: e.initiatorType,
        decodedBytes: e.decodedBodySize,
        encodedBytes: e.encodedBodySize,
        transferBytes: e.transferSize,
        durationMs: e.duration,
      })),
    }));
    if (trial === 3) {
      const { profile } = await cdp.send('Profiler.stop');
      writeFileSync(out.replace(/\.json$/, '.cpuprofile'), JSON.stringify(profile));
    }
    if (trial === 2) {
      await page.screenshot({ path: out.replace(/\.json$/, '.png') });
      writeFileSync(out.replace(/\.json$/, '.aria.txt'), await page.locator('body').ariaSnapshot());
    }
    results.push({
      trial: trial + 1,
      cpuProfilingEnabled: trial === 3,
      toWelcome,
      acceptedMs,
      metrics,
      errors,
      externalRequests,
    });
    console.log(
      `startup ${trial + 1}: welcome=${toWelcome.readyMs.toFixed(1)} ms; maxLongTask=${Math.max(0, ...toWelcome.longTasks.map((t) => t.durationMs)).toFixed(1)} ms; scripts=${metrics.resources.filter((r) => r.name.endsWith('.js')).reduce((n, r) => n + r.encodedBytes, 0)} gzip bytes`,
    );
    if (trial === 3 && verifyLibrary) {
      librarySmoke = await verifyDeferredLibrary(page, metrics.resources, out);
    }
    await context.close();
  }
  writeFileSync(
    out,
    JSON.stringify(
      {
        scope:
          'Fresh Chrome contexts, local gzip server, production web bundle; external requests and service workers blocked. Local startup, not WAN or installed Electron qualification. Fourth trial profiled and excluded from timing summary.',
        gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
        browser: browser.version(),
        cpu: cpus()[0].model,
        logicalCpus: cpus().length,
        totalMemoryBytes: totalmem(),
        createdAt: new Date().toISOString(),
        librarySmoke,
        servedBundle: [...assets]
          .filter(([path]) => /\.(html|js|css)$/.test(path))
          .map(([path, asset]) => ({
            path: path.slice(bundle.length).replaceAll('\\', '/'),
            bytes: asset.bytes,
            gzipBytes: asset.gzip.length,
            sha256: asset.sha256,
          })),
        results,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}

// Optional smoke runs after all timed samples, so the original boundaries stay intact.
async function verifyDeferredLibrary(page, initialResources, output) {
  if (initialResources.some((resource) => resource.name.includes('DesignLibraryDialog')))
    throw new Error('The Design Library chunk was eagerly loaded.');
  await page.getByRole('button', { name: 'Open design library', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Design Library', exact: true });
  await dialog.getByRole('region', { name: 'Design Library results', exact: true }).waitFor();
  await dialog.locator('.lf-library-preview--detail[data-preview-state="ready"]').waitFor();
  await dialog
    .locator('[data-library-card] .lf-library-preview[data-preview-state="ready"]')
    .first()
    .waitFor();
  const requested = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .some((entry) => entry.name.includes('DesignLibraryDialog')),
  );
  if (!requested) throw new Error('Opening the library did not request its deferred chunk.');
  const screenshot = output.replace(/\.json$/, '.library.png');
  await page.screenshot({ path: screenshot, animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Close Design Library', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(
    () => document.activeElement?.getAttribute('aria-label') === 'Open design library',
  );
  return {
    absentAtStartup: true,
    requestedOnOpen: true,
    rendered: true,
    openerFocusRestored: true,
    screenshot,
  };
}
