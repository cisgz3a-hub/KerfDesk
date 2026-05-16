/**
 * Audit F-002 / T2-34-followup: stale transport callbacks from a previous
 * connection must not affect a fresh GRBL session after reconnect.
 *
 * Run: npx tsx tests/grbl-connection-generation-guard.test.ts
 */
import { MockSerialPort } from '../src/communication/SerialPort';
import { GrblController } from '../src/controllers/grbl/GrblController';

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

function flushMicrotasks(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

async function openAndConnect(controller: GrblController, port: MockSerialPort): Promise<void> {
  await port.open();
  const connected = controller.connect(port);
  port.injectResponse("Grbl 1.1h ['$' for help]");
  await connected;
  await flushMicrotasks();
}

console.log('\n=== GRBL connection generation guard wiring ===\n');

void (async () => {
  {
    const controller = new GrblController({ allowHeadlessWcsAutoNormalize: true });
    const oldPort = new MockSerialPort();
    const freshPort = new MockSerialPort();

    await openAndConnect(controller, oldPort);
    await controller.disconnect();
    await openAndConnect(controller, freshPort);

    assert(controller.state.status !== 'disconnected', 'fresh connection is active before stale callback');

    oldPort.simulateError('old transport error after reconnect');
    await flushMicrotasks();

    assert(
      controller.state.status !== 'disconnected',
      `stale error from old port does not disconnect fresh session (status=${controller.state.status})`,
    );

    await controller.disconnect();
  }

  {
    const controller = new GrblController({ allowHeadlessWcsAutoNormalize: true });
    const oldPort = new MockSerialPort();
    const freshPort = new MockSerialPort();

    await openAndConnect(controller, oldPort);
    await controller.disconnect();
    await openAndConnect(controller, freshPort);

    oldPort.injectResponse('<Alarm|MPos:1.000,2.000,0.000|FS:0,0>');
    await flushMicrotasks();

    assert(
      controller.state.status !== 'alarm',
      `stale status line from old port does not mutate fresh session (status=${controller.state.status})`,
    );

    await controller.disconnect();
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
