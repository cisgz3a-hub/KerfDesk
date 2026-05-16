/**
 * Audit F-003 / T2-36-followup: concrete serial transports must use
 * subscription sets, not single-slot callbacks that overwrite earlier
 * observers.
 *
 * Run: npx tsx tests/serial-port-subscription-wiring.test.ts
 */
import { MockSerialPort } from '../src/communication/SerialPort';
import { WebSerialPort } from '../src/communication/WebSerialPort';
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

function flushMicrotasks(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

console.log('\n=== Serial port subscription wiring ===\n');

void (async () => {
  {
    const port = new MockSerialPort();
    const a: string[] = [];
    const b: string[] = [];
    const unsubA = port.onData(line => a.push(line));
    port.onData(line => b.push(line));

    await port.open();
    port.injectResponse('first');
    await flushMicrotasks();

    assert(a.includes('first'), 'MockSerialPort first data subscriber receives line');
    assert(b.includes('first'), 'MockSerialPort second data subscriber receives line');

    unsubA();
    port.injectResponse('second');
    await flushMicrotasks();

    assert(!a.includes('second'), 'MockSerialPort unsubscribe removes only that data subscriber');
    assert(b.includes('second'), 'MockSerialPort remaining data subscriber still receives line');
  }

  {
    const port = new MockSerialPort();
    let errorsA = 0;
    let errorsB = 0;
    let closesA = 0;
    let closesB = 0;
    port.onError(() => { errorsA++; });
    port.onError(() => { errorsB++; });
    port.onClose(() => { closesA++; });
    port.onClose(() => { closesB++; });

    port.simulateError('boom');
    await port.close();

    assert(errorsA === 1 && errorsB === 1, `MockSerialPort broadcasts errors to both subscribers (${errorsA}/${errorsB})`);
    assert(closesA === 1 && closesB === 1, `MockSerialPort broadcasts close to both subscribers (${closesA}/${closesB})`);
  }

  {
    const fake = new FakeNavigatorSerial();
    fake.installAsGlobal();
    try {
      const browserPort = fake.preparePort();
      const port = new WebSerialPort();
      const a: string[] = [];
      const b: string[] = [];
      const unsubA = port.onData(line => a.push(line));
      port.onData(line => b.push(line));

      await port.requestAndOpen(115200);
      browserPort.scheduleRead(encode('first\r\n'), 0);
      await flushMicrotasks();

      assert(a.includes('first'), 'WebSerialPort first data subscriber receives line');
      assert(b.includes('first'), 'WebSerialPort second data subscriber receives line');

      unsubA();
      browserPort.scheduleRead(encode('second\r\n'), 0);
      await flushMicrotasks();

      assert(!a.includes('second'), 'WebSerialPort unsubscribe removes only that data subscriber');
      assert(b.includes('second'), 'WebSerialPort remaining data subscriber still receives line');
      await port.close();
    } finally {
      fake.removeFromGlobal();
    }
  }

  {
    const fake = new FakeNavigatorSerial();
    fake.installAsGlobal();
    try {
      const browserPort = fake.preparePort();
      const port = new WebSerialPort();
      let errorsA = 0;
      let errorsB = 0;
      let closesA = 0;
      let closesB = 0;
      port.onError(() => { errorsA++; });
      port.onError(() => { errorsB++; });
      port.onClose(() => { closesA++; });
      port.onClose(() => { closesB++; });

      await port.requestAndOpen(115200);
      browserPort.scheduleReaderError('reader fault', 0);
      await flushMicrotasks();
      await flushMicrotasks();

      assert(errorsA === 1 && errorsB === 1, `WebSerialPort broadcasts read errors to both subscribers (${errorsA}/${errorsB})`);
      assert(closesA === 1 && closesB === 1, `WebSerialPort broadcasts read-loop close to both subscribers (${closesA}/${closesB})`);
    } finally {
      fake.removeFromGlobal();
    }
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
