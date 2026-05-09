/**
 * T3-52: renderer/browser lifecycle safety must try to stop motion and
 * command laser-off when the page is closing or being hidden. This is a
 * source-level pin because mounting App.tsx pulls in the full canvas/app
 * shell; the contract we need to preserve is the lifecycle hook shape.
 *
 * Run: npx tsx tests/renderer-lifecycle-safety.test.ts
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

function extractUnloadEffect(source: string): string {
  const start = source.indexOf('T3-52');
  if (start < 0) return '';
  const end = source.indexOf('const handleSaveOrigin', start);
  return end > start ? source.slice(start, end) : source.slice(start);
}

console.log('\n=== T3-52 renderer lifecycle safety ===\n');

{
  const here = dirname(fileURLToPath(import.meta.url));
  const appSource = readFileSync(resolve(here, '../src/ui/components/App.tsx'), 'utf-8');
  const body = extractUnloadEffect(appSource);

  assert(body.length > 0, 'App lifecycle safety block carries T3-52 marker');
  assert(/window\.addEventListener\('beforeunload', handler\)/.test(body),
    'beforeunload listener is registered');
  assert(/window\.removeEventListener\('beforeunload', handler\)/.test(body),
    'beforeunload listener is cleaned up');
  assert(/window\.addEventListener\('pagehide', handler\)/.test(body),
    'pagehide listener is registered');
  assert(/window\.removeEventListener\('pagehide', handler\)/.test(body),
    'pagehide listener is cleaned up');
  assert(/status === 'disconnected' \|\| status === 'connecting'/.test(body),
    'handler skips disconnected and connecting states');
  assert(/ctrl\.stop\(\)/.test(body),
    'handler attempts controller stop before page exits');
  assert(/emergencyLaserOff\(\)/.test(body),
    'handler attempts emergencyLaserOff before page exits');
  assert(/if \(jobWasRunning/.test(body) && /preventDefault\(\)/.test(body) && /returnValue/.test(body),
    'handler warns only when a job was running');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
