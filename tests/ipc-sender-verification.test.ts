/**
 * T2-119: IPC sender verification primitive. Pre-T2-119 every IPC
 * handler accepted requests from any frame; if a future bug
 * introduced an iframe / webview / redirect, every privileged IPC
 * was reachable.
 *
 * Run: npx tsx tests/ipc-sender-verification.test.ts
 */
import {
  evaluateSenderTrust,
  assertSenderTrustResult,
  assertTrustedSenderFrame,
  describeTrustResult,
  checkHandlerCoverage,
  UntrustedSenderError,
  type AppEnvironment,
  type TrustReason,
} from '../src/security/TrustedSender';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-119 IPC sender verification ===\n');

const PACKAGED: AppEnvironment = { kind: 'packaged' };
const DEV: AppEnvironment = { kind: 'dev', expectedDevOrigin: 'http://localhost:3000/' };
const TEST: AppEnvironment = { kind: 'test' };

void (async () => {

// 1. packaged + file:// → trusted
{
  const r = evaluateSenderTrust({ env: PACKAGED, frame: { url: 'file:///app/index.html' } });
  assert(r.trusted, `trusted`);
  if (r.trusted) assert(r.reason === 'packaged-file-url', `reason=packaged-file-url`);
}

// 2. packaged + http:// → untrusted
{
  const r = evaluateSenderTrust({ env: PACKAGED, frame: { url: 'http://attacker.com/' } });
  assert(!r.trusted, `not trusted`);
  if (!r.trusted) {
    assert(r.reason === 'untrusted-origin', `reason=untrusted-origin`);
    assert(r.observedUrl === 'http://attacker.com/', `URL preserved`);
  }
}

// 3. packaged + https:// → untrusted
{
  const r = evaluateSenderTrust({ env: PACKAGED, frame: { url: 'https://attacker.com/' } });
  assert(!r.trusted, `not trusted`);
}

// 4. packaged + devtools:// → untrusted
{
  const r = evaluateSenderTrust({ env: PACKAGED, frame: { url: 'devtools://devtools/bundled/devtools_app.html' } });
  if (!r.trusted) {
    assert(r.reason === 'untrusted-origin', `devtools rejected`);
  } else assert(false, `should be untrusted`);
}

// 5. packaged + null frame → untrusted
{
  const r = evaluateSenderTrust({ env: PACKAGED, frame: null });
  assert(!r.trusted, `null frame untrusted`);
  if (!r.trusted) assert(r.reason === 'no-frame', `reason=no-frame`);
}

// 6. dev + http://localhost:3000 → trusted
{
  const r = evaluateSenderTrust({ env: DEV, frame: { url: 'http://localhost:3000/index.html' } });
  assert(r.trusted, `dev localhost trusted`);
  if (r.trusted) assert(r.reason === 'dev-localhost-origin', `reason=dev-localhost-origin`);
}

// 7. dev + http://localhost:5173 → untrusted (different port)
{
  const r = evaluateSenderTrust({ env: DEV, frame: { url: 'http://localhost:5173/' } });
  assert(!r.trusted, `wrong port untrusted`);
}

// 8. dev + file:// → untrusted (dev expects http origin only)
{
  const r = evaluateSenderTrust({ env: DEV, frame: { url: 'file:///app/index.html' } });
  assert(!r.trusted, `dev + file:// untrusted`);
}

// 9. dev + custom scheme → unknown-scheme
{
  const r = evaluateSenderTrust({ env: DEV, frame: { url: 'electron://something' } });
  if (!r.trusted) assert(r.reason === 'unknown-scheme', `unknown-scheme reason`);
  else assert(false, `should be untrusted`);
}

// 10. test environment → always trusted
{
  const urls = ['http://x', 'https://y', 'file://z', '', 'devtools://x'];
  for (const u of urls) {
    const r = evaluateSenderTrust({ env: TEST, frame: { url: u } });
    assert(r.trusted, `test + '${u}' → trusted`);
  }
}

// 11. test + null frame → still trusted
{
  const r = evaluateSenderTrust({ env: TEST, frame: null });
  assert(r.trusted, `test + null trusted`);
}

// 12. malformed URL (not string) → frame-url-malformed
{
  // Cast through unknown to permit the malformed case in the test
  const frame = { url: 42 } as unknown as { url: string };
  const r = evaluateSenderTrust({ env: PACKAGED, frame });
  if (!r.trusted) assert(r.reason === 'frame-url-malformed', `non-string url`);
  else assert(false, `should be untrusted`);
}

// 13. empty URL → frame-url-malformed
{
  const r = evaluateSenderTrust({ env: PACKAGED, frame: { url: '' } });
  if (!r.trusted) assert(r.reason === 'frame-url-malformed', `empty url`);
  else assert(false, `should be untrusted`);
}

// 14. assertSenderTrustResult: throws on untrusted
{
  let caught: unknown = null;
  try {
    assertSenderTrustResult({
      trusted: false, reason: 'untrusted-origin', observedUrl: 'http://x',
    });
  } catch (e) { caught = e; }
  assert(caught instanceof UntrustedSenderError, `throws UntrustedSenderError`);
}

// 15. assertSenderTrustResult: no-throw on trusted
{
  let threw = false;
  try {
    assertSenderTrustResult({ trusted: true, reason: 'packaged-file-url' });
  } catch { threw = true; }
  assert(!threw, `trusted → no throw`);
}

// 16. assertTrustedSenderFrame: full evaluate + throw integration
{
  let caught: unknown = null;
  try {
    assertTrustedSenderFrame({ env: PACKAGED, frame: { url: 'http://attacker.com' } });
  } catch (e) { caught = e; }
  assert(caught instanceof UntrustedSenderError, `integration throws`);
}

// 17. assertTrustedSenderFrame: trusted no-throw
{
  let threw = false;
  try {
    assertTrustedSenderFrame({ env: PACKAGED, frame: { url: 'file:///app/index.html' } });
  } catch { threw = true; }
  assert(!threw, `integration trusted → no throw`);
}

// 18. UntrustedSenderError carries observed URL in message
{
  try {
    assertTrustedSenderFrame({ env: PACKAGED, frame: { url: 'http://attacker.com/x' } });
    assert(false, `should have thrown`);
  } catch (e) {
    if (e instanceof UntrustedSenderError) {
      assert(e.message.includes('http://attacker.com/x'), `URL in message`);
      assert(e.message.includes('untrusted-origin'), `reason in message`);
    } else assert(false, `wrong error type`);
  }
}

// 19. describeTrustResult: trusted
{
  const r = evaluateSenderTrust({ env: PACKAGED, frame: { url: 'file://x' } });
  const msg = describeTrustResult(r);
  assert(msg.includes('Trusted'), `trusted message`);
}

// 20. describeTrustResult: per-reason copy
{
  const reasons: TrustReason[] = ['no-frame', 'frame-url-malformed', 'unknown-scheme', 'untrusted-origin'];
  const messages = new Set<string>();
  for (const reason of reasons) {
    const result = { trusted: false as const, reason, observedUrl: 'http://x' };
    const msg = describeTrustResult(result);
    assert(msg.length > 0, `'${reason}': non-empty`);
    messages.add(msg);
  }
  assert(messages.size === 4, `4 distinct messages`);
}

// 21. checkHandlerCoverage: every handler guarded → all OK
{
  const source = `
ipcMain.handle('a', (event, x) => {
  assertTrustedSender(event);
  return x;
});

ipcMain.handle('b', (event) => {
  assertTrustedSender(event);
});
`.trim();
  const r = checkHandlerCoverage({ source });
  assert(r.totalHandlers === 2, `2 handlers`);
  assert(r.guarded === 2, `2 guarded`);
  assert(r.unguarded.length === 0, `0 unguarded`);
}

// 22. checkHandlerCoverage: bare handler → flagged
{
  const source = `
ipcMain.handle('a', (event, x) => {
  assertTrustedSender(event);
  return x;
});

ipcMain.handle('b', (event) => {
  return 'no guard';
});
`.trim();
  const r = checkHandlerCoverage({ source });
  assert(r.totalHandlers === 2, `2 handlers`);
  assert(r.unguarded.length === 1, `1 unguarded`);
  assert(r.unguarded[0].snippet.includes("'b'"), `flagged handler is 'b'`);
}

// 23. checkHandlerCoverage: custom guard name
{
  const source = `ipcMain.handle('x', (event) => { customAssert(event); });`;
  const r = checkHandlerCoverage({ source, guardName: 'customAssert' });
  assert(r.guarded === 1, `custom guard works`);
}

// 24. THE audit's headline: dev-localhost trusted, packaged-file trusted, attacker rejected
{
  // Audit's three concrete cases:
  assert(evaluateSenderTrust({ env: PACKAGED, frame: { url: 'file:///x' } }).trusted, `case A: packaged file:// → trusted`);
  assert(evaluateSenderTrust({ env: DEV, frame: { url: 'http://localhost:3000/' } }).trusted, `case B: dev localhost → trusted`);
  assert(!evaluateSenderTrust({ env: PACKAGED, frame: { url: 'http://attacker.com/' } }).trusted, `case C: attacker → blocked`);
}

// 25. Regression: dev origin must match exactly, not by string prefix
{
  const r = evaluateSenderTrust({
    env: { kind: 'dev', expectedDevOrigin: 'http://localhost:3000' },
    frame: { url: 'http://localhost:3000.evil.test/index.html' },
  });
  assert(!r.trusted, `dev prefix lookalike untrusted`);
}

// 26. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/security/TrustedSender.ts'), 'utf-8');
  assert(/T2-119/.test(src), 'T2-119 marker');
  for (const id of [
    'AppEnvironment', 'SenderFrame', 'TrustReason', 'TrustResult',
    'evaluateSenderTrust', 'UntrustedSenderError',
    'assertSenderTrustResult', 'assertTrustedSenderFrame',
    'describeTrustResult', 'HandlerCoverageReport',
    'checkHandlerCoverage',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
  for (const r of ['packaged-file-url', 'dev-localhost-origin',
                   'test-environment', 'unknown-scheme',
                   'untrusted-origin', 'no-frame', 'frame-url-malformed']) {
    assert(src.includes(`'${r}'`), `reason '${r}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
