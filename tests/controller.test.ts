/**
 * === FILE: /tests/controller.test.ts ===
 *
 * Purpose:    Tests for the GRBL controller: connection lifecycle,
 *             G-code streaming with buffer management, state machine
 *             transitions, status report parsing, and job progress.
 *             Uses MockSerialPort to simulate a GRBL device.
 *
 * Dependencies:
 *   - /src/controllers/grbl/GrblController.ts
 *   - /src/communication/SerialPort.ts
 *   - /src/core/output/Output.ts (Output type)
 * Last updated: Phase 6, Step 22 — GRBL Controller
 *
 * Run with: npx tsx tests/controller.test.ts
 */

import { GrblController } from '../src/controllers/grbl/GrblController';
import { MockSerialPort } from '../src/communication/SerialPort';
import {
  type MachineState,
  type JobProgress,
} from '../src/controllers/ControllerInterface';
import { type Output } from '../src/core/output/Output';

// ─── ASSERTIONS ──────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

/** Wait for all pending microtasks to flush (simulates async serial). */
function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 10));
}

/** Wait until condition holds or timeout (MockSerialPort can delay move `ok` by tens of ms). */
async function waitUntil(cond: () => boolean, timeoutMs: number, stepMs = 20): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (cond()) return;
    await new Promise<void>(r => setTimeout(r, stepMs));
  }
}

/** Create a minimal Output with G-code text. */
function makeOutput(gcode: string): Output {
  return {
    id: 'test-output',
    planId: 'test-plan',
    format: 'grbl',
    createdAt: new Date().toISOString(),
    text: gcode,
    lineCount: gcode.split('\n').length,
    binary: null,
    fileSizeBytes: gcode.length,
  };
}

/** LaserController.sendJob expects string[]; Output carries joined text. */
function outputToLines(output: Output): string[] {
  return (output.text ?? '').split('\n');
}

// ─── TEST: CONNECTION ────────────────────────────────────────────

async function testConnection() {
  console.log('\n=== Test: GRBL Connection ===');

  const ctrl = new GrblController();
  const port = new MockSerialPort();

  assert(ctrl.state.status === 'disconnected', 'Starts disconnected');
  assert(ctrl.protocolName === 'GRBL 1.1', 'Protocol name is GRBL 1.1');

  // Open port (triggers welcome message from mock)
  port.open();
  await ctrl.connect(port);
  await flush();

  assert(ctrl.state.status === 'idle', 'Connected → idle after welcome message');

  // Disconnect
  await ctrl.disconnect();
  assert(ctrl.state.status === 'disconnected', 'Disconnected after disconnect()');
}

// ─── TEST: SIMPLE STREAMING ──────────────────────────────────────

async function testSimpleStreaming() {
  console.log('\n=== Test: Simple G-code Streaming ===');

  const ctrl = new GrblController();
  const port = new MockSerialPort();
  port.open();
  await ctrl.connect(port);
  await flush();

  // Track progress updates
  const progressUpdates: JobProgress[] = [];
  ctrl.onProgress(p => progressUpdates.push({ ...p }));

  // Track state changes
  const stateChanges: string[] = [];
  ctrl.onStateChange(s => stateChanges.push(s.status));

  // Create a small G-code job
  const gcode = [
    'G21',
    'G90',
    'G0 X10 Y10',
    'M4 S800',
    'G1 X50 Y10 F150',
    'G1 X50 Y50 F150',
    'M5 S0',
    'G0 X0 Y0',
    'M2',
  ].join('\n');

  const output = makeOutput(gcode);

  // Send job
  ctrl.sendJob(outputToLines(output));
  assert(ctrl.isJobRunning, 'Job is running after sendJob()');

  // Let all the async serial responses process
  // Each line gets 'ok' from mock → triggers next line → etc.
  await flush();
  await flush(); // Extra flush for cascading async
  await flush();
  await flush();
  await flush();

  // Verify all lines were sent (may stream before all move `ok`s return)
  const sentLines = port.received.filter(l =>
    l.endsWith('\n') ? l.slice(0, -1) : l
  );

  assert(sentLines.length >= 9, `All 9 G-code lines sent (got ${sentLines.length})`);

  await waitUntil(() => !ctrl.isJobRunning, 30_000);

  // Verify job completed
  assert(!ctrl.isJobRunning, 'Job completed (no longer running)');

  // Verify progress was tracked
  assert(progressUpdates.length > 0, `Progress updates received (${progressUpdates.length})`);

  const lastProgress = progressUpdates[progressUpdates.length - 1];
  assert(lastProgress.linesAcknowledged === 9, `All 9 lines acknowledged (got ${lastProgress.linesAcknowledged})`);
  assert(lastProgress.percentComplete === 100, `Progress = 100% (got ${lastProgress.percentComplete.toFixed(1)}%)`);
  assert(lastProgress.healthStatus === 'healthy', 'Streaming health healthy on fast mock');
  assert(lastProgress.ackRateHz != null, 'Ack rate computed after job');

  // Verify state transitions: idle → run → idle
  assert(stateChanges.includes('run'), 'State transitioned to run');
  assert(stateChanges[stateChanges.length - 1] === 'idle', 'State returned to idle after job');

  await ctrl.disconnect();
}

