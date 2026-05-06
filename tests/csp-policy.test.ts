/**
 * T2-107: tighten production CSP. Pre-T2-107 the CSP at
 * `electron/main.ts:190-191` was hard-coded with unsafe-eval +
 * unsafe-inline. Audit 5B Startup verdict + CSP debt.
 *
 * Run: npx tsx tests/csp-policy.test.ts
 */
import {
  buildCspPolicy,
  serializeCsp,
  getDirective,
  directiveAllowsToken,
  policyForbidsUnsafeEval,
  policyForbidsUnsafeInlineStyles,
  pickCspMode,
  type CspMode,
} from '../src/security/CspPolicy';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { passed++; console.log(`  ✓ ${m}`); }
  else { failed++; console.error(`  ✗ ${m}`); }
}

console.log('\n=== T2-107 CSP policy ===\n');

void (async () => {

// 1. Compatible mode: directives present
{
  const p = buildCspPolicy('compatible');
  for (const name of ['default-src', 'script-src', 'style-src', 'img-src',
                      'font-src', 'connect-src', 'worker-src', 'object-src',
                      'frame-src', 'base-uri']) {
    assert(getDirective(p, name) !== null, `compatible: ${name} present`);
  }
}

// 2. Compatible mode: includes unsafe-eval and unsafe-inline (current state)
{
  const p = buildCspPolicy('compatible');
  assert(directiveAllowsToken(p, 'script-src', "'unsafe-inline'"),
    `compatible: script-src includes 'unsafe-inline'`);
  assert(directiveAllowsToken(p, 'script-src', "'unsafe-eval'"),
    `compatible: script-src includes 'unsafe-eval'`);
  assert(directiveAllowsToken(p, 'style-src', "'unsafe-inline'"),
    `compatible: style-src includes 'unsafe-inline'`);
}

// 3. Strict mode: NO unsafe-eval, NO unsafe-inline
{
  const p = buildCspPolicy('strict');
  assert(!directiveAllowsToken(p, 'script-src', "'unsafe-eval'"),
    `strict: script-src does NOT include 'unsafe-eval'`);
  assert(!directiveAllowsToken(p, 'script-src', "'unsafe-inline'"),
    `strict: script-src does NOT include 'unsafe-inline'`);
  assert(!directiveAllowsToken(p, 'style-src', "'unsafe-inline'"),
    `strict: style-src does NOT include 'unsafe-inline'`);
}

// 4. Strict mode: still has 'self' for script-src
{
  const p = buildCspPolicy('strict');
  assert(directiveAllowsToken(p, 'script-src', "'self'"),
    `strict: script-src still has 'self'`);
}

// 5. policyForbidsUnsafeEval predicate
{
  assert(policyForbidsUnsafeEval(buildCspPolicy('strict')),
    `strict: policyForbidsUnsafeEval = true`);
  assert(!policyForbidsUnsafeEval(buildCspPolicy('compatible')),
    `compatible: policyForbidsUnsafeEval = false`);
}

// 6. policyForbidsUnsafeInlineStyles predicate
{
  assert(policyForbidsUnsafeInlineStyles(buildCspPolicy('strict')),
    `strict: policyForbidsUnsafeInlineStyles = true`);
  assert(!policyForbidsUnsafeInlineStyles(buildCspPolicy('compatible')),
    `compatible: policyForbidsUnsafeInlineStyles = false`);
}

// 7. Object/frame defenses present in all modes
{
  for (const mode of ['dev', 'compatible', 'strict'] as CspMode[]) {
    const p = buildCspPolicy(mode);
    assert(directiveAllowsToken(p, 'object-src', "'none'"),
      `${mode}: object-src 'none'`);
    assert(directiveAllowsToken(p, 'frame-src', "'none'"),
      `${mode}: frame-src 'none'`);
  }
}

// 8. base-uri 'self' in all modes
{
  for (const mode of ['dev', 'compatible', 'strict'] as CspMode[]) {
    const p = buildCspPolicy(mode);
    assert(directiveAllowsToken(p, 'base-uri', "'self'"),
      `${mode}: base-uri 'self'`);
  }
}

// 9. Resource sources present in all modes (img/font/connect/worker)
{
  for (const mode of ['dev', 'compatible', 'strict'] as CspMode[]) {
    const p = buildCspPolicy(mode);
    assert(directiveAllowsToken(p, 'img-src', 'data:'),
      `${mode}: img-src includes data:`);
    assert(directiveAllowsToken(p, 'connect-src', 'wss:'),
      `${mode}: connect-src includes wss: (Falcon Wi-Fi)`);
    assert(directiveAllowsToken(p, 'worker-src', 'blob:'),
      `${mode}: worker-src includes blob: (web workers)`);
  }
}

// 10. serializeCsp: correct header format
{
  const p = buildCspPolicy('strict');
  const text = serializeCsp(p);
  assert(text.includes("default-src 'self'"),
    `serialised: default-src first`);
  assert(text.includes("script-src 'self'"),
    `serialised: script-src present`);
  assert(text.includes('; '),
    `serialised: directives separated by '; '`);
  assert(!text.includes(';;'),
    `serialised: no double semicolons`);
}

// 11. serializeCsp: no trailing semicolon
{
  const text = serializeCsp(buildCspPolicy('strict'));
  assert(!text.endsWith(';'), `no trailing semicolon`);
}

// 12. pickCspMode: dev → 'dev'
{
  assert(pickCspMode({ isDev: true }) === 'dev',
    `isDev=true → 'dev'`);
}

// 13. pickCspMode: prod default → 'compatible'
{
  assert(pickCspMode({ isDev: false }) === 'compatible',
    `isDev=false → 'compatible' (default)`);
}

// 14. pickCspMode: strictOverride → 'strict'
{
  assert(pickCspMode({ isDev: false, strictOverride: true }) === 'strict',
    `strictOverride=true → 'strict'`);
}

// 15. pickCspMode: dev wins over strictOverride
{
  // Even with strictOverride, dev mode keeps loose CSP for HMR.
  assert(pickCspMode({ isDev: true, strictOverride: true }) === 'dev',
    `dev mode beats strictOverride`);
}

// 16. Round-trip: compatible policy serialises into something the
//     existing electron/main.ts CSP looks like
{
  const p = buildCspPolicy('compatible');
  const text = serializeCsp(p);
  // The pre-T2-107 baseline contained these tokens
  for (const expected of [
    "default-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    "'unsafe-inline'",
    "'unsafe-eval'",
  ]) {
    assert(text.includes(expected),
      `compatible: '${expected}' present in serialised header`);
  }
}

// 17. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/security/CspPolicy.ts'), 'utf-8');
  assert(/T2-107/.test(src), 'T2-107 marker in CspPolicy.ts');
  for (const id of [
    'CspMode', 'CspDirective', 'CspPolicy',
    'buildCspPolicy', 'serializeCsp', 'getDirective',
    'directiveAllowsToken', 'policyForbidsUnsafeEval',
    'policyForbidsUnsafeInlineStyles', 'pickCspMode',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
  for (const m of ['dev', 'compatible', 'strict']) {
    assert(src.includes(`'${m}'`), `mode '${m}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
