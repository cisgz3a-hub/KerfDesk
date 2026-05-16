/**
 * T1-64: Pause/Resume/Stop catch blocks must surface errors to the
 * user, not silently log to console only. For safety-critical
 * machine controls the user MUST know if their request didn't reach
 * the machine — a silent stop failure means the job potentially
 * keeps running with no UI signal that anything went wrong.
 *
 * Source-level pin on `ConnectionPanelMain.tsx`:
 *   - handlePauseResume: catch surfaces to appendMessage; pause-only
 *     branch additionally shows a modal alert (resume failure is
 *     mild because the user can retry; pause failure is dangerous
 *     because the job is presumed running).
 *   - handleStop: catch surfaces both an appendMessage AND a modal
 *     alert pointing at physical-E-stop / disconnect as the
 *     immediate-action fallback.
 *   - console.warn is preserved on both paths (existing diagnostic
 *     channel kept intact).
 *
 * ConnectionPanelMain mounts the full machine-service / controller /
 * preflight tree, which makes a React-mount integration test
 * disproportionately heavy for a contract that targets the catch
 * block's text + side-effect shape.
 *
 * Hardware verification: not required (UI plumbing for previously-
 * swallowed async failures, no g-code or machine-state change).
 *
 * Run: npx tsx tests/pause-resume-stop-surface-errors.test.ts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const path = resolve(here, '../src/ui/components/ConnectionPanelMain.tsx');
const src = readFileSync(path, 'utf-8');

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

console.log('\n=== T1-64 pause/resume/stop surface errors ===\n');

// Locate handlePauseResume body so asserts run on just that callback.
{
  const startIdx = src.indexOf('const handlePauseResume = useCallback');
  assert(startIdx >= 0, 'handlePauseResume is defined');
  const nextHandler = src.indexOf('const handleStop = useCallback', startIdx);
  assert(nextHandler > startIdx, 'handlePauseResume body precedes handleStop');
  const body = src.slice(startIdx, nextHandler);

  assert(body.includes('try {'), 'handlePauseResume has a try/catch');
  assert(/console\.warn\(\s*'\[Pause\/Resume\]'/.test(body),
    'handlePauseResume catch still calls console.warn (existing diagnostic preserved)');
  assert(/appendMessage\(`?⚠/.test(body) || /appendMessage\(\s*`⚠/.test(body),
    'handlePauseResume catch calls appendMessage with a "⚠" prefix');
  assert(/Pause command not accepted|Resume command not accepted|command not accepted/.test(body),
    'handlePauseResume appendMessage text mentions "command not accepted"');
  assert(/showAlert\(\s*'Pause failed'/.test(body),
    "handlePauseResume catch calls showAlert with title 'Pause failed' (pause-side only)");
  assert(/if\s*\(\s*!held\s*\)/.test(body),
    'handlePauseResume gates the showAlert on `!held` so resume-failure does NOT modal-alert (resume is the mild case)');
  assert(/job may still be running/.test(body),
    'handlePauseResume modal text warns that the job may still be running');
  assert(/T1-64/.test(body),
    'handlePauseResume carries a T1-64 marker for grep discoverability');
  // Dependency array picks up appendMessage and showAlert.
  assert(/\bappendMessage\b/.test(body) && /\bshowAlert\b/.test(body),
    'handlePauseResume body references appendMessage and showAlert (deps array updated)');
}

// Locate handleStop body.
{
  const startIdx = src.indexOf('const handleStop = useCallback');
  assert(startIdx >= 0, 'handleStop is defined');
  // Find the next callback OR the end of the file's first ~1500 lines worth.
  const nextHandler = src.indexOf('const beginTestFire = useCallback', startIdx);
  assert(nextHandler > startIdx, 'handleStop body precedes beginTestFire');
  const body = src.slice(startIdx, nextHandler);

  assert(body.includes('try {'), 'handleStop has a try/catch');
  assert(/console\.warn\(\s*'\[Stop\]'/.test(body),
    'handleStop catch still calls console.warn (existing diagnostic preserved)');
  assert(/appendMessage\(/.test(body),
    'handleStop catch calls appendMessage');
  assert(/Stop command not accepted/.test(body),
    'handleStop appendMessage text mentions "Stop command not accepted"');
  assert(/showAlert\(\s*'Stop failed'/.test(body),
    "handleStop catch calls showAlert with title 'Stop failed' (stop is always-modal — safety-critical)");
  assert(/E-stop|physical/.test(body),
    'handleStop modal text points at physical E-stop / disconnect as the immediate fallback');
  assert(/T1-64/.test(body),
    'handleStop carries a T1-64 marker for grep discoverability');
  assert(/\bappendMessage\b/.test(body) && /\bshowAlert\b/.test(body),
    'handleStop body references appendMessage and showAlert (deps array updated)');
  // Crucial: the previous code did `setIsPaused(false)` inside try. Per
  // T1-64 commit, the still-running case should NOT silently clear
  // isPaused. Verify isPaused isn't touched in the catch path.
  assert(!/setIsPaused\(false\)/.test(body.slice(body.indexOf('catch'))),
    'handleStop catch does NOT clear isPaused (still-running state stays as last known)');
}

// Locate beginTestFire body: rejected promise must surface visibly and
// release pointer capture instead of becoming an unhandled async failure.
{
  const startIdx = src.indexOf('const beginTestFire = useCallback');
  assert(startIdx >= 0, 'beginTestFire is defined');
  const nextHandler = src.indexOf('const endTestFire = useCallback', startIdx);
  assert(nextHandler > startIdx, 'beginTestFire body precedes endTestFire');
  const body = src.slice(startIdx, nextHandler);

  assert(/\.catch\(\(err: unknown\)/.test(body),
    'beginTestFire catches rejected coordinator promises');
  assert(/releasePointerCapture/.test(body.slice(body.indexOf('.catch'))),
    'beginTestFire catch releases pointer capture');
  assert(/appendMessage\(/.test(body.slice(body.indexOf('.catch'))),
    'beginTestFire catch surfaces a visible message');
  assert(/Test fire failed/.test(body),
    'beginTestFire catch message names test fire failure');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
