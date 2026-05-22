/**
 * Resume modal tracking must parse G-code words, not substrings.
 *
 * External sender comparators reinforce the same invariant: pause/resume
 * safety depends on restoring the actual modal laser mode, not a word that
 * appeared inside a comment or as part of another command like M30.
 *
 * Run: npx tsx tests/resume-modal-tokenization.test.ts
 */
import { GrblController } from '../src/controllers/grbl/GrblController';
import { MockSerialPort } from '../src/communication/SerialPort';

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

async function flush(ms = 20): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildPauseablePort(): MockSerialPort {
  return new MockSerialPort((line: string) => {
    if (line.startsWith(';')) return [];
    if (/\bG0\b|\bG00\b|\bG1\b|\bG01\b/.test(line)) return [];
    return ['ok'];
  });
}

async function connectPausedAfterCommentedMotion(commentedMotion: string): Promise<{
  ctrl: GrblController;
  port: MockSerialPort;
}> {
  const ctrl = new GrblController();
  const port = buildPauseablePort();
  port.open();
  await ctrl.connect(port);
  await flush(50);

  await ctrl.sendJob(['G21', 'G90', 'M4 S100', commentedMotion, 'G1 X2 F600']);
  await flush(50);
  assert(port.received.includes(commentedMotion), 'precondition: commented motion line reached serial');

  await ctrl.pause();
  await flush(50);
  port.received.length = 0;
  port.realtimeBytes.length = 0;

  return { ctrl, port };
}

async function testSemicolonCommentDoesNotClearResumeMode(): Promise<void> {
  console.log('\n=== Resume modal tokenization: semicolon comment ===\n');
  const { ctrl, port } = await connectPausedAfterCommentedMotion('G1 X1 F600 ; M5 is documentation, not code');

  const result = await ctrl.resume();
  await flush(50);

  assert(result.accepted === true, 'resume after commented motion is accepted');
  assert(
    port.received.some((line) => line.trim() === 'M4 S0'),
    'resume restores M4 S0 despite semicolon comment mentioning M5',
  );
  assert(port.realtimeBytes.includes(0x7e), 'resume sends cycle-start after modal restore');

  await ctrl.disconnect();
}

async function testParenthesizedCommentDoesNotClearResumeMode(): Promise<void> {
  console.log('\n=== Resume modal tokenization: parenthesized comment ===\n');
  const { ctrl, port } = await connectPausedAfterCommentedMotion('G1 X1 F600 (M5 is documentation, not code)');

  const result = await ctrl.resume();
  await flush(50);

  assert(result.accepted === true, 'resume after parenthesized comment is accepted');
  assert(
    port.received.some((line) => line.trim() === 'M4 S0'),
    'resume restores M4 S0 despite parenthesized comment mentioning M5',
  );

  await ctrl.disconnect();
}

async function testStaleSpindleModeDoesNotLeakIntoNewJob(): Promise<void> {
  console.log('\n=== Resume modal tokenization: stale job state isolation ===\n');
  const ctrl = new GrblController();
  const port = buildPauseablePort();
  port.open();
  await ctrl.connect(port);
  await flush(50);

  const internals = ctrl as unknown as { _lastSpindleMode: 'M3' | 'M4' | null };
  internals._lastSpindleMode = 'M4';

  await ctrl.sendJob(['G21', 'G90', 'G1 X1 F600']);
  await flush(50);
  await ctrl.pause();
  await flush(50);
  port.received.length = 0;
  port.realtimeBytes.length = 0;

  const result = await ctrl.resume();
  await flush(50);

  assert(result.accepted === true, 'resume is accepted for the new paused job');
  assert(
    !port.received.some((line) => /^M[34]\s+S0$/i.test(line.trim())),
    'new job without a spindle mode does not restore stale M3/M4 from a previous job',
  );
  assert(port.realtimeBytes.includes(0x7e), 'resume still sends cycle-start when no modal reassert is needed');

  await ctrl.disconnect();
}

void (async () => {
  await testSemicolonCommentDoesNotClearResumeMode();
  await testParenthesizedCommentDoesNotClearResumeMode();
  await testStaleSpindleModeDoesNotLeakIntoNewJob();

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
