/**
 * T1-90 regression test: Electron renderer navigation hardening.
 *
 * Bug: electron/main.ts had no setWindowOpenHandler and no will-navigate
 * listener. Without these:
 *   - window.open('https://attacker.com') opens a new BrowserWindow with
 *     full Chromium chrome AND no preload bridge restrictions (a child
 *     WebContents created by window.open does not inherit the parent's
 *     webPreferences).
 *   - A click on <a href="..." target="_blank"> opens externally with
 *     no guard.
 *   - location.href = 'javascript:...' or location.replace('chrome:...')
 *     can navigate the renderer into a different origin or scheme.
 *
 * Fix: install setWindowOpenHandler and will-navigate handlers on the
 * main window and on every WebContents created via the
 * web-contents-created app event (belt-and-suspenders for any child
 * window we don't open today). setWindowOpenHandler routes http(s) URLs
 * to the OS browser via shell.openExternal and denies everything else.
 * will-navigate cancels any navigation that isn't to the dev server (in
 * dev mode) or to the bundled renderer path (in packaged mode).
 *
 * This test mirrors the routing rules in pure logic AND grep-asserts
 * that the production handlers are wired in both code paths.
 *
 * Run: npx tsx tests/electron-navigation-blocked.test.ts
 */
export {};

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const PROD_FILE = join(REPO_ROOT, 'electron', 'main.ts');
const SECURITY_FILE = join(REPO_ROOT, 'electron', 'security.ts');

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

console.log('\n=== electron renderer navigation hardening (T1-90) ===\n');

// ── Pure-logic mirror of setWindowOpenHandler routing ───────────────
type WindowOpenDecision = { action: 'deny'; opensExternally: boolean };

/** Mirror of the setWindowOpenHandler from electron/main.ts. */
function decideWindowOpen(url: string): WindowOpenDecision {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return { action: 'deny', opensExternally: true };
  }
  return { action: 'deny', opensExternally: false };
}

// 1. http(s) URLs route externally; nothing opens in-app.
{
  const r = decideWindowOpen('http://example.com/page');
  assert(r.action === 'deny', 'http URL: in-app new window denied');
  assert(r.opensExternally, 'http URL: opens externally via shell.openExternal');
}
{
  const r = decideWindowOpen('https://docs.example.com');
  assert(r.action === 'deny', 'https URL: in-app new window denied');
  assert(r.opensExternally, 'https URL: opens externally');
}

// 2. file://, javascript:, chrome:, mailto:, custom schemes — all denied entirely.
{
  for (const url of [
    'file:///etc/passwd',
    'file:///C:/Windows/System32/config/SAM',
    'javascript:alert(document.cookie)',
    'chrome://settings',
    'devtools://devtools/bundled/inspector.html',
    'mailto:user@example.com',
    'about:blank',
    'data:text/html,<script>alert(1)</script>',
  ]) {
    const r = decideWindowOpen(url);
    assert(r.action === 'deny', `${url}: action=deny`);
    assert(!r.opensExternally, `${url}: NOT opened externally (no shell.openExternal)`);
  }
}

// ── Pure-logic mirror of will-navigate allowlist ────────────────────
/** Mirror of the will-navigate handler. Returns true if the navigation
 *  should be allowed (not preventDefault'd). */
const DEV_SERVER_ORIGIN = 'http://localhost:3000';

function isExpectedDevServerUrl(url: string): boolean {
  try {
    return new URL(url).origin === DEV_SERVER_ORIGIN;
  } catch {
    return false;
  }
}

const PACKAGED_RENDERER_ROOT = 'file:///C:/Program%20Files/LaserForge/resources/app.asar/dist/';

function isBundledRendererUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.search = '';
    return parsed.protocol === 'file:' && parsed.href.startsWith(PACKAGED_RENDERER_ROOT);
  } catch {
    return false;
  }
}

function navAllowed(url: string, isDev: boolean): boolean {
  const isDevServer = isDev && isExpectedDevServerUrl(url);
  const isAppFile = !isDev && isBundledRendererUrl(url);
  return isDevServer || isAppFile;
}

