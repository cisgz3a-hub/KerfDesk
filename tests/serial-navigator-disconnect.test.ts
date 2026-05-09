/**
 * T3-49: WebSerial navigator-level disconnect events should trip the
 * active WebSerialPort close path immediately. Read-loop failures and
 * write failures still exist as fallback signals, but the browser's
 * `navigator.serial` disconnect event is the fast physical-unplug path.
 *
 * Run: npx tsx tests/serial-navigator-disconnect.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSerialPort } from '../src/communication/WebSerialPort';

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

interface MockReader {
  cancelCalled: number;
  releaseLockCalled: number;
  cancel(): Promise<void>;
  releaseLock(): void;
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
}

interface MockWriter {
  releaseLockCalled: number;
  releaseLock(): void;
  write(_data: Uint8Array): Promise<void>;
}

interface MockPort {
  openCalled: number;
  closeCalled: number;
  reader: MockReader;
  writer: MockWriter;
  open(_opts: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readonly readable: { getReader(): MockReader } | null;
  readonly writable: { getWriter(): MockWriter } | null;
}

class MockSerialBus {
  requestPortCalls = 0;
  addCalls = 0;
  removeCalls = 0;
  private readonly listeners = new Set<(event: { port?: MockPort }) => void>();

  constructor(private readonly port: MockPort) {}

  async requestPort(): Promise<MockPort> {
    this.requestPortCalls++;
    return this.port;
  }

  async getPorts(): Promise<MockPort[]> {
    return [this.port];
  }

  addEventListener(type: string, callback: (event: { port?: MockPort }) => void): void {
    if (type !== 'disconnect') return;
    this.addCalls++;
    this.listeners.add(callback);
  }

  removeEventListener(type: string, callback: (event: { port?: MockPort }) => void): void {
    if (type !== 'disconnect') return;
    this.removeCalls++;
    this.listeners.delete(callback);
  }

  dispatchDisconnect(port?: MockPort): void {
    for (const listener of Array.from(this.listeners)) {
      listener({ port });
    }
  }
}

function makeMockPort(): MockPort {
  const reader: MockReader = {
    cancelCalled: 0,
    releaseLockCalled: 0,
    async cancel() { this.cancelCalled++; },
    releaseLock() { this.releaseLockCalled++; },
    async read() {
      return new Promise(() => { /* stay pending; navigator event drives this test */ });
    },
  };
  const writer: MockWriter = {
    releaseLockCalled: 0,
    releaseLock() { this.releaseLockCalled++; },
    async write(_data: Uint8Array) { /* ok */ },
  };
  return {
    openCalled: 0,
    closeCalled: 0,
    reader,
    writer,
    async open(_opts: { baudRate: number }) { this.openCalled++; },
    async close() { this.closeCalled++; },
    get readable() {
      return { getReader: () => reader };
    },
    get writable() {
      return { getWriter: () => writer };
    },
  };
}

function installNavigatorSerial(bus: MockSerialBus): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: { serial: bus },
    configurable: true,
    writable: true,
  });
}

console.log('\n=== T3-49 navigator.serial disconnect handling ===\n');

void (async () => {
  {
    const activePort = makeMockPort();
    const otherPort = makeMockPort();
    const bus = new MockSerialBus(activePort);
    installNavigatorSerial(bus);
    const ws = new WebSerialPort();
    let closeEvents = 0;
    ws.onClose(() => { closeEvents++; });

    await ws.requestAndOpen(115200);

    assert(ws.isOpen === true, 'port is open after requestAndOpen');
    assert(bus.addCalls === 1, 'connect registers one navigator disconnect listener');

    bus.dispatchDisconnect(otherPort);
    assert(ws.isOpen === true, 'disconnect for a different port is ignored');
    assert(closeEvents === 0, 'different-port disconnect does not emit close');

    bus.dispatchDisconnect(activePort);
    assert(ws.isOpen === false, 'active-port disconnect marks WebSerialPort closed');
    assert(closeEvents === 1, 'active-port disconnect emits exactly one close event');
    assert(bus.removeCalls === 1, 'active-port disconnect removes the navigator listener');

    bus.dispatchDisconnect(activePort);
    assert(closeEvents === 1, 'repeated disconnect event is idempotent after listener removal');
  }

  {
    const activePort = makeMockPort();
    const bus = new MockSerialBus(activePort);
    installNavigatorSerial(bus);
    const ws = new WebSerialPort();
    let closeEvents = 0;
    ws.onClose(() => { closeEvents++; });

    await ws.requestAndOpen(115200);
    await ws.close();

    assert(closeEvents === 1, 'normal close still emits close once');
    assert(bus.removeCalls === 1, 'normal close removes the navigator disconnect listener');

    bus.dispatchDisconnect(activePort);
    assert(closeEvents === 1, 'disconnect after normal close does not emit another close');
  }

  {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(here, '../src/communication/WebSerialPort.ts'), 'utf-8');
    const types = readFileSync(resolve(here, '../src/types/web-serial.d.ts'), 'utf-8');
    assert(/T3-49/.test(source), 'WebSerialPort source carries T3-49 marker');
    assert(/addEventListener\('disconnect'/.test(source), 'WebSerialPort listens for navigator disconnect');
    assert(/eventPort !== this\._port/.test(source), 'navigator disconnect ignores non-active ports');
    assert(/_handleNavigatorDisconnect/.test(source), 'navigator disconnect has a dedicated handler');
    assert(/addEventListener\(type: 'disconnect'/.test(types), 'WebSerial typings include disconnect listener');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
})();
