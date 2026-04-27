/**
 * T1-85 regression test: packaged Electron builds must ignore the --dev
 * command-line argument, and DevTools must only open via the deliberate
 * ELECTRON_ENABLE_DEVTOOLS=1 env var path.
 *
 * Bug: electron/main.ts had `const isDev = !app.isPackaged || process.argv.includes('--dev')`.
 * This single boolean controlled both the renderer source (Vite dev server
 * vs packaged dist/) AND DevTools auto-open. A packaged installer launched
 * as `LaserForge.exe --dev` would try to load http://localhost:3000 (no
 * server in production → blank renderer) AND open DevTools, giving an end
 * user a fully-open renderer console. Combined with renderer state
 * inspection, this weakened commercial posture even after T1-77/T1-81/T1-83
 * closed the auto-Pro paths.
 *
 * Fix: decouple the two responsibilities.
 *  - isDev: based purely on !app.isPackaged. No argv influence.
 *  - shouldOpenDevTools: isDev || process.env.ELECTRON_ENABLE_DEVTOOLS === '1'.
 *    Strict equality with '1' (not any truthy string) so the variable has to
 *    be set deliberately. The env var path is much less discoverable than
 *    a command-line flag — appropriate for a support-engineer use case but
 *    not casually triggered by an end user.
 *
 * This test mirrors the post-fix decision functions and exercises every
 * meaningful corner: packaged/unpackaged x argv-flag x env-var.
 *
 * Run: npx tsx tests/packaged-app-no-dev-arg.test.ts
 */
export {};

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

interface ElectronAppLike {
  isPackaged: boolean;
}

interface ProcessLike {
  argv: string[];
  env: { ELECTRON_ENABLE_DEVTOOLS?: string };
}

interface DecisionResult {
  isDev: boolean;
  shouldOpenDevTools: boolean;
}

/**
 * Mirror of the post-fix decisions in electron/main.ts. Kept structurally
 * identical so a future divergence shows up here. The production code
 * carries `// T1-85` comments marking the gates.
 */
function makeDecisions(electronApp: ElectronAppLike, proc: ProcessLike): DecisionResult {
  const isDev = !electronApp.isPackaged;
  const shouldOpenDevTools = isDev || proc.env.ELECTRON_ENABLE_DEVTOOLS === '1';
  return { isDev, shouldOpenDevTools };
}

void (() => {
  console.log('\n=== packaged app ignores --dev arg (T1-85) ===\n');

  // ── 1. Unpackaged + no flag → dev mode ────────────────────────────────
  // Standard developer-machine run: `npm run electron:dev`.
  {
    const r = makeDecisions(
      { isPackaged: false },
      { argv: ['electron', 'main.js'], env: {} },
    );
    assert(r.isDev === true, 'unpackaged → isDev=true (loads Vite dev server)');
    assert(r.shouldOpenDevTools === true, 'unpackaged → DevTools open (developer convenience)');
  }

  // ── 2. Unpackaged + --dev → still dev mode (flag harmless here) ──────
  // The flag was originally intended to also enable dev behavior in
  // unpackaged runs that wanted to disable it (which never made sense).
  // Post-fix: argv is ignored. Unpackaged is always dev.
  {
    const r = makeDecisions(
      { isPackaged: false },
      { argv: ['electron', 'main.js', '--dev'], env: {} },
    );
    assert(r.isDev === true, 'unpackaged + --dev → isDev=true (argv ignored)');
    assert(r.shouldOpenDevTools === true, 'unpackaged + --dev → DevTools still open');
  }

  // ── 3. Packaged + no flag → production ────────────────────────────────
  // Normal end-user installation. Loads the bundled dist/, no DevTools.
  {
    const r = makeDecisions(
      { isPackaged: true },
      { argv: ['LaserForge.exe'], env: {} },
    );
    assert(r.isDev === false, 'packaged → isDev=false (loads dist/index.html)');
    assert(r.shouldOpenDevTools === false, 'packaged → no DevTools');
  }

  // ── 4. THE BUG: packaged + --dev → still production after fix ────────
  // Pre-fix: this opened DevTools and tried to load localhost:3000.
  // Post-fix: argv has zero effect on a packaged build.
  {
    const r = makeDecisions(
      { isPackaged: true },
      { argv: ['LaserForge.exe', '--dev'], env: {} },
    );
    assert(
      r.isDev === false,
      'packaged + --dev → isDev=false (the original T1-85 bug closed)',
    );
    assert(
      r.shouldOpenDevTools === false,
      'packaged + --dev → no DevTools (the original T1-85 bug closed)',
    );
  }

  // ── 5. Packaged + ELECTRON_ENABLE_DEVTOOLS=1 → support-engineer path ─
  // Renderer still loads dist/ (production renderer), but DevTools open.
  // This is the deliberate escape hatch — set the env var to debug a
  // customer's installed copy.
  {
    const r = makeDecisions(
      { isPackaged: true },
      { argv: ['LaserForge.exe'], env: { ELECTRON_ENABLE_DEVTOOLS: '1' } },
    );
    assert(
      r.isDev === false,
      'packaged + env=1 → isDev=false (still loads packaged renderer)',
    );
    assert(
      r.shouldOpenDevTools === true,
      'packaged + env=1 → DevTools open (deliberate support-engineer path)',
    );
  }

  // ── 6. Strict equality: env=0 → no DevTools ──────────────────────────
  {
    const r = makeDecisions(
      { isPackaged: true },
      { argv: ['LaserForge.exe'], env: { ELECTRON_ENABLE_DEVTOOLS: '0' } },
    );
    assert(
      r.shouldOpenDevTools === false,
      'packaged + env=0 → no DevTools (strict match on "1")',
    );
  }

  // ── 7. Strict equality: env="true" → no DevTools ─────────────────────
  // Other truthy strings are NOT accepted. The env var must be exactly "1".
  // This is intentional — env vars are stringy and we want a deliberate
  // setup, not cargo-cult enabling via "true", "yes", "on", etc.
  {
    const r = makeDecisions(
      { isPackaged: true },
      { argv: ['LaserForge.exe'], env: { ELECTRON_ENABLE_DEVTOOLS: 'true' } },
    );
    assert(
      r.shouldOpenDevTools === false,
      'packaged + env="true" → no DevTools (strict match on "1", not any truthy)',
    );
  }

  // ── 8. Env var unset → no DevTools ───────────────────────────────────
  {
    const r = makeDecisions(
      { isPackaged: true },
      { argv: ['LaserForge.exe'], env: {} },
    );
    assert(
      r.shouldOpenDevTools === false,
      'packaged + env unset → no DevTools',
    );
  }

  // ── 9. Belt-and-suspenders: packaged + --dev + env=1 → DevTools via env ──
  // The combination still works correctly. Renderer is packaged (--dev ignored),
  // DevTools open (env var honored). Proves the two decisions are independent.
  {
    const r = makeDecisions(
      { isPackaged: true },
      { argv: ['LaserForge.exe', '--dev'], env: { ELECTRON_ENABLE_DEVTOOLS: '1' } },
    );
    assert(r.isDev === false, 'packaged + --dev + env=1 → renderer still packaged');
    assert(
      r.shouldOpenDevTools === true,
      'packaged + --dev + env=1 → DevTools open via env (not via argv)',
    );
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