// 3. Dev mode: dev server allowed, everything else blocked.
{
  assert(navAllowed('http://localhost:3000/', true), 'dev: localhost:3000 root allowed');
  assert(navAllowed('http://localhost:3000', true), 'dev: localhost:3000 origin allowed');
  assert(navAllowed('http://localhost:3000/index.html', true), 'dev: localhost:3000 path allowed');
  assert(!navAllowed('https://attacker.com', true), 'dev: external https blocked');
  assert(!navAllowed('http://localhost:3001/', true), 'dev: different port blocked');
  assert(!navAllowed('http://evil.localhost:3000/', true), 'dev: subdomain prefix-spoofing blocked');
  assert(!navAllowed('http://localhost:3000.evil.test/index.html', true), 'dev: localhost prefix lookalike blocked');
  assert(!navAllowed('file:///etc/passwd', true), 'dev: file:// blocked (no packaged content in dev)');
  assert(!navAllowed('javascript:alert(1)', true), 'dev: javascript: blocked');
}

// 4. Packaged mode: bundled renderer path allowed, other file:// blocked.
{
  assert(
    navAllowed('file:///C:/Program%20Files/LaserForge/resources/app.asar/dist/index.html', false),
    'packaged: bundled renderer index allowed',
  );
  assert(
    navAllowed('file:///C:/Program%20Files/LaserForge/resources/app.asar/dist/index.html#/settings', false),
    'packaged: bundled renderer hash route allowed',
  );
  assert(!navAllowed('file:///app/dist/index.html', false), 'packaged: unrelated app-looking file blocked');
  assert(!navAllowed('file:///C:/Program%20Files/LaserForge/resources/app.asar.evil/dist/index.html', false),
    'packaged: file root prefix lookalike blocked');
  assert(!navAllowed('file:///C:/Users/Alice/Desktop/malicious.html', false), 'packaged: arbitrary local file blocked');
  assert(!navAllowed('http://localhost:3000/', false), 'packaged: dev server blocked');
  assert(!navAllowed('https://attacker.com', false), 'packaged: external https blocked');
  assert(!navAllowed('javascript:alert(1)', false), 'packaged: javascript: blocked');
  assert(!navAllowed('chrome://settings', false), 'packaged: chrome: blocked');
}

// 5. Edge cases.
{
  assert(!navAllowed('', true), 'dev: empty string blocked');
  assert(!navAllowed('', false), 'packaged: empty string blocked');
}

