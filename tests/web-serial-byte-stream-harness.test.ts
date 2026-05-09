/**
 * T3-63: fake WebSerial byte-stream harness with chunking realism.
 *
 * The existing serial tests mostly use MockSerialPort and bypass the real
 * WebSerialPort read loop. This test pins a reusable fake navigator.serial
 * transport so future controller tests can feed arbitrary byte chunks through
 * the browser ReadableStream/WritableStream path.
 *
 * Run: npx tsx tests/web-serial-byte-stream-harness.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSerialPort } from '../src/communication/WebSerialPort';
import { GrblSimulator } from './simulators/GrblSimulator';
import { FakeNavigatorSerial } from './harness/fakeWebSerial';

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

function waitForMicrotasks(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

console.log('\n=== T3-63 fake WebSerial byte-stream harness ===\n');

void (async () => {
  const fake = new FakeNavigatorSerial();
  fake.installAsGlobal();

  try {
    {
      const port = fake.preparePort({ vendorId: 0x1a86, productId: 0x7523 });
      const ws = new WebSerialPort();
      const lines: string[] = [];
      ws.onData(line => lines.push(line));

      await ws.requestAndOpen(115200);
      port.scheduleRead(encode('<Idle|MPos:'), 0);
      port.scheduleRead(encode('1.000,2.000,0.000|FS:0,0>\r\n'), 0);
      await waitForMicrotasks();

      assert(lines.length === 1, `split status chunks produce one line (got ${lines.length})`);
      assert(
        lines[0] === '<Idle|MPos:1.000,2.000,0.000|FS:0,0>',
        `split status line is reassembled exactly (got "${lines[0]}")`,
      );
      await ws.close();
    }

    {
      const port = fake.preparePort();
      const ws = new WebSerialPort();
      const lines: string[] = [];
      ws.onData(line => lines.push(line));

      await ws.requestAndOpen(115200);
      port.scheduleRead(encode('ok\r'), 0);
      port.scheduleRead(encode('\n'), 0);
      await waitForMicrotasks();

      assert(lines.length === 1, `ok CR/LF split across reads produces one line (got ${lines.length})`);
      assert(lines[0] === 'ok', `ok line trims CR/LF (got "${lines[0]}")`);
      await ws.close();
    }

    {
      const port = fake.preparePort();
      const ws = new WebSerialPort();
      const lines: string[] = [];
      ws.onData(line => lines.push(line));

      await ws.requestAndOpen(115200);
      port.scheduleRead(encode('<Idle|MPos:0.000,0.000,0.000|FS:0,0>\r\nok\r\n'), 0);
      await waitForMicrotasks();

      assert(lines.length === 2, `multiple lines in one read produce two events (got ${lines.length})`);
      assert(lines[0]?.startsWith('<Idle|MPos:'), `first line is status report (got "${lines[0]}")`);
      assert(lines[1] === 'ok', `second line is ok (got "${lines[1]}")`);
      await ws.close();
    }

    {
      const port = fake.preparePort();
      const ws = new WebSerialPort();
      let closeEvents = 0;
      ws.onClose(() => { closeEvents++; });

      await ws.requestAndOpen(115200);
      port.scheduleReaderDone(0);
      await waitForMicrotasks();
      await waitForMicrotasks();

      assert(ws.isOpen === false, 'reader done marks WebSerialPort closed');
      assert(closeEvents === 1, `reader done emits close exactly once (got ${closeEvents})`);
      await ws.close();
      assert(closeEvents === 2, 'explicit close after reader done is a separate caller-owned close event');
    }

    {
      const port = fake.preparePort();
      const ws = new WebSerialPort();
      let closeEvents = 0;
      let errorMessage = '';
      ws.onClose(() => { closeEvents++; });
      ws.onError(error => { errorMessage = error.message; });

      await ws.requestAndOpen(115200);
      port.scheduleReaderError('reader exploded', 0);
      await waitForMicrotasks();
      await waitForMicrotasks();

      assert(/Read error: reader exploded/.test(errorMessage),
        `reader rejection normalizes error message (got "${errorMessage}")`);
      assert(ws.isOpen === false, 'reader rejection marks WebSerialPort closed');
      assert(closeEvents === 1, `reader rejection emits close once (got ${closeEvents})`);
    }

    {
      const port = fake.preparePort();
      const ws = new WebSerialPort();
      let errorMessage = '';
      ws.onError(error => { errorMessage = error.message; });

      await ws.requestAndOpen(115200);
      port.rejectNextWrite('write blocked');
      ws.write('G0 X1\n');
      await waitForMicrotasks();

      assert(/write blocked/.test(errorMessage),
        `fire-and-forget write rejection reaches onError (got "${errorMessage}")`);
      await ws.close();
    }

    {
      const port = fake.preparePort();
      const ws = new WebSerialPort();
      await ws.requestAndOpen(115200);
      port.rejectNextWrite('critical write blocked');
      let criticalMessage = '';
      try {
        await ws.writeCritical('G0 X2\n');
      } catch (error) {
        criticalMessage = error instanceof Error ? error.message : String(error);
      }
      assert(/critical write blocked/.test(criticalMessage),
        `critical write rejection is thrown (got "${criticalMessage}")`);
      await ws.close();
    }

    {
      const simulator = new GrblSimulator();
      const port = fake.preparePort({ simulator });
      const ws = new WebSerialPort();
      const lines: string[] = [];
      ws.onData(line => lines.push(line));

      await ws.requestAndOpen(115200);
      await ws.writeCriticalLine('?');
      await waitForMicrotasks();

      assert(port.writesAsText().includes('?\n'), 'fake records browser writer bytes as text');
      assert(lines.some(line => line.startsWith('<Idle|MPos:')),
        `simulator-backed port emits GRBL status from written bytes (got ${lines.join(' | ')})`);
      await ws.close();
    }

    {
      fake.rejectNextRequestPort('user cancelled');
      const ws = new WebSerialPort();
      let message = '';
      try {
        await ws.requestAndOpen(115200);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      assert(/Failed to open serial port: user cancelled/.test(message),
        `requestPort rejection passes through WebSerialPort open error (got "${message}")`);
    }

    {
      const here = dirname(fileURLToPath(import.meta.url));
      const harnessSource = readFileSync(resolve(here, 'harness/fakeWebSerial.ts'), 'utf-8');
      assert(/class FakeNavigatorSerial/.test(harnessSource), 'harness exports FakeNavigatorSerial');
      assert(/class FakeSerialPort/.test(harnessSource), 'harness exports FakeSerialPort');
      assert(/installAsGlobal\(\)/.test(harnessSource), 'harness can install navigator.serial globally');
      assert(/scheduleRead/.test(harnessSource), 'harness exposes controlled read chunk scheduling');
      assert(/scheduleReaderError/.test(harnessSource), 'harness exposes reader error injection');
      assert(/rejectNextWrite/.test(harnessSource), 'harness exposes writer rejection injection');
      assert(/SimulatedControllerDevice/.test(harnessSource), 'harness can bridge to simulator-backed devices');
    }
  } finally {
    fake.removeFromGlobal();
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
})().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
