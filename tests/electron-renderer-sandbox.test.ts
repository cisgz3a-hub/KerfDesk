/**
 * T1-89 regression test: Electron renderer sandbox enabled.
 *
 * Bug: electron/main.ts:62-67 set nodeIntegration: false, contextIsolation:
 * true, webviewTag: false but did NOT set sandbox: true. Without sandbox,
 * a renderer compromised by XSS or by malicious imported content (a
 * doctored SVG, project file, or DXF) has access to the full preload
 * bridge AND to non-sandboxed Chromium APIs that exist outside
 * contextIsolation's strict contextBridge boundary.
 *
 * Fix: enable sandbox: true. Audit confirmed:
 *  - electron/preload.ts only imports from 'electron' (contextBridge,
 *    ipcRenderer, IpcRendererEvent — all whitelisted under sandbox).
 *  - electron/preload.ts exposes the bridge via ipcRenderer.invoke / on,
 *    with no fs/path/os/process direct usage.
 *  - The renderer (src/) uses typeof-process guards on the few Node
 *    touchpoints (loadFont's bundled-font fallback, ticket hashing's
 *    deterministic-IDs env check), so Node globals being unavailable
 *    under sandbox is not a regression.
 *
 * What this test asserts (structural checks - what we CAN check at
 * sandbox time):
 *   1. webPreferences includes a literal `sandbox: true` (not env-flagged
 *      or conditional).
 *   2. The other webPreferences hardening flags are still in place.
 *   3. Preload is sandbox-compatible (only imports from 'electron', no
 *      fs/path/etc., uses contextBridge.exposeInMainWorld).
 *   4. Renderer code that touches `process` does so behind typeof guards.
 *   5. Renderer code that imports node: modules does so dynamically.
 *
 * What this test CANNOT assert (runtime checks - require a real Electron
 * runtime, not a tsx unit test):
 *   - Dev mode launches and all panels render.
 *   - File open / save dialogs work.
 *   - Serial port enumeration works.
 *   - Falcon WiFi connection works.
 *
 * The runtime checks must be performed manually after this test passes.
 * If any of them fails, the console error names the Node API the
 * renderer was using; the fix is to move that work to a main-process
 * IPC handler.
 *
 * Run: npx tsx tests/electron-renderer-sandbox.test.ts
 */
export {};

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const MAIN_FILE = join(REPO_ROOT, 'electron', 'main.ts');
const PRELOAD_FILE = join(REPO_ROOT, 'electron', 'preload.ts');
const SRC_DIR = join(REPO_ROOT, 'src');

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

console.log('\n=== electron renderer sandbox (T1-89) ===\n');

/**
 * Comment-stripper that does NOT eat URL schemes (the `//` after `http:`
 * is not a line comment). Same fix as in T1-90's test.
 */
