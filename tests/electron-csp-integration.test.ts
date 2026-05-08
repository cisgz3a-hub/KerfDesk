/**
 * T3-8: Electron production CSP must use the shared policy builder.
 *
 * Run: npx tsx tests/electron-csp-integration.test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildCspPolicy,
  directiveAllowsToken,
  pickCspMode,
  serializeCsp,
} from '../electron/cspPolicy';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ✓ ${m}`);
  } else {
    failed++;
    console.error(`  ✗ ${m}`);
  }
}

console.log('\n=== T3-8 Electron CSP integration ===\n');

const prodMode = pickCspMode({ isDev: false });
const devMode = pickCspMode({ isDev: true });
const prodPolicy = buildCspPolicy(prodMode);
const devPolicy = buildCspPolicy(devMode);
const prodHeader = serializeCsp(prodPolicy);
const devHeader = serializeCsp(devPolicy);

assert(prodMode === 'strict', `production CSP defaults to strict (got ${prodMode})`);
assert(devMode === 'dev', `dev CSP stays dev-relaxed`);
assert(!directiveAllowsToken(prodPolicy, 'script-src', "'unsafe-eval'"), `production script-src forbids unsafe-eval`);
assert(!directiveAllowsToken(prodPolicy, 'script-src', "'unsafe-inline'"), `production script-src forbids unsafe-inline`);
assert(directiveAllowsToken(prodPolicy, 'style-src', "'unsafe-inline'"), `production style-src keeps inline styles until UI nonce migration`);
assert(directiveAllowsToken(devPolicy, 'script-src', "'unsafe-eval'"), `dev script-src allows unsafe-eval for Vite`);
assert(directiveAllowsToken(devPolicy, 'script-src', "'unsafe-inline'"), `dev script-src allows unsafe-inline for Vite`);
assert(prodHeader.includes("object-src 'none'"), `production header keeps object-src none`);
assert(prodHeader.includes("frame-src 'none'"), `production header keeps frame-src none`);
assert(prodHeader.includes("base-uri 'self'"), `production header keeps base-uri self`);
assert(devHeader.includes("'unsafe-eval'"), `dev header includes unsafe-eval`);

const mainSrc = readFileSync(resolve(process.cwd(), 'electron/main.ts'), 'utf-8');
assert(mainSrc.includes("from './cspPolicy'"), `main imports Electron CSP policy builder`);
assert(mainSrc.includes('serializeCsp(buildCspPolicy(pickCspMode({ isDev })))'), `main builds CSP header from runtime mode`);
assert(!mainSrc.includes("\"script-src 'self' 'unsafe-inline' 'unsafe-eval'\""), `main no longer hard-codes unsafe script-src`);
assert(mainSrc.includes("'Content-Security-Policy': [cspHeader]"), `main installs the computed CSP header`);
assert(/T3-8/.test(mainSrc), `main carries T3-8 marker`);

const srcShim = readFileSync(resolve(process.cwd(), 'src/security/CspPolicy.ts'), 'utf-8');
assert(srcShim.includes("../../electron/cspPolicy"), `renderer-facing CspPolicy shim re-exports the Electron policy source`);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
