/**
 * T1-163 (audit F-001): regression test for the
 * `ControllerInterface.setStopOnError` signature.
 *
 * Pre-T1-163: the interface declared
 *   setStopOnError?(value: boolean): void;
 * Callers wired against the interface alone (e.g. integration test
 * harnesses, future controller adapters, anything that holds a
 * GrblControllerApi rather than the concrete GrblController) had no
 * compile-time signal that `setStopOnError(false, ...)` requires an
 * `UnsafeStopOnErrorOverrideToken`. The runtime gate inside
 * `GrblController.setStopOnError` would throw, but only at runtime.
 *
 * Post-T1-163:
 *  1. The token type lives in its own module
 *     `src/controllers/grbl/StopOnErrorOverrideToken.ts`.
 *  2. `ControllerInterface.ts` imports the type and the signature is
 *     `setStopOnError?(value: boolean, token?: UnsafeStopOnErrorOverrideToken): void`.
 *  3. `GrblController.ts` re-exports the type + factory for
 *     backward-compat with the historical import path.
 *
 * The runtime gate (the load-bearing defense) is unchanged — it still
 * requires `isUnsafeStopOnErrorOverrideToken(token)` to return true.
 *
 * Run: npx tsx tests/stop-on-error-token-in-interface.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

console.log('\n=== T1-163 setStopOnError token in interface ===\n');

// -------- 1. StopOnErrorOverrideToken.ts exists and exports the contract --------
{
  const path = resolve(repoRoot, 'src/controllers/grbl/StopOnErrorOverrideToken.ts');
  const src = readFileSync(path, 'utf-8');
  assert(
    /export\s+interface\s+UnsafeStopOnErrorOverrideToken\b/.test(src),
    'StopOnErrorOverrideToken.ts exports UnsafeStopOnErrorOverrideToken interface',
  );
  assert(
    /export\s+function\s+createStopOnErrorOverrideToken\s*\(/.test(src),
    'StopOnErrorOverrideToken.ts exports createStopOnErrorOverrideToken factory',
  );
  assert(
    /export\s+function\s+isUnsafeStopOnErrorOverrideToken\s*\(/.test(src),
    'StopOnErrorOverrideToken.ts exports isUnsafeStopOnErrorOverrideToken type-guard',
  );
  assert(
    /T1-163/.test(src) && /F-001/.test(src),
    'StopOnErrorOverrideToken.ts cross-references T1-163 / audit F-001',
  );
}

// -------- 2. ControllerInterface imports the token + declares it in the signature --------
{
  const path = resolve(repoRoot, 'src/controllers/ControllerInterface.ts');
  const src = readFileSync(path, 'utf-8');
  assert(
    /import\s+type\s*\{\s*UnsafeStopOnErrorOverrideToken\s*\}\s+from\s+['"]\.\/grbl\/StopOnErrorOverrideToken['"];?/.test(src),
    'ControllerInterface imports UnsafeStopOnErrorOverrideToken from sibling module',
  );
  // The signature must declare the token parameter so callers wired
  // against the interface see it at compile time.
  assert(
    /setStopOnError\?\s*\(\s*value:\s*boolean\s*,\s*token\?:\s*UnsafeStopOnErrorOverrideToken\s*\)\s*:\s*void/.test(src),
    'ControllerInterface.setStopOnError signature includes the token parameter',
  );
  assert(
    /T1-163.*F-001|F-001.*T1-163/s.test(src),
    'ControllerInterface cross-references T1-163 / audit F-001 in the setStopOnError docstring',
  );
}

// -------- 3. GrblController.ts still re-exports the public surface --------
{
  const path = resolve(repoRoot, 'src/controllers/grbl/GrblController.ts');
  const src = readFileSync(path, 'utf-8');
  // The historical import path `import { ..., createStopOnErrorOverrideToken } from './controllers/grbl/GrblController'`
  // must still work; that's how the audit doc, T1-116 tests, and any
  // existing developer-mode override harness reach the factory.
  assert(
    /export\s+\{\s*createStopOnErrorOverrideToken[^}]*\}|export\s*\{[^}]*createStopOnErrorOverrideToken[^}]*\}/.test(src),
    'GrblController re-exports createStopOnErrorOverrideToken',
  );
  assert(
    /export\s+type\s*\{[^}]*UnsafeStopOnErrorOverrideToken[^}]*\}/.test(src),
    'GrblController re-exports UnsafeStopOnErrorOverrideToken type',
  );
  assert(
    /import\s*\{[^}]*createStopOnErrorOverrideToken[^}]*\}\s+from\s+['"]\.\/StopOnErrorOverrideToken['"];?/.test(src),
    'GrblController imports the token from the extracted sibling module',
  );
}

// -------- 4. Behavioral contracts of the extracted module --------
async function runDynamicChecks(): Promise<void> {
  // The runtime contract is unchanged — verify by exercising the
  // extracted module directly.
  const mod = await import('../src/controllers/grbl/StopOnErrorOverrideToken');
  const { createStopOnErrorOverrideToken, isUnsafeStopOnErrorOverrideToken } = mod;

  // Factory throws on empty reason.
  let threwOnEmpty = false;
  try { createStopOnErrorOverrideToken(''); } catch { threwOnEmpty = true; }
  assert(threwOnEmpty, 'createStopOnErrorOverrideToken rejects empty reason');

  let threwOnWhitespace = false;
  try { createStopOnErrorOverrideToken('   '); } catch { threwOnWhitespace = true; }
  assert(threwOnWhitespace, 'createStopOnErrorOverrideToken rejects whitespace-only reason');

  // Suppress the intentional console.warn from successful mint.
  const origWarn = console.warn;
  console.warn = () => {};
  let tok: ReturnType<typeof createStopOnErrorOverrideToken>;
  try {
    tok = createStopOnErrorOverrideToken('diagnostics: technician investigating spurious error: stream');
  } finally {
    console.warn = origWarn;
  }

  assert(
    tok.kind === 'unsafe-stop-on-error-override-token',
    'minted token carries the correct kind brand',
  );
  assert(
    typeof tok.mintedAt === 'number' && tok.mintedAt > 0,
    'minted token records a mintedAt timestamp',
  );
  assert(
    typeof tok.reason === 'string' && tok.reason.length > 0,
    'minted token records the reason',
  );
  assert(
    Object.isFrozen(tok),
    'minted token is frozen so callers cannot mutate the reason after the fact',
  );

  // Type-guard accepts the real token, rejects forgeries.
  assert(isUnsafeStopOnErrorOverrideToken(tok), 'isUnsafeStopOnErrorOverrideToken accepts a real token');
  assert(!isUnsafeStopOnErrorOverrideToken(null), 'type-guard rejects null');
  assert(!isUnsafeStopOnErrorOverrideToken(undefined), 'type-guard rejects undefined');
  assert(!isUnsafeStopOnErrorOverrideToken({}), 'type-guard rejects empty object');
  assert(
    !isUnsafeStopOnErrorOverrideToken({ kind: 'unsafe-stop-on-error-override-token' }),
    'type-guard rejects token-shaped object with missing reason',
  );
  assert(
    !isUnsafeStopOnErrorOverrideToken({ kind: 'unsafe-stop-on-error-override-token', reason: '' }),
    'type-guard rejects token-shaped object with empty reason',
  );
  assert(
    !isUnsafeStopOnErrorOverrideToken({ kind: 'something-else', reason: 'x' }),
    'type-guard rejects mismatched kind',
  );

  // -------- 5. GrblController.ts re-export path still works --------
  // Anything that used to import from GrblController must still resolve.
  const ctrl = await import('../src/controllers/grbl/GrblController');
  assert(
    typeof ctrl.createStopOnErrorOverrideToken === 'function',
    'createStopOnErrorOverrideToken is still importable from GrblController (backwards-compat path)',
  );
}

runDynamicChecks().then(() => {
  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}).catch((err) => {
  console.error('Unexpected error during dynamic checks:', err);
  process.exit(1);
});
