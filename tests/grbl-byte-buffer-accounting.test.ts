/**
 * GRBL byte-buffer accounting regression.
 *
 * GRBL's receive buffer is measured in bytes, but JavaScript string
 * length is UTF-16 code units. Imported/user G-code can carry inline
 * comments, so a line can be under 127 JS characters while exceeding
 * the 127-byte GRBL buffer once encoded for serial transport.
 *
 * Run: npx tsx tests/grbl-byte-buffer-accounting.test.ts
 */
import { GrblController } from '../src/controllers/grbl/GrblController';
import { MockSerialPort } from '../src/communication/SerialPort';
import type { ControllerOutput } from '../src/controllers/ControllerInterface';
import type { GcodeChunk, SpoolHandle } from '../src/core/output/GcodeStreaming';

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

function flush(ms = 20): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function oversizedUtf8Line(): string {
  const line = `G1 X0 ; ${'é'.repeat(62)}`;
  assert(line.length + 1 <= 127, `test fixture is under 127 JS chars including newline (${line.length + 1})`);
  assert(new TextEncoder().encode(`${line}\n`).byteLength > 127, 'test fixture exceeds 127 UTF-8 bytes');
  return line;
}

async function connectController(): Promise<{ ctrl: GrblController; port: MockSerialPort }> {
  const ctrl = new GrblController();
  const port = new MockSerialPort();
  port.open();
  await ctrl.connect(port);
  await flush(50);
  port.nextStatusQueryResponse = null;
  return { ctrl, port };
}

async function connectControllerWithReportedRxBuffer(
  reportedRxBytes: number,
): Promise<{ ctrl: GrblController; port: MockSerialPort }> {
  const port = new MockSerialPort(line => {
    if (line === '$I') return ['[VER:1.1h.20250101:LaserForge]', `[OPT:V,15,${reportedRxBytes}]`, 'ok'];
    if (line === '$$') return ['$10=0', '$30=1000', '$31=0', '$32=1', 'ok'];
    if (line === '$#') return ['[G54:0.000,0.000,0.000]', 'ok'];
    return [];
  });
  const ctrl = new GrblController();
  port.open();
  await ctrl.connect(port);
  await flush(50);
  port.nextStatusQueryResponse = null;
  return { ctrl, port };
}

function oneLineSpool(line: string): SpoolHandle {
  return {
    id: 'oversized-utf8-line-spool',
    contentHash: 'oversized-utf8-line',
    lineCount: 1,
    byteCount: new TextEncoder().encode(`${line}\n`).byteLength,
    usesM4: false,
    open: () => (async function* (): AsyncGenerator<GcodeChunk, void, void> {
      yield {
        lines: [line],
        cumulativeLineCount: 1,
        isLast: true,
      };
    })(),
  };
}

function lineSpool(id: string, lines: readonly string[]): SpoolHandle {
  const text = `${lines.join('\n')}\n`;
  return {
    id,
    contentHash: id,
    lineCount: lines.length,
    byteCount: new TextEncoder().encode(text).byteLength,
    usesM4: false,
    open: () => (async function* (): AsyncGenerator<GcodeChunk, void, void> {
      yield {
        lines: [...lines],
        cumulativeLineCount: lines.length,
        isLast: true,
      };
    })(),
  };
}

function defaultFitsButSmallRxOversizedLine(): string {
  const line = `G1 X0 ; ${'A'.repeat(60)}`;
  const bytes = new TextEncoder().encode(`${line}\n`).byteLength;
  assert(bytes > 63, `test fixture exceeds 63-byte reported RX budget (${bytes})`);
  assert(bytes <= 127, `test fixture still fits the default 127-byte budget (${bytes})`);
  return line;
}

async function testManualCommandRejectsUtf8OversizedLine(): Promise<void> {
  console.log('\n=== GRBL byte accounting: manual command ===\n');
  const { ctrl, port } = await connectController();
  const line = oversizedUtf8Line();

  let rejected = false;
  try {
    ctrl.sendCommand(line, 'internal');
  } catch (err: unknown) {
    rejected = /127 bytes/.test(err instanceof Error ? err.message : String(err));
  }

  assert(rejected, 'manual command is rejected by encoded byte length');
  assert(!port.received.includes(line), 'oversized manual command is not written to serial');

  await ctrl.disconnect();
}