// ── STRUCTURAL: production file wires everything correctly ──────────
{
  const src = readFileSync(PROD_FILE, 'utf8');
  const securitySrc = readFileSync(SECURITY_FILE, 'utf8');

  // Strip comments so doc-references to denylisted patterns don't false-positive.
  // The comment-stripper must NOT eat URL schemes (http://, file://, etc.).
  // Match `//` only when preceded by whitespace, line-start, or `;` — never
  // when preceded by a colon (which is what makes it a URL scheme separator).
  const codeOnly = src
    .replace(/(^|[\s;])\/\/[^\n]*/g, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const securityCodeOnly = securitySrc
    .replace(/(^|[\s;])\/\/[^\n]*/g, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  // 1. shell is imported from 'electron'.
  assert(
    /import\s*\{[^}]*\bshell\b[^}]*\}\s*from\s*['"]electron['"]/.test(codeOnly),
    "shell is imported from 'electron'",
  );

  // 2. shell.openExternal is called somewhere in the file.
  assert(
    /shell\.openExternal\(/.test(codeOnly),
    'shell.openExternal is called for external URL routing',
  );

  // 3. mainWindow.webContents.setWindowOpenHandler is registered in createWindow.
  assert(
    /mainWindow\.webContents\.setWindowOpenHandler\(/.test(codeOnly),
    'mainWindow.webContents.setWindowOpenHandler(...) is registered',
  );

  // 4. mainWindow.webContents.on('will-navigate', ...) is registered.
  assert(
    /mainWindow\.webContents\.on\(\s*['"]will-navigate['"]/.test(codeOnly),
    "mainWindow.webContents.on('will-navigate', ...) is registered",
  );

  // 5. Belt-and-suspenders: web-contents-created handler also calls
  //    setWindowOpenHandler and registers will-navigate.
  // Locate the app.on('web-contents-created' handler.
  const wccStart = codeOnly.indexOf("app.on('web-contents-created'");
  assert(wccStart > 0, "app.on('web-contents-created', ...) handler is present");

  // The handler is the only top-level `app.on(...)` block of its kind;
  // we slice from there to a generous end to cover the whole handler.
  const wccSlice = codeOnly.slice(wccStart, wccStart + 4000);
  assert(
    /contents\.setWindowOpenHandler\(/.test(wccSlice),
    'web-contents-created handler also calls contents.setWindowOpenHandler',
  );
  assert(
    /contents\.on\(\s*['"]will-navigate['"]/.test(wccSlice),
    "web-contents-created handler also registers contents.on('will-navigate', ...)",
  );

  // 6. Verify the http/https allowlist appears in the setWindowOpenHandler
  //    bodies (otherwise the deny-everything pattern could still leak by
  //    omitting the prefix check entirely).
  // Count setWindowOpenHandler call sites.
  const setWindowOpenHits = (codeOnly.match(/setWindowOpenHandler\(/g) ?? []).length;
  assert(
    setWindowOpenHits >= 2,
    `setWindowOpenHandler called at least twice (mainWindow + web-contents-created), got ${setWindowOpenHits}`,
  );
  // Both call sites should reference http:// + https:// prefix matching.
  const httpPrefixHits = (codeOnly.match(/url\.startsWith\(['"]http:\/\/['"]\)/g) ?? []).length;
  const httpsPrefixHits = (codeOnly.match(/url\.startsWith\(['"]https:\/\/['"]\)/g) ?? []).length;
  assert(
    httpPrefixHits >= 2 && httpsPrefixHits >= 2,
    `both http:// and https:// prefix checks appear at least twice (got http=${httpPrefixHits}, https=${httpsPrefixHits})`,
  );

  // 7. Verify the will-navigate allowlist references the dev server origin
  //    through parsed-origin comparison, plus the bundled-app trust helper.
  const localhostDevHits = (securityCodeOnly.match(/localhost:3000/g) ?? []).length;
  assert(
    localhostDevHits >= 1,
    `dev server origin ('http://localhost:3000') defined in shared security helper (got ${localhostDevHits})`,
  );
  assert(
    /new URL\(url\)\.origin === new URL\(EXPECTED_DEV_ORIGIN\)\.origin/.test(securityCodeOnly),
    'shared dev navigation allowlist compares parsed URL origins',
  );
  const fileSchemeHits = (codeOnly.match(/url\.startsWith\(['"]file:\/\/['"]\)/g) ?? []).length;
  assert(
    fileSchemeHits === 0,
    `will-navigate must not trust raw file:// prefixes (got ${fileSchemeHits})`,
  );
  assert(
    (codeOnly.match(/isTrustedElectronUrl\(url\)/g) ?? []).length >= 2,
    'will-navigate handlers use isTrustedElectronUrl(url)',
  );

  // 8. Verify the deny pattern: action: 'deny' appears in BOTH
  //    setWindowOpenHandler bodies.
  const denyHits = (codeOnly.match(/action:\s*['"]deny['"]/g) ?? []).length;
  assert(
    denyHits >= 2,
    `action: 'deny' returned from at least two setWindowOpenHandler call sites (got ${denyHits})`,
  );

  // 9. Verify event.preventDefault() is called in BOTH will-navigate
  //    handlers.
  const preventDefaultHits = (codeOnly.match(/event\.preventDefault\(\)/g) ?? []).length;
  assert(
    preventDefaultHits >= 2,
    `event.preventDefault() called in at least two will-navigate handlers (got ${preventDefaultHits})`,
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