// ─── TEST: BUFFER MANAGEMENT ─────────────────────────────────────

async function testBufferManagement() {
  console.log('\n=== Test: Buffer Management ===');

  const ctrl = new GrblController();

  // Custom responder that delays 'ok' responses
  // This lets us verify that the controller respects buffer limits
  const okQueue: (() => void)[] = [];
  const port = new MockSerialPort((line: string) => {
    if (line.startsWith(';')) return [];
    // Don't auto-respond — let test control when 'ok' arrives
    okQueue.push(() => port.injectResponse('ok'));
    return [];
  });

  port.open();
  await ctrl.connect(port);
  await flush();

  // Create a job with lines of known lengths
  // "G1 X100.000 Y200.000 F3000 S800" = 31 chars + newline = 32 bytes
  const longLines = Array.from({ length: 10 }, (_, i) =>
    `G1 X${(100 + i).toFixed(3)} Y${(200 + i).toFixed(3)} F3000 S800`
  );
  const output = makeOutput(longLines.join('\n'));

  const receivedBeforeJob = port.received.length;
  ctrl.sendJob(outputToLines(output));
  await flush();

  // With 127-byte buffer and ~32 bytes per line,
  // controller should send ~3-4 lines before waiting
  const sentBeforeAck = port.received.length - receivedBeforeJob;
  assert(sentBeforeAck >= 3, `Sent ${sentBeforeAck} lines before any ack (buffer filling)`);
  assert(sentBeforeAck <= 5, `Sent ${sentBeforeAck} lines — didn't overflow 127-byte buffer`);

  // Now send 'ok' for each pending line and let more stream
  while (okQueue.length > 0) {
    okQueue.shift()!();
    await flush();
  }

  // More lines should have been sent after acks freed buffer
  await flush();
  while (okQueue.length > 0) {
    okQueue.shift()!();
    await flush();
  }
  await flush();
  while (okQueue.length > 0) {
    okQueue.shift()!();
    await flush();
  }
  await flush();

  // Exclude any non-job lines (e.g. `$$`); count only streamed G1 job moves.
  const jobLines = port.received.filter(l => {
    const s = l.endsWith('\n') ? l.slice(0, -1) : l;
    return /^G1 X\d/.test(s);
  });
  assert(jobLines.length === 10, `All 10 job lines eventually sent (got ${jobLines.length}, total TX ${port.received.length})`);

  await ctrl.disconnect();
}

// ─── TEST: STATUS PARSING ────────────────────────────────────────