async function testReportedSmallRxBufferRejectsOverlongManualCommand(): Promise<void> {
  console.log('\n=== GRBL byte accounting: reported RX buffer command limit ===\n');
  const { ctrl, port } = await connectControllerWithReportedRxBuffer(64);
  const line = defaultFitsButSmallRxOversizedLine();

  let rejected = false;
  try {
    ctrl.sendCommand(line, 'internal');
  } catch (err: unknown) {
    rejected = /63 bytes/.test(err instanceof Error ? err.message : String(err));
  }

  assert(rejected, 'manual command uses controller-reported RX budget, not hard-coded default');
  assert(!port.received.includes(line), 'manual command over reported RX budget is not written');

  await ctrl.disconnect();
}

async function testBufferedJobRejectsUtf8OversizedLineBeforeStart(): Promise<void> {
  console.log('\n=== GRBL byte accounting: buffered job ===\n');
  const { ctrl, port } = await connectController();
  const line = oversizedUtf8Line();

  let rejected = false;
  try {
    await ctrl.sendJob(['G21', line, 'M2']);
  } catch (err: unknown) {
    rejected = /127 bytes/.test(err instanceof Error ? err.message : String(err));
  }

  assert(rejected, 'buffered job rejects encoded-overlong line before streaming');
  assert(!ctrl.isJobRunning, 'buffered job never enters running state after byte-limit rejection');
  assert(!port.received.includes(line), 'encoded-overlong buffered job line is not written to serial');

  await ctrl.disconnect();
}

async function testStreamJobRejectsUtf8OversizedLineBeforeStart(): Promise<void> {
  console.log('\n=== GRBL byte accounting: stream job ===\n');
  const { ctrl, port } = await connectController();
  const line = oversizedUtf8Line();
  const output: ControllerOutput = {
    kind: 'gcode-stream',
    spool: oneLineSpool(line),
    dialect: 'grbl',
  };

  let rejected = false;
  try {
    await ctrl.executeJob(output, {
      ticketId: 'byte-accounting',
      sceneHash: 'scene',
      profileHash: 'profile',
      outputHash: 'output',
    });
  } catch (err: unknown) {
    rejected = /127 bytes/.test(err instanceof Error ? err.message : String(err));
  }

  assert(rejected, 'spool-backed job rejects encoded-overlong line during pre-stream validation');
  assert(!ctrl.isJobRunning, 'spool-backed job never enters running state after byte-limit rejection');
  assert(!port.received.includes(line), 'encoded-overlong stream job line is not written to serial');

  await ctrl.disconnect();
}

function byteBudgetLine(id: number): string {
  const line = `G1 X${id} Y0 F100 ; ${'A'.repeat(42)}`;
  const bytes = new TextEncoder().encode(`${line}\n`).byteLength;
  assert(bytes > 50 && bytes < 64, `fixture line ${id} costs ${bytes} bytes`);
  return line;
}

async function testReportedSmallRxBufferLimitsSpoolStreamingWindow(): Promise<void> {
  console.log('\n=== GRBL byte accounting: reported RX buffer stream window ===\n');
  const { ctrl, port } = await connectControllerWithReportedRxBuffer(64);

  const lines = [byteBudgetLine(21), byteBudgetLine(22), byteBudgetLine(23)];
  const output: ControllerOutput = {
    kind: 'gcode-stream',
    spool: lineSpool('small-rx-reported-budget', lines),
    dialect: 'grbl',
  };

  await ctrl.executeJob(output, {
    ticketId: 'small-rx-reported-budget',
    sceneHash: 'scene',
    profileHash: 'profile',
    outputHash: 'output',
  });
  await flush(20);

  const sentBeforeAck = port.received.filter(line => lines.includes(line));
  assert(
    sentBeforeAck.length === 1,
    `only one ~60-byte stream line fits in reported 64-byte RX buffer; got ${sentBeforeAck.length}`,
  );
  assert(!sentBeforeAck.includes(lines[1]), 'second stream line waits for an ok under the smaller reported RX budget');

  port.injectResponse('ok');
  await flush(20);

  const sentAfterAck = port.received.filter(line => lines.includes(line));
  assert(
    sentAfterAck.length === 2,
    `one ok frees the reported RX budget for exactly one more line; got ${sentAfterAck.length}`,
  );
  assert(sentAfterAck.includes(lines[1]), 'second stream line sends after one ok releases reported RX budget');
  assert(!sentAfterAck.includes(lines[2]), 'third stream line still waits for another ok under reported RX budget');

  await ctrl.disconnect();
}