function stripComments(source: string): string {
  return source
    .replace(/(^|[\s;])\/\/[^\n]*/g, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

// ── 1. webPreferences includes sandbox: true ────────────────────────
{
  const src = readFileSync(MAIN_FILE, 'utf8');
  const code = stripComments(src);

  // Locate the webPreferences block.
  const wpStart = code.indexOf('webPreferences:');
  assert(wpStart > 0, 'webPreferences: block exists in main.ts');

  // Bound the block: webPreferences is an object literal that ends with
  // a closing brace at the same indentation. Slice generously and
  // search for the sandbox field within.
  const wpSlice = code.slice(wpStart, wpStart + 1500);

  // The literal `sandbox: true` must appear inside webPreferences.
  // Reject any conditional pattern like `sandbox: !isDev` or env-driven.
  assert(
    /sandbox\s*:\s*true\b/.test(wpSlice),
    'webPreferences includes sandbox: true (literal, not conditional)',
  );

  // Specifically reject conditional patterns that would create an
  // escape hatch (sandbox could be turned off by env variable, dev flag,
  // etc.).
  const conditionalPatterns: RegExp[] = [
    /sandbox\s*:\s*!isDev/,
    /sandbox\s*:\s*isDev\s*\?/,
    /sandbox\s*:\s*process\.env/,
    /sandbox\s*:\s*app\.isPackaged/,
    /sandbox\s*:\s*false/,
  ];
  for (const re of conditionalPatterns) {
    assert(
      !re.test(wpSlice),
      `webPreferences.sandbox is NOT set via ${re.source} (no escape hatch)`,
    );
  }

  // 2. The other hardening flags are still present.
  assert(
    /nodeIntegration\s*:\s*false\b/.test(wpSlice),
    'webPreferences still has nodeIntegration: false (defense-in-depth)',
  );
  assert(
    /contextIsolation\s*:\s*true\b/.test(wpSlice),
    'webPreferences still has contextIsolation: true (required for sandbox)',
  );
  assert(
    /webviewTag\s*:\s*false\b/.test(wpSlice),
    'webPreferences still has webviewTag: false',
  );
  assert(
    /preload\s*:\s*path\.join/.test(wpSlice),
    'webPreferences still wires the preload script',
  );
}

// ── 3. Preload is sandbox-compatible ─────────────────────────────────
{
  const preload = readFileSync(PRELOAD_FILE, 'utf8');
  const code = stripComments(preload);

  // 3a. The preload imports ONLY from 'electron'. Any other import path
  // (fs, path, os, child_process, ./modules) is not allowed in a
  // sandboxed preload.
  const importLines = code.match(/^import\s+[^\n;]+from\s+['"][^'"]+['"]/gm) ?? [];
  assert(importLines.length >= 1, 'preload has at least one import');

  for (const line of importLines) {
    const moduleMatch = line.match(/from\s+['"]([^'"]+)['"]/);
    const modulePath = moduleMatch?.[1] ?? '';
    assert(
      modulePath === 'electron',
      `preload only imports from 'electron' (saw: "${modulePath}")`,
    );
  }

  // 3b. Preload uses contextBridge.exposeInMainWorld (the bridge pattern,
  // not direct global mutation).
  assert(
    /contextBridge\.exposeInMainWorld\(/.test(code),
    'preload uses contextBridge.exposeInMainWorld (not direct global)',
  );

  // 3c. Preload doesn't dynamically require/import Node modules.
  assert(
    !/\brequire\(/.test(code),
    'preload does not call require() (incompatible with sandbox)',
  );
  assert(
    !/\bawait\s+import\(['"](?:node:|fs|path|os|crypto|child_process|net|http)['"]\)/.test(code),
    'preload does not dynamic-import Node-only modules',
  );

  // 3d. Preload does not touch process.* (Node-only globals).
  // Note: process.contextIsolated and process.sandboxed are stubbed under
  // sandbox; they're allowed. Anything else (fs-style, env) is not.
  // Allowlist common safe references.
  const processRefs = code.match(/\bprocess\.\w+/g) ?? [];
  for (const ref of processRefs) {
    const allowed = ['process.contextIsolated', 'process.sandboxed'];
    assert(
      allowed.includes(ref),
      `preload process.* reference "${ref}" is sandbox-safe (allowlist: ${allowed.join(', ')})`,
    );
  }
}

// ── 4. Renderer code uses typeof-process guards (defense-in-depth) ──
// This catches future regressions where someone adds Node usage to
// renderer code without typeof-guarding it. Today there are exactly
// three intended occurrences (loadFont, ticketHashing, types) — all
// guarded. We assert each `process.X` reference in src/ (excluding
// tests/) has a `typeof process` guard within ~10 lines preceding it.
{
  function* walkSrcFiles(dir: string): Generator<string> {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        // Skip generated/test dirs.
        if (['__tests__', 'tests', '__mocks__'].includes(entry)) continue;
        yield* walkSrcFiles(full);
      } else if (
        (entry.endsWith('.ts') || entry.endsWith('.tsx'))
        && !entry.endsWith('.test.ts')
        && !entry.endsWith('.test.tsx')
        && !entry.endsWith('.d.ts')
      ) {
        yield full;
      }
    }
  }

  let processRefCount = 0;
  let unguardedCount = 0;
  const unguardedSites: string[] = [];

  for (const file of walkSrcFiles(SRC_DIR)) {
    const text = readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      // Match process.X but not "import.meta", not "//... process ...".
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
      if (!/\bprocess\.[A-Za-z_$][A-Za-z0-9_$]*/.test(line)) continue;
      processRefCount++;

      // Look back up to 10 lines for a `typeof process` guard.
      const back = lines.slice(Math.max(0, i - 10), i + 1).join('\n');
      const guarded = /typeof\s+process\s*[!=]==\s*['"]undefined['"]|typeof\s+process\s*===\s*['"]undefined['"]/.test(back);
      if (!guarded) {
        unguardedCount++;
        if (unguardedSites.length < 5) {
          unguardedSites.push(`${relative(REPO_ROOT, file)}:${i + 1}: ${trimmed.slice(0, 80)}`);
        }
      }
    }
  }

  assert(
    processRefCount >= 1,
    `at least one process.* reference exists in src/ (got ${processRefCount})`,
  );
  assert(
    unguardedCount === 0,
    `every process.* reference in src/ has a typeof guard within 10 lines (got ${unguardedCount} unguarded${unguardedSites.length ? '; first: ' + unguardedSites[0] : ''})`,
  );
}

// ── 5. Renderer code that imports node: modules does so dynamically ──
{
  function* walkSrcFiles(dir: string): Generator<string> {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (['__tests__', 'tests', '__mocks__'].includes(entry)) continue;
        yield* walkSrcFiles(full);
      } else if (
        (entry.endsWith('.ts') || entry.endsWith('.tsx'))
        && !entry.endsWith('.test.ts')
        && !entry.endsWith('.test.tsx')
        && !entry.endsWith('.d.ts')
      ) {
        yield full;
      }
    }
  }

  let staticNodeImports = 0;
  const staticSites: string[] = [];

  for (const file of walkSrcFiles(SRC_DIR)) {
    const text = readFileSync(file, 'utf8');
    // Static import: `import ... from 'node:fs'` or `import ... from 'fs'`.
    const matches = text.matchAll(/^import\s[^;]*from\s+['"](node:[^'"]+|fs|path|os|crypto|child_process|net|http|https|stream)['"]/gm);
    for (const m of matches) {
      staticNodeImports++;
      if (staticSites.length < 3) {
        staticSites.push(`${relative(REPO_ROOT, file)}: ${m[0].slice(0, 80)}`);
      }
    }
  }

  assert(
    staticNodeImports === 0,
    `no static imports of node:* or bare Node modules in src/ (got ${staticNodeImports}${staticSites.length ? '; first: ' + staticSites[0] : ''})`,
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);

if (failed === 0) {
  console.log(`
================================================================
T1-89 STRUCTURAL CHECKS PASSED.
Runtime verification still required:
  1. npm run electron:dev — verify all panels render
  2. File open / save dialog works
  3. Serial port enumeration and connect work
  4. Falcon WiFi connect works
If any of those fail, the console error names the Node API the
renderer was using. Move that work to a main-process IPC handler,
or roll back sandbox: true and re-plan.
================================================================
`);
}

process.exit(failed > 0 ? 1 : 0);