async function testStatusParsing() {
  console.log('\n=== Test: Status Report Parsing ===');

  const ctrl = new GrblController();
  const port = new MockSerialPort();
  port.open();
  await ctrl.connect(port);
  await flush();

  // Track state changes
  const states: MachineState[] = [];
  ctrl.onStateChange(s => states.push({ ...s }));

  // Inject a status report
  port.injectResponse('<Run|MPos:125.400,50.200,0.000|FS:3000,800>');
  await flush();

  assert(states.length > 0, 'State change received from status report');
  const lastState = states[states.length - 1];
  assert(lastState.status === 'run', `Status parsed as "run" (got "${lastState.status}")`);
  assert(Math.abs(lastState.position.x - 125.4) < 0.001, `Position X = 125.4 (got ${lastState.position.x})`);
  assert(Math.abs(lastState.position.y - 50.2) < 0.001, `Position Y = 50.2 (got ${lastState.position.y})`);
  assert(lastState.feedRate === 3000, `Feed rate = 3000 (got ${lastState.feedRate})`);
  assert(lastState.spindleSpeed === 800, `Spindle/power = 800 (got ${lastState.spindleSpeed})`);

  // Test idle status
  port.injectResponse('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();

  const idleState = states[states.length - 1];
  assert(idleState.status === 'idle', 'Status parsed as "idle"');
  assert(idleState.position.x === 0, 'Position reset to 0');

  // Test hold status
  port.injectResponse('<Hold:0|MPos:75.000,30.000,0.000|FS:0,0>');
  await flush();

  const holdState = states[states.length - 1];
  assert(holdState.status === 'hold', 'Hold:0 parsed as "hold"');

  await ctrl.disconnect();
}

// ─── TEST: ALARM VIA STATUS REPORT CLEARS STUCK JOB RUNNING ──────

async function testAlarmStatusReportResetsStuckJobRunning() {
  console.log('\n=== Test: Alarm status report resets stuck job running ===');

  const ctrl = new GrblController();
  const port = new MockSerialPort();
  port.open();
  await ctrl.connect(port);
  await flush();

  // Simulate stuck _isJobRunning (e.g. alarm only from periodic '?', no ALARM:N line)
  (ctrl as unknown as { _isJobRunning: boolean })._isJobRunning = true;

  assert(ctrl.isJobRunning, 'Precondition: controller thinks a job is running');

  let blocked = false;
  try {
    ctrl.sendCommand('$X');
  } catch {
    blocked = true;
  }
  assert(blocked, 'Precondition: manual $X blocked while job running');

  port.injectResponse('<Alarm|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();

  assert(ctrl.state.status === 'alarm', 'Status parsed as alarm from report');
  assert(!ctrl.isJobRunning, 'Alarm status report clears stuck _isJobRunning');

  let threwAfterReset = false;
  try {
    ctrl.sendCommand('$X');
  } catch {
    threwAfterReset = true;
  }
  assert(!threwAfterReset, 'sendCommand($X) no longer throws after defensive reset');

  await ctrl.disconnect();
}

// ─── TEST: PAUSE / RESUME ────────────────────────────────────────

async function testPauseResume() {
  console.log('\n=== Test: Pause / Resume ===');

  const ctrl = new GrblController();

  // Use a non-auto-responding mock so job stays running
  const okQueue: (() => void)[] = [];
  const port = new MockSerialPort((line: string) => {
    if (line.startsWith(';')) return [];
    okQueue.push(() => port.injectResponse('ok'));
    return [];
  });

  port.open();
  await ctrl.connect(port);
  await flush();

  const states: string[] = [];
  ctrl.onStateChange(s => states.push(s.status));

  // Start a job with many lines
  const gcode = Array.from({ length: 20 }, (_, i) =>
    `G1 X${i * 10} Y${i * 5} F1000`
  ).join('\n');
  ctrl.sendJob(outputToLines(makeOutput(gcode)));

  // State should be 'run' immediately (synchronous)
  assert(ctrl.state.status === 'run', 'Job started → run state');

  // Pause while job is still running (no oks sent yet)
  ctrl.pause();
  assert(ctrl.state.status === 'hold', 'Pause → hold state');

  // Resume
  ctrl.resume();
  assert(ctrl.state.status === 'run', 'Resume → run state');

  // Now drain all oks to complete the job
  while (okQueue.length > 0) {
    okQueue.shift()!();
    await flush();
  }
  // More lines may have been sent after oks freed buffer
  for (let i = 0; i < 10; i++) {
    while (okQueue.length > 0) {
      okQueue.shift()!();
      await flush();
    }
    await flush();
  }

  // Stop (soft reset + immediate job abort; motion/laser halt now, re-home may be required)
  ctrl.stop();
  await flush();
  assert(!ctrl.isJobRunning, 'Stop → job aborted');

  await ctrl.disconnect();
}

// ─── TEST: ERROR HANDLING ────────────────────────────────────────

async function testErrorHandling() {
  console.log('\n=== Test: Error Handling ===');

  const ctrl = new GrblController();

  // Responder that returns error for one specific line
  const port = new MockSerialPort((line: string) => {
    if (line.startsWith(';')) return [];
    if (line.includes('BADCMD')) return ['error:20'];
    return ['ok'];
  });

  port.open();
  await ctrl.connect(port);
  await flush();

  const errors: string[] = [];
  ctrl.onError((code, msg) => errors.push(`${code}: ${msg}`));

  const gcode = [
    'G21',
    'G90',
    'BADCMD',
    'G0 X10 Y10',
    'M2',
  ].join('\n');

  ctrl.sendJob(outputToLines(makeOutput(gcode)));
  await flush();
  await flush();
  await flush();

  // Error should have been captured
  assert(errors.length === 1, `1 error captured (got ${errors.length})`);
  assert(errors[0].includes('20'), 'Error code 20 reported');
  assert(errors[0].includes('BADCMD'), 'Error attributed to correct line');

  // Job should abort on error (safe default for real hardware)
  assert(!ctrl.isJobRunning, 'Job stopped after error');

  await ctrl.disconnect();
}

// ─── TEST: RAW LINE LOGGING ──────────────────────────────────────

async function testRawLineLogging() {
  console.log('\n=== Test: Raw Line Logging ===');

  const ctrl = new GrblController();
  const port = new MockSerialPort();
  port.open();
  await ctrl.connect(port);
  await flush();

  const rawLines: { line: string; dir: string }[] = [];
  ctrl.onRawLine((line, dir) => rawLines.push({ line, dir }));

  ctrl.sendCommand('$$');
  await flush();

  const txLines = rawLines.filter(r => r.dir === 'tx');
  const rxLines = rawLines.filter(r => r.dir === 'rx');

  assert(txLines.length >= 1, `TX lines logged (${txLines.length})`);
  assert(rxLines.length >= 1, `RX lines logged (${rxLines.length})`);
  assert(txLines.some(r => r.line.includes('$$')), 'TX contains $$ command');
  assert(rxLines.some(r => r.line === 'ok'), 'RX contains ok response');

  await ctrl.disconnect();
}

// ─── TEST: DISCONNECT DURING JOB ─────────────────────────────────

async function testDisconnectDuringJob() {
  console.log('\n=== Test: Disconnect During Job ===');

  const ctrl = new GrblController();

  // Slow responder — doesn't auto-respond
  const port = new MockSerialPort(() => []);
  port.open();
  await ctrl.connect(port);
  await flush();

  const gcode = Array.from({ length: 50 }, (_, i) =>
    `G1 X${i} Y${i} F1000`
  ).join('\n');

  ctrl.sendJob(outputToLines(makeOutput(gcode)));
  await flush();

  assert(ctrl.isJobRunning, 'Job is running');

  // Simulate USB disconnect
  port.simulateDisconnect();
  await flush();

  assert(ctrl.state.status === 'disconnected', 'Status → disconnected');
  assert(!ctrl.isJobRunning, 'Job aborted on disconnect');

  // No crash — clean handling
  assert(true, 'No crash on disconnect during job');
}

// ─── RUN ALL TESTS ───────────────────────────────────────────────

async function runAll() {
  await testConnection();
  await testSimpleStreaming();
  await testBufferManagement();
  await testStatusParsing();
  await testAlarmStatusReportResetsStuckJobRunning();
  await testPauseResume();
  await testErrorHandling();
  await testRawLineLogging();
  await testDisconnectDuringJob();

  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${'='.repeat(40)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

runAll().catch(e => {
  console.error(e);
  process.exit(1);
});
