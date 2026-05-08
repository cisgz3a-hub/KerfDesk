/**
 * T1-112: build stamp on canvas (commit hash + build time) so testers
 * can detect stale deployments at a glance.
 *
 * The Vite-injected globals (__BUILD_COMMIT__, __BUILD_TIME__) aren't
 * available in tsx test runs because tsx doesn't process Vite defines.
 * BuildStamp guards both reads with `typeof !== 'undefined'`, so the
 * component renders the 'dev' fallback when run unstamped. This test
 * exercises both paths plus source-pins the build wiring.
 *
 * Run: npx tsx tests/build-stamp.test.tsx
 */
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>', { url: 'http://localhost' });
const win = dom.window;
Object.defineProperty(globalThis, 'window', { value: win, configurable: true });
Object.defineProperty(globalThis, 'document', { value: win.document, configurable: true });
Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true });
if (typeof (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame !== 'function') {
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    value: (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number,
    configurable: true,
  });
}
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

console.log('\n=== T1-112 build stamp ===\n');

async function run(): Promise<void> {
// 1. vite.config.ts source-pin: __BUILD_COMMIT__ + __BUILD_TIME__ defines present
{
  const src = fs.readFileSync(path.join(repoRoot, 'vite.config.ts'), 'utf8');
  assert(/__BUILD_COMMIT__:\s*JSON\.stringify\(/.test(src),
    'vite.config.ts defines __BUILD_COMMIT__ via JSON.stringify');
  assert(/__BUILD_TIME__:\s*JSON\.stringify\(/.test(src),
    'vite.config.ts defines __BUILD_TIME__ via JSON.stringify');
  assert(/git rev-parse --short HEAD/.test(src),
    'vite.config.ts reads commit via `git rev-parse --short HEAD`');
  assert(/git log -1 --format=%cI/.test(src),
    'vite.config.ts reads build time via `git log -1 --format=%cI`');
}

// 2. vite.config.ts source-pin: try/catch fallback so dev/CI without git history doesn't crash
{
  const src = fs.readFileSync(path.join(repoRoot, 'vite.config.ts'), 'utf8');
  assert(
    /try\s*\{[^]*?execSync[^]*?catch[^]*?return\s+fallback/.test(src),
    'vite.config.ts wraps execSync in try/catch with fallback return',
  );
  assert(/'dev'/.test(src), 'vite.config.ts uses `dev` as commit fallback');
}

// 3. global.d.ts source-pin: declarations present
{
  const src = fs.readFileSync(path.join(repoRoot, 'src/types/global.d.ts'), 'utf8');
  assert(/declare const __BUILD_COMMIT__:\s*string/.test(src),
    'global.d.ts declares __BUILD_COMMIT__: string');
  assert(/declare const __BUILD_TIME__:\s*string/.test(src),
    'global.d.ts declares __BUILD_TIME__: string');
}

// 4. FileToolbar mounts BuildStamp next to Settings
//    (originally bottom-right of canvas; moved 2026-05-08 because the
//    tester couldn't see the bottom of the viewport in their layout.
//    Toolbar placement is more discoverable.)
{
  const src = fs.readFileSync(
    path.join(repoRoot, 'src/ui/components/FileToolbar.tsx'),
    'utf8',
  );
  assert(
    /import\s*\{\s*BuildStamp\s*\}\s*from\s*['"]\.\/BuildStamp['"]/.test(src),
    'FileToolbar imports BuildStamp',
  );
  assert(
    /React\.createElement\(BuildStamp\)[\s\S]{0,200}onOpenSettings/.test(src),
    'FileToolbar mounts <BuildStamp /> immediately before the Settings button',
  );
  // Also ensure the canvas viewport no longer mounts it (avoid
  // double-rendering after the relocation).
  const cvSrc = fs.readFileSync(
    path.join(repoRoot, 'src/ui/components/CanvasViewport.tsx'),
    'utf8',
  );
  assert(
    !/BuildStamp/.test(cvSrc),
    'CanvasViewport no longer references BuildStamp (toolbar owns it post-relocation)',
  );
}

// Single import — the component reads the globals at render time, not
// at import time, so re-rendering with different globalThis values is
// enough to exercise both paths.
const { BuildStamp } = await import('../src/ui/components/BuildStamp');

// 5. Behavioral: BuildStamp renders 'dev' when globals are undefined (tsx fallback path)
{
  const container = win.document.getElementById('root')!;
  container.innerHTML = '';
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(BuildStamp));
  });
  const stamp = container.querySelector('[data-testid="build-stamp"]');
  assert(stamp != null, 'BuildStamp renders when globals undefined');
  assert(
    (stamp?.getAttribute('data-build-commit') ?? '') === 'dev',
    `BuildStamp falls back to 'dev' when __BUILD_COMMIT__ is undefined (got '${stamp?.getAttribute('data-build-commit')}')`,
  );
  assert(
    (stamp?.textContent ?? '').includes('vdev'),
    'BuildStamp text includes vdev fallback label',
  );
  await act(async () => { root.unmount(); });
}

// 6. Behavioral: BuildStamp renders the injected commit + date when globals are set
{
  // Vite usually injects these at build time. tsx tests don't process
  // the Vite define; emulate by setting them on globalThis so the
  // `typeof __BUILD_COMMIT__ !== 'undefined'` guards see a value.
  (globalThis as Record<string, unknown>).__BUILD_COMMIT__ = 'abc1234';
  (globalThis as Record<string, unknown>).__BUILD_TIME__ = '2026-05-08T12:34:56+00:00';

  const container = win.document.getElementById('root')!;
  container.innerHTML = '';
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(BuildStamp));
  });
  const stamp = container.querySelector('[data-testid="build-stamp"]');
  assert(
    (stamp?.getAttribute('data-build-commit') ?? '') === 'abc1234',
    'BuildStamp data-build-commit reflects __BUILD_COMMIT__',
  );
  assert(
    (stamp?.textContent ?? '').includes('abc1234'),
    'BuildStamp text contains the commit hash',
  );
  assert(
    (stamp?.textContent ?? '').includes('2026-05-08'),
    'BuildStamp text contains YYYY-MM-DD slice of build time',
  );
  await act(async () => { root.unmount(); });

  delete (globalThis as Record<string, unknown>).__BUILD_COMMIT__;
  delete (globalThis as Record<string, unknown>).__BUILD_TIME__;
}

// 7. Behavioral: clicking the stamp invokes navigator.clipboard.writeText
{
  (globalThis as Record<string, unknown>).__BUILD_COMMIT__ = 'def5678';
  (globalThis as Record<string, unknown>).__BUILD_TIME__ = '2026-05-08T00:00:00+00:00';
  let writtenText: string | null = null;
  // Stub navigator.clipboard on the JSDOM window.
  Object.defineProperty(win.navigator, 'clipboard', {
    value: {
      writeText: (text: string): Promise<void> => {
        writtenText = text;
        return Promise.resolve();
      },
    },
    configurable: true,
  });

  const container = win.document.getElementById('root')!;
  container.innerHTML = '';
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(BuildStamp));
  });
  const stamp = container.querySelector('[data-testid="build-stamp"]') as HTMLButtonElement;
  await act(async () => { stamp.click(); });
  await new Promise(r => setTimeout(r, 0));

  assert(writtenText === 'def5678',
    `click writes commit hash to clipboard (got '${writtenText}')`);

  await act(async () => { root.unmount(); });
  delete (globalThis as Record<string, unknown>).__BUILD_COMMIT__;
  delete (globalThis as Record<string, unknown>).__BUILD_TIME__;
}

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

export {};
