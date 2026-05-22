/**
 * LF-EXT-001: the v1 pause/resume button must consume structured
 * SafetyActionResult refusals, not only thrown errors.
 *
 * MachineService.pause()/resume() return accepted=false for normal safety
 * gates such as "not connected", "wrong machine state", or unsupported
 * operation. A resolved-but-refused result must roll back optimistic UI state
 * and surface the refusal.
 *
 * Run: npx tsx tests/pause-button-safety-result-refusal.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '../src/ui/components/ConnectionPanelMain.tsx'), 'utf-8');

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

console.log('\n=== LF-EXT-001 pause/resume structured refusal handling ===\n');

const handlerStart = src.indexOf('const handlePauseResume = useCallback');
assert(handlerStart >= 0, 'handlePauseResume is defined');
const handlerEnd = src.indexOf('const handleStop = useCallback', handlerStart);
assert(handlerEnd > handlerStart, 'handlePauseResume body is isolated before handleStop');
const body = src.slice(handlerStart, handlerEnd);

assert(
  /const\s+resumeResult\s*=\s*await\s+machineService\.resume\(\)/.test(body),
  'resume branch captures the SafetyActionResult returned by MachineService.resume()',
);

assert(
  /if\s*\(\s*!resumeResult\.accepted\s*\)/.test(body),
  'resume branch checks accepted=false structured refusals',
);

assert(
  /const\s+pauseResult\s*=\s*await\s+machineService\.pause\(\)/.test(body),
  'pause branch captures the SafetyActionResult returned by MachineService.pause()',
);

assert(
  /if\s*\(\s*!pauseResult\.accepted\s*\)/.test(body),
  'pause branch checks accepted=false structured refusals',
);

assert(
  /setIsPaused\(false\)[\s\S]{0,600}!pauseResult\.accepted|!pauseResult\.accepted[\s\S]{0,600}setIsPaused\(false\)/.test(body),
  'pause refusal rolls back the optimistic paused UI state',
);

assert(
  /Pause command not accepted[\s\S]{0,500}pauseResult\.message|pauseResult\.message[\s\S]{0,500}Pause command not accepted/.test(body),
  'pause refusal surfaces the structured safety-result message',
);

assert(
  /Resume command not accepted[\s\S]{0,500}resumeResult\.message|resumeResult\.message[\s\S]{0,500}Resume command not accepted/.test(body),
  'resume refusal surfaces the structured safety-result message',
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
