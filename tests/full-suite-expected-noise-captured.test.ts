/**
 * F45-17-002: expected error/warning paths should be captured and asserted
 * inside the tests that trigger them, not leaked into full-suite stderr.
 *
 * Run: npx tsx tests/full-suite-expected-noise-captured.test.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

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

console.log('\n=== F45-17-002 expected suite noise is captured ===\n');

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const transport = fs.readFileSync(path.join(repoRoot, 'tests', 'transport-multi-subscribe.test.ts'), 'utf8');
const modalConfirm = fs.readFileSync(path.join(repoRoot, 'tests', 'modal-confirm-with-checkbox.test.tsx'), 'utf8');
const uiStart = fs.readFileSync(path.join(repoRoot, 'tests', 'ui-start-job-uses-ticket.test.tsx'), 'utf8');
const compileCancel = fs.readFileSync(path.join(repoRoot, 'tests', 'usecompilemanager-cancel-progress.test.tsx'), 'utf8');
const compileStale = fs.readFileSync(path.join(repoRoot, 'tests', 'usecompilemanager-stale-no-loop.test.tsx'), 'utf8');

assert(
  /new\s+SubscriptionSet<\[\]>\(\{\s*onListenerError:/.test(transport),
  'transport listener-crash test injects an onListenerError capture',
);
assert(
  /capturedListenerErrors/.test(transport) && /message\s*===\s*'crash'/.test(transport),
  'transport listener-crash test asserts the captured crash without default console.error',
);
assert(
  !/const\s+set\s*=\s*new\s+SubscriptionSet<\[\]>\(\);\s*set\.subscribe\(\(\)\s*=>\s*\{\s*throw\s+new\s+Error\('crash'\);/.test(transport),
  'transport listener-crash test no longer uses the default console-error handler',
);

assert(
  /async\s+function\s+unmountRoot/.test(uiStart),
  'ui-start-job-uses-ticket uses an act-wrapped unmount helper',
);
assert(
  !/\n\s+root\.unmount\(\);/.test(uiStart.replace(/async\s+function\s+unmountRoot[\s\S]*?\n\}/, '')),
  'ui-start-job-uses-ticket has no bare root.unmount calls outside the helper',
);

assert(
  /async\s+function\s+mount\(\): Promise<void>/.test(modalConfirm)
  && /await\s+act\(async\s*\(\)\s*=>\s*\{[\s\S]*root!?\s*\.render/.test(modalConfirm),
  'modal confirm test renders inside async act',
);
assert(
  /async\s+function\s+unmountAll/.test(modalConfirm)
  && /await\s+act\(async\s*\(\)\s*=>\s*\{[\s\S]*root!?\s*\.unmount\(\)/.test(modalConfirm),
  'modal confirm test unmounts inside async act',
);
assert(
  /async\s+function\s+finishConfirmWithCheckbox/.test(modalConfirm)
  && /async\s+function\s+dismissModal/.test(modalConfirm),
  'modal confirm state transitions use act-wrapped helpers',
);

assert(
  /const\s+expectedConsoleErrors: string\[\]\s*=\s*\[\]/.test(compileCancel),
  'useCompileManager cancel test captures expected console errors locally',
);
assert(
  !/originalError\(\.\.\.args\)/.test(compileCancel),
  'useCompileManager cancel test does not forward captured expected console errors to stderr',
);
assert(
  /act\(\.\.\.\)/.test(compileCancel) && /errLogs\.filter/.test(compileCancel),
  'useCompileManager cancel test asserts unexpected React act warnings remain absent',
);
assert(
  /const\s+expectedConsoleErrors: string\[\]\s*=\s*\[\]/.test(compileStale),
  'useCompileManager stale test captures expected console errors locally',
);
assert(
  !/originalError\(\.\.\.args\)/.test(compileStale),
  'useCompileManager stale test does not forward captured expected console errors to stderr',
);
assert(
  /act\(\.\.\.\)/.test(compileStale) && /errLogs\.filter/.test(compileStale),
  'useCompileManager stale test asserts unexpected React act warnings remain absent',
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
