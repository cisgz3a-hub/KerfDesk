/**
 * Phase 4 audit F-008: a gcode-stream refill failure after bytes have
 * reached the controller must take the same safety path as an active-job
 * GRBL error: command laser-off, stop streaming, and require inspection.
 *
 * Run: npx tsx tests/grbl-stream-fill-error-safety-off.test.ts
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

function failingRefillSpool(): SpoolHandle {
  let openCount = 0;
  return {
    id: 'stream-fill-fails-after-first-window',
    contentHash: 'audit-f008',
    lineCount: 2201,
    byteCount: 2201 * 8,
    open: () => {
      openCount++;
      const shouldFailOnRefill = openCount >= 2;
      return (async function* (): AsyncGenerator<GcodeChunk, void, void> {
        yield {
          lines: Array.from({ length: 2200 }, (_, i) => `G1 X${i % 20} Y0`),
          cumulativeLineCount: 2200,
          isLast: false,
        };
        if (shouldFailOnRefill) {
          throw new Error('simulated spool refill failure');
        }
        yield {
          lines: ['M5'],
          cumulativeLineCount: 2201,
          isLast: true,
        };
      })();
    },
  };
}

async function connectController(): Promise<{ ctrl: GrblController; port: MockSerialPort }> {
  const port = new MockSerialPort();
  port.open();
  const ctrl = new GrblController();
  await ctrl.connect(port);
  await flush(50);
  port.nextStatusQueryResponse = null;
  return { ctrl, port };
}

void (async () => {
  console.log('\n=== F-008 stream refill error sends safety-off ===\n');

  const { ctrl, port } = await connectController();
  const output: ControllerOutput = {
    kind: 'gcode-stream',
    spool: failingRefillSpool(),
    dialect: 'grbl',
  };

  await ctrl.executeJob(output, {
    ticketId: 'audit-f008',
    sceneHash: 'scene',
    profileHash: 'profile',
    outputHash: 'output',
  });
  assert(ctrl.isJobRunning === true, 'precondition: stream job started');

  while (ctrl.isJobRunning && port.received.filter(line => /^G1 X/.test(line)).length < 2200) {
    port.injectResponse('ok');
    await flush(1);
  }
  await flush(80);

  assert(
    port.received.some(line => line.trim() === 'M5 S0'),
    'stream refill failure commands M5 S0 via safetyOff',
  );
  assert(ctrl.isJobRunning === false, 'stream refill failure stops controller job state');
  assert(
    ctrl.state.status === 'faulted_requires_inspection',
    `stream refill failure requires inspection (got ${ctrl.state.status})`,
  );

  await ctrl.disconnect();

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