async function testStreamingRespectsActiveRxByteBudget(): Promise<void> {
  console.log('\n=== GRBL byte accounting: active RX budget ===\n');
  const port = new MockSerialPort(line => {
    if (line === '$I') return ['[VER:1.1h.20250101:LaserForge]', '[OPT:V,15,128]', 'ok'];
    if (line === '$$') return ['$10=0', '$30=1000', '$31=0', '$32=1', 'ok'];
    if (line === '$#') return ['[G54:0.000,0.000,0.000]', 'ok'];
    return [];
  });
  const ctrl = new GrblController();
  port.open();
  await ctrl.connect(port);
  await flush(50);
  port.nextStatusQueryResponse = null;

  const lines = [byteBudgetLine(1), byteBudgetLine(2), byteBudgetLine(3)];
  await ctrl.sendJob(lines);
  await flush(20);

  const sentBeforeAck = port.received.filter(line => lines.includes(line));
  assert(
    sentBeforeAck.length === 2,
    `only two ~60-byte lines fit before ack; got ${sentBeforeAck.length}`,
  );
  assert(!sentBeforeAck.includes(lines[2]), 'third line waits for an ok to free RX buffer space');

  port.injectResponse('ok');
  await flush(20);

  const sentAfterOneAck = port.received.filter(line => lines.includes(line));
  assert(sentAfterOneAck.includes(lines[2]), 'one ok frees byte budget and allows the third line');
  assert(sentAfterOneAck.length === 3, `exactly three job lines sent after one ack; got ${sentAfterOneAck.length}`);

  await ctrl.disconnect();
}

async function testRealtimePauseBypassesFullBufferedQueue(): Promise<void> {
  console.log('\n=== GRBL byte accounting: realtime pause bypasses full queue ===\n');
  const port = new MockSerialPort(line => {
    if (line === '$I') return ['[VER:1.1h.20250101:LaserForge]', '[OPT:V,15,128]', 'ok'];
    if (line === '$$') return ['$10=0', '$30=1000', '$31=0', '$32=1', 'ok'];
    if (line === '$#') return ['[G54:0.000,0.000,0.000]', 'ok'];
    return [];
  });
  const ctrl = new GrblController();
  port.open();
  await ctrl.connect(port);
  await flush(50);
  port.nextStatusQueryResponse = null;

  const lines = [byteBudgetLine(10), byteBudgetLine(11), byteBudgetLine(12)];
  await ctrl.sendJob(lines);
  await flush(20);

  const sentBeforePause = port.received.filter(line => lines.includes(line));
  assert(sentBeforePause.length === 2, 'precondition: active RX budget is full before pause');
  assert(!sentBeforePause.includes(lines[2]), 'precondition: third line is waiting behind the full RX budget');

  await ctrl.pause();
  await flush(20);

  assert(port.realtimeBytes.includes(0x21), 'pause sends realtime feed-hold even while RX budget is full');
  assert(
    port.received.some(line => /^M5\s*S0$/i.test(line.trim())),
    'pause sends critical M5 S0 without waiting for queued job lines to drain',
  );
  const sentAfterPause = port.received.filter(line => lines.includes(line));
  assert(!sentAfterPause.includes(lines[2]), 'pause does not drain another job line while held');

  await ctrl.disconnect();
}

void (async () => {
  await testManualCommandRejectsUtf8OversizedLine();
  await testReportedSmallRxBufferRejectsOverlongManualCommand();
  await testBufferedJobRejectsUtf8OversizedLineBeforeStart();
  await testStreamJobRejectsUtf8OversizedLineBeforeStart();
  await testReportedSmallRxBufferLimitsSpoolStreamingWindow();
  await testStreamingRespectsActiveRxByteBudget();
  await testRealtimePauseBypassesFullBufferedQueue();

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
