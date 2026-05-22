/**
 * The v1 controller panel should acknowledge a pause request immediately.
 *
 * `GrblController.pause()` correctly sends the realtime feed-hold byte before
 * awaiting the follow-up M5 S0 safety confirmation, but the v1 React handler
 * previously awaited the whole controller operation before flipping the UI to
 * "Paused". That made a real feed-hold look delayed whenever the M5 critical
 * write took time.
 *
 * Run: npx tsx tests/pause-button-immediate-feedback.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const connectionPanelPath = resolve(here, '../src/ui/components/ConnectionPanelMain.tsx');
const src = readFileSync(connectionPanelPath, 'utf-8');

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

console.log('\n=== v1 pause button immediate feedback ===\n');

const handlerStart = src.indexOf('const handlePauseResume = useCallback');
assert(handlerStart >= 0, 'handlePauseResume is defined');

const handlerEnd = src.indexOf('const handleStop = useCallback', handlerStart);
assert(handlerEnd > handlerStart, 'handlePauseResume body is isolated before handleStop');

const body = src.slice(handlerStart, handlerEnd);
const pauseCallIdx = body.indexOf('await machineService.pause()');
assert(pauseCallIdx >= 0, 'pause branch awaits machineService.pause()');

const optimisticPauseIdx = body.indexOf('setIsPaused(true)');
assert(
  optimisticPauseIdx >= 0 && optimisticPauseIdx < pauseCallIdx,
  'pause branch sets paused UI state before awaiting the full controller pause result',
);

const resumeCallIdx = body.indexOf('await machineService.resume()');
const resumeClearIdx = body.indexOf('setIsPaused(false)');
assert(
  resumeCallIdx >= 0 && resumeClearIdx > resumeCallIdx,
  'resume branch clears paused UI state only after resume completes',
);

assert(
  !/setIsPaused\(!held\)/.test(body),
  'pause/resume handler no longer waits for both branches and toggles with setIsPaused(!held)',
);

assert(
  /feed-hold|pause request|pause requested|immediate/i.test(body),
  'handler comment documents why pause feedback is optimistic while M5 confirmation remains awaited',
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

