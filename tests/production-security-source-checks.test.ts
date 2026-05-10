/**
 * T3-89: production-security source checks (extends T1-81).
 *
 * Audit 5D Required Priority 15: a release can ship with security
 * regressions if CI doesn't enforce them mechanically. Examples the
 * audit calls out:
 *
 *   - A future PR introduces `nodeIntegration: true` for testing and
 *     forgets to revert it.
 *   - Source maps slip back into the package because an electron-
 *     builder config change.
 *   - A dev-only IPC handler accidentally remains in the production
 *     preload (e.g. `storage:clear`, T1-84 already removed).
 *   - CSP gets relaxed temporarily for a feature and never re-tightened.
 *   - A `--dev` flag escape hatch is added for debugging and stays.
 *
 * `scripts/verify-production-build.mjs` (T1-81 + T3-82) catches these
 * patterns in the BUILT bundle (`dist/`), but the build step is slow
 * and runs late. T3-89 extends the gate to SOURCE-level checks that
 * run as part of `npm test` so a developer catches the regression
 * immediately, before pushing.
 *
 * The check list grows as security tickets land. Each entry names
 * the audit row it pins so a future contributor reviewing a failure
 * can find the rationale.
 *
 * Run: npx tsx tests/production-security-source-checks.test.ts
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function readSrc(rel: string): string {
  const full = resolve(repoRoot, rel);
  if (!existsSync(full)) return '';
  return readFileSync(full, 'utf-8');
}

function findFiles(dir: string, exts: ReadonlySet<string>): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (entry.startsWith('.') || entry === 'node_modules') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...findFiles(full, exts));
      continue;
    }
    const dot = entry.lastIndexOf('.');
    const ext = dot === -1 ? '' : entry.slice(dot);
    if (exts.has(ext)) out.push(full);
  }
  return out;
}

console.log('\n=== T3-89 production-security source checks ===\n');

void (async () => {
  // 1. nodeIntegration: true must NOT appear in any electron source
  //    (audit 5D: "A future PR introduces `nodeIntegration: true`").
  //    The whole renderer stack assumes context-isolated, no-Node
  //    renderer; flipping it open enables Node from the renderer
  //    and breaks every other security guarantee.
  {
    const electronFiles = findFiles(resolve(repoRoot, 'electron'), new Set(['.ts', '.mts', '.js', '.mjs']));
    let hits: string[] = [];
    for (const path of electronFiles) {
      const src = readFileSync(path, 'utf-8');
      // Match `nodeIntegration: true` or `nodeIntegration:true` (with
      // optional whitespace), regardless of casing on the value side.
      if (/nodeIntegration\s*:\s*true\b/.test(src)) {
        hits.push(path);
      }
    }
    assert(hits.length === 0, 'No `nodeIntegration: true` in electron sources');
    if (hits.length > 0) console.error('  Found in:', hits);
  }

  // 2. contextIsolation: false must NOT appear (the inverse of #1).
  //    Disabling context isolation lets renderer scripts reach into
  //    Electron internals via the preload bridge.
  {
    const electronFiles = findFiles(resolve(repoRoot, 'electron'), new Set(['.ts', '.mts', '.js', '.mjs']));
    let hits: string[] = [];
    for (const path of electronFiles) {
      const src = readFileSync(path, 'utf-8');
      if (/contextIsolation\s*:\s*false\b/.test(src)) hits.push(path);
    }
    assert(hits.length === 0, 'No `contextIsolation: false` in electron sources');
    if (hits.length > 0) console.error('  Found in:', hits);
  }

  // 3. webSecurity: false must NOT appear. Disabling webSecurity
  //    turns off CORS, mixed-content protection, and same-origin
  //    enforcement. Never legitimate in a production app.
  {
    const electronFiles = findFiles(resolve(repoRoot, 'electron'), new Set(['.ts', '.mts', '.js', '.mjs']));
    let hits: string[] = [];
    for (const path of electronFiles) {
      const src = readFileSync(path, 'utf-8');
      if (/webSecurity\s*:\s*false\b/.test(src)) hits.push(path);
    }
    assert(hits.length === 0, 'No `webSecurity: false` in electron sources');
    if (hits.length > 0) console.error('  Found in:', hits);
  }

  // 4. T1-84: storage:clear IPC handler is gone and stays gone. The
  //    previous handler wiped every .json in the storage directory in
  //    one call. A regression that re-adds it would expose a
  //    catastrophic single-call data-loss surface.
  {
    const main = readSrc('electron/main.ts');
    assert(
      !/ipcMain\.handle\(\s*[`'"]storage:clear[`'"]/.test(main),
      'T1-84: electron/main.ts has no `storage:clear` IPC handler',
    );
  }

  // 5. T1-85: no `--dev` argv escape hatch. The audit calls out
  //    `process.argv.includes('--dev')` as the typical pattern for a
  //    runtime debug flag that bypasses entitlement / safety checks.
  //    No code uses such a flag today; pin the absence so a future
  //    "I'll just add a --dev flag for debugging" pattern is caught.
  {
    const electronFiles = findFiles(resolve(repoRoot, 'electron'), new Set(['.ts', '.mts', '.js', '.mjs']));
    let hits: string[] = [];
    for (const path of electronFiles) {
      const src = readFileSync(path, 'utf-8');
      if (/process\.argv[\s\S]{0,120}?['"]--dev['"]/.test(src)) hits.push(path);
    }
    assert(hits.length === 0, 'T1-85: no `process.argv.includes("--dev")` escape hatch');
    if (hits.length > 0) console.error('  Found in:', hits);
  }

  // 6. CSP — production mode must NOT include `'unsafe-eval'` in
  //    `script-src`. T3-8 / `electron/cspPolicy.ts` has a `'strict'`
  //    mode for the packaged build that omits `'unsafe-eval'` from
  //    the script-src list. Pin the structural shape: the strict
  //    branch only adds `'unsafe-inline'` to styleSrc (a known
  //    intermediate state pending React inline-style migration), and
  //    the file exposes `policyForbidsUnsafeEval` for predicate use.
  {
    const csp = readSrc('electron/cspPolicy.ts');
    assert(csp.length > 0, 'electron/cspPolicy.ts exists');
    // Negative pin: the strict case body must not push 'unsafe-eval'
    // onto scriptSrc. Match the case body up to its `break;`.
    const strictBody = csp.match(/case\s+['"]strict['"]\s*:\s*([\s\S]*?)break\s*;/);
    assert(strictBody !== null, 'T3-8: cspPolicy.ts has a strict case');
    if (strictBody) {
      assert(
        !/scriptSrc[\s\S]*'unsafe-eval'/.test(strictBody[1] ?? ''),
        'T3-8: strict CSP does not push `\'unsafe-eval\'` onto scriptSrc',
      );
      assert(
        !/scriptSrc[\s\S]*'unsafe-inline'/.test(strictBody[1] ?? ''),
        'T3-8: strict CSP does not push `\'unsafe-inline\'` onto scriptSrc',
      );
    }
    assert(
      /export function policyForbidsUnsafeEval/.test(csp),
      'T3-8: cspPolicy.ts exports policyForbidsUnsafeEval predicate',
    );
  }

  // 7. T1-77: no `DEFAULT_TESTER_HMAC_SECRET` literal in any source.
  //    Belt-and-suspenders against a regression that re-introduces a
  //    hardcoded fallback secret.
  {
    const allSrc = [
      ...findFiles(resolve(repoRoot, 'src'), new Set(['.ts', '.tsx'])),
      ...findFiles(resolve(repoRoot, 'electron'), new Set(['.ts', '.mts'])),
    ];
    let hits: string[] = [];
    for (const path of allSrc) {
      const src = readFileSync(path, 'utf-8');
      if (/DEFAULT_TESTER_HMAC_SECRET\s*=/.test(src)) hits.push(path);
    }
    assert(hits.length === 0, 'T1-77: no DEFAULT_TESTER_HMAC_SECRET assignment');
    if (hits.length > 0) console.error('  Found in:', hits);
  }

  // 8. T1-79 / T3-83: no debug-bypass entitlement IPC handlers.
  //    `entitlement:set` / `__forceProUnlock` would let a renderer
  //    script set tier without going through the verify path.
  {
    const main = readSrc('electron/main.ts');
    assert(
      !/ipcMain\.handle\(\s*[`'"]entitlement(?:s)?:set[`'"]/.test(main),
      'T1-79 / T3-83: no `entitlement:set` debug IPC handler',
    );
    assert(
      !/ipcMain\.handle\(\s*[`'"]__forceProUnlock[`'"]/.test(main),
      'T1-79 / T3-83: no `__forceProUnlock` debug IPC handler',
    );
  }

  // 9. package.json `build.files` excludes source maps from installer.
  //    Vite's `sourcemap: 'hidden'` writes .map files to dist/ for
  //    symbolication, but the installer must not ship them.
  {
    const pkg = JSON.parse(readSrc('package.json')) as {
      build?: { files?: string[] };
    };
    const files = pkg.build?.files ?? [];
    const hasMapNegation = files.some((f) => /^!.*\.map/.test(f));
    assert(hasMapNegation, 'package.json build.files negates `*.map` (T2-105 source-map exclusion)');
  }

  // 10. The verify script (T1-81 + T3-82) is invoked from the build
  //     pipeline. A regression that drops the invocation would mean
  //     bundles ship without the existing pattern checks. Pin the
  //     wiring at the npm-script level.
  {
    const pkg = JSON.parse(readSrc('package.json')) as {
      scripts?: Record<string, string>;
    };
    const buildScript = pkg.scripts?.build ?? '';
    assert(
      /verify-production-build/.test(buildScript),
      'package.json `build` script invokes verify-production-build.mjs',
    );
  }

  // 11. T2-119: every `ipcMain.handle` in `electron/main.ts` is
  //     followed by `assertTrustedSender(event)` (already pinned in
  //     `tests/ipc-attack-surface.test.ts`). Negative-pin source-
  //     scoped here too: no IPC handler may take an event parameter
  //     without consulting it. Guards against a regression that
  //     adds a handler with a stub `(event, args) => { ... }` and
  //     forgets the sender check.
  {
    const main = readSrc('electron/main.ts');
    // Find every `ipcMain.handle(...)` callback body and assert it
    // calls `assertTrustedSender` within the first 200 chars (the
    // very first line of every handler).
    const handlerRe = /ipcMain\.handle\([^,]+,\s*(?:async\s*)?\(event[^)]*\)\s*=>\s*\{([\s\S]{0,400}?)^\s*\}\)/gm;
    let unguarded = 0;
    let m: RegExpExecArray | null;
    while ((m = handlerRe.exec(main)) !== null) {
      const body = m[1] ?? '';
      if (!/assertTrustedSender\b/.test(body)) unguarded += 1;
    }
    assert(unguarded === 0, 'T2-119: every `ipcMain.handle((event, ...))` calls assertTrustedSender');
  }

  // 12. CSP unsafe-eval is documented as dev-only. The dev policy
  //     may include 'unsafe-eval' (Vite HMR needs it); the production
  //     policy may not. The strict pin in #6 covers the positive case;
  //     this check ensures dev-policy `'unsafe-eval'` is gated by
  //     `app.isPackaged === false` or equivalent dev predicate.
  {
    const csp = readSrc('electron/cspPolicy.ts');
    if (/unsafe-eval/.test(csp)) {
      const guarded =
        /(?:isPackaged|isDev|isProduction)[\s\S]{0,500}?unsafe-eval/.test(csp)
        || /unsafe-eval[\s\S]{0,500}?(?:isPackaged|isDev|isProduction)/.test(csp);
      assert(guarded, 'T3-8: any `unsafe-eval` in CSP is gated by a dev/packaged predicate');
    } else {
      assert(true, 'T3-8: no `unsafe-eval` anywhere in CSP source (strict)');
    }
  }

  // 13. Self-pin: T3-89 marker present in this manifest.
  {
    const selfPath = resolve(here, 'production-security-source-checks.test.ts');
    const selfSrc = readFileSync(selfPath, 'utf-8');
    assert(/T3-89/.test(selfSrc), 'Manifest source: T3-89 marker present');
    assert(/audit 5D/i.test(selfSrc), 'Manifest source: audit 5D cited');
  }

  console.log(`\nT3-89 production-security source checks: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
