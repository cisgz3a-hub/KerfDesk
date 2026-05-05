/**
 * T2-33: WebSerialPort.requestAndOpen unwinds acquired resources on
 * partial failure. Pre-T2-33 a failure between `port.open()` and the
 * end of `getReader()` left the port half-open with no cleanup —
 * subsequent reconnects met "port busy" because the previous attempt
 * still held writer/reader locks and the port handle. The fix tracks
 * each acquisition in a local var, commits to instance fields only
 * after ALL succeed, and on catch unwinds in reverse.
 *
 * Builds on T2-31 (async close infrastructure) and pairs with T1-50
 * Part B (AbortSignal acceptance).
 *
 * Run: npx tsx tests/web-serial-partial-open-cleanup.test.ts
 */
import { WebSerialPort } from '../src/communication/WebSerialPort';

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
  write(_d: Uint8Array): Promise<void>;
}

interface MockPortStub {
  openCalled: number;
  closeCalled: number;
  openShouldThrow?: Error;
  writableShouldBeNull?: boolean;
  readableShouldBeNull?: boolean;
  writerThrowsOnAcquire?: boolean;
  readerThrowsOnAcquire?: boolean;
  reader: MockReader;
  writer: MockWriter;
  open(_opts: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readonly writable: { getWriter(): MockWriter } | null;
  readonly readable: { getReader(): MockReader } | null;
}

function makeMockPort(opts: Partial<MockPortStub> = {}): MockPortStub {
  const reader: MockReader = {
    cancelCalled: 0,
    releaseLockCalled: 0,
    async cancel() { this.cancelCalled++; },
    releaseLock() { this.releaseLockCalled++; },
    async read() {
      // Simulate an indefinite read that we don't care about for these tests.
      return new Promise(() => { /* never resolves */ });
    },
  };
  const writer: MockWriter = {
    releaseLockCalled: 0,
    releaseLock() { this.releaseLockCalled++; },
    async write(_d: Uint8Array) { /* ok */ },
  };
  const port: MockPortStub = {
    openCalled: 0,
    closeCalled: 0,
    openShouldThrow: opts.openShouldThrow,
    writableShouldBeNull: opts.writableShouldBeNull ?? false,
    readableShouldBeNull: opts.readableShouldBeNull ?? false,
    writerThrowsOnAcquire: opts.writerThrowsOnAcquire ?? false,
    readerThrowsOnAcquire: opts.readerThrowsOnAcquire ?? false,
    reader,
    writer,
    async open(_o: { baudRate: number }) {
      this.openCalled++;
      if (this.openShouldThrow) throw this.openShouldThrow;
    },
    async close() { this.closeCalled++; },
    get writable() {
      if (this.writableShouldBeNull) return null;
      const w = this.writer;
      const t = this;
      return {
        getWriter() {
          if (t.writerThrowsOnAcquire) throw new Error('writer-acquire-failed');
          return w;
        },
      };
    },
    get readable() {
      if (this.readableShouldBeNull) return null;
      const r = this.reader;
      const t = this;
      return {
        getReader() {
          if (t.readerThrowsOnAcquire) throw new Error('reader-acquire-failed');
          return r;
        },
      };
    },
  };
  return port;
}

function installNavigatorSerial(port: MockPortStub): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      serial: {
        async requestPort() { return port; },
      },
    },
    configurable: true,
    writable: true,
  });
}

console.log('\n=== T2-33 WebSerialPort partial-open cleanup ===\n');

void (async () => {

// 1. Happy path: all acquisitions succeed → port is open, no cleanup
{
  const port = makeMockPort();
  installNavigatorSerial(port);
  const ws = new WebSerialPort();
  await ws.requestAndOpen(115200);
  assert(ws.isOpen === true, 'happy path: isOpen = true after success');
  assert(port.openCalled === 1, `happy path: port.open() called once (got ${port.openCalled})`);
  assert(port.closeCalled === 0,
    `happy path: port.close() NOT called on success (got ${port.closeCalled})`);
  assert(port.reader.cancelCalled === 0,
    `happy path: reader.cancel() NOT called (got ${port.reader.cancelCalled})`);
  // Cleanup
  await ws.close();
}

// 2. port.open() throws → no cleanup needed (open failed before any
//    locks were acquired); isOpen stays false; close() not called.
{
  const port = makeMockPort({ openShouldThrow: new Error('open-failed') });
  installNavigatorSerial(port);
  const ws = new WebSerialPort();
  let threw = false;
  let errMsg = '';
  try {
    await ws.requestAndOpen(115200);
  } catch (e) {
    threw = true;
    errMsg = e instanceof Error ? e.message : String(e);
  }
  assert(threw, 'open-fail: requestAndOpen rejects');
  assert(/open-failed/.test(errMsg), `open-fail: error message preserves cause (got "${errMsg}")`);
  assert(ws.isOpen === false, 'open-fail: isOpen = false');
  assert(port.openCalled === 1, 'open-fail: port.open() attempted once');
  assert(port.closeCalled === 0,
    `open-fail: port.close() NOT called (open never succeeded; got ${port.closeCalled})`);
}

// 3. writer acquisition fails → port.open() succeeded so cleanup
//    must close it; reader and writer were not acquired, so no
//    lock release calls.
{
  const port = makeMockPort({ writerThrowsOnAcquire: true });
  installNavigatorSerial(port);
  const ws = new WebSerialPort();
  let threw = false;
  let errMsg = '';
  try {
    await ws.requestAndOpen(115200);
  } catch (e) {
    threw = true;
    errMsg = e instanceof Error ? e.message : String(e);
  }
  assert(threw, 'writer-fail: requestAndOpen rejects');
  assert(/writer-acquire-failed/.test(errMsg),
    `writer-fail: error message preserves cause (got "${errMsg}")`);
  assert(ws.isOpen === false, 'writer-fail: isOpen = false');
  assert(port.closeCalled === 1,
    `writer-fail: port.close() called for cleanup (got ${port.closeCalled})`);
  assert(port.writer.releaseLockCalled === 0,
    'writer-fail: writer.releaseLock NOT called (writer never acquired)');
  assert(port.reader.releaseLockCalled === 0,
    'writer-fail: reader.releaseLock NOT called (reader never acquired)');
}

// 4. reader acquisition fails → writer was acquired; cleanup must
//    release writer + close port.
{
  const port = makeMockPort({ readerThrowsOnAcquire: true });
  installNavigatorSerial(port);
  const ws = new WebSerialPort();
  let threw = false;
  try { await ws.requestAndOpen(115200); } catch { threw = true; }
  assert(threw, 'reader-fail: requestAndOpen rejects');
  assert(ws.isOpen === false, 'reader-fail: isOpen = false');
  assert(port.writer.releaseLockCalled === 1,
    `reader-fail: writer.releaseLock() called (got ${port.writer.releaseLockCalled})`);
  assert(port.closeCalled === 1,
    `reader-fail: port.close() called (got ${port.closeCalled})`);
  assert(port.reader.cancelCalled === 0,
    'reader-fail: reader.cancel NOT called (reader never acquired)');
}

// 5. writable === null (browser quirk) → throws "writer lock" error,
//    port.close() called.
{
  const port = makeMockPort({ writableShouldBeNull: true });
  installNavigatorSerial(port);
  const ws = new WebSerialPort();
  let errMsg = '';
  try { await ws.requestAndOpen(115200); } catch (e) {
    errMsg = e instanceof Error ? e.message : String(e);
  }
  assert(/writer lock/i.test(errMsg),
    `null-writable: error mentions writer lock (got "${errMsg}")`);
  assert(port.closeCalled === 1,
    `null-writable: port.close() called for cleanup (got ${port.closeCalled})`);
}

// 6. readable === null after writer succeeds → cleanup releases
//    writer + closes port.
{
  const port = makeMockPort({ readableShouldBeNull: true });
  installNavigatorSerial(port);
  const ws = new WebSerialPort();
  let errMsg = '';
  try { await ws.requestAndOpen(115200); } catch (e) {
    errMsg = e instanceof Error ? e.message : String(e);
  }
  assert(/reader lock/i.test(errMsg),
    `null-readable: error mentions reader lock (got "${errMsg}")`);
  assert(port.writer.releaseLockCalled === 1,
    'null-readable: writer.releaseLock() called');
  assert(port.closeCalled === 1, 'null-readable: port.close() called');
}

// 7. AbortSignal aborted before requestPort → throws aborted-by-user
{
  const port = makeMockPort();
  installNavigatorSerial(port);
  const ws = new WebSerialPort();
  const ac = new AbortController();
  ac.abort();
  let errMsg = '';
  try { await ws.requestAndOpen(115200, ac.signal); } catch (e) {
    errMsg = e instanceof Error ? e.message : String(e);
  }
  assert(/aborted by user/i.test(errMsg),
    `pre-abort: error message reads "aborted by user" (got "${errMsg}")`);
  assert(port.openCalled === 0,
    `pre-abort: port.open() NEVER called (got ${port.openCalled})`);
  assert(ws.isOpen === false, 'pre-abort: isOpen = false');
}

// 8. AbortSignal aborted between port.open() and getWriter() → cleanup
//    closes the now-opened port.
{
  const port = makeMockPort();
  installNavigatorSerial(port);
  const ws = new WebSerialPort();
  const ac = new AbortController();
  // Wrap port.open to abort right after it resolves
  const origOpen = port.open.bind(port);
  port.open = async (opts: { baudRate: number }) => {
    await origOpen(opts);
    ac.abort();
  };
  let errMsg = '';
  try { await ws.requestAndOpen(115200, ac.signal); } catch (e) {
    errMsg = e instanceof Error ? e.message : String(e);
  }
  assert(/aborted by user/i.test(errMsg),
    `mid-abort: error message reads "aborted by user" (got "${errMsg}")`);
  assert(port.openCalled === 1, 'mid-abort: port.open() did fire once');
  assert(port.closeCalled === 1,
    `mid-abort: port.close() called for cleanup (got ${port.closeCalled})`);
  assert(ws.isOpen === false, 'mid-abort: isOpen = false');
}

// 9. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/communication/WebSerialPort.ts'), 'utf-8');
  assert(/T2-33: partial-open cleanup/.test(src),
    'T2-33 marker in WebSerialPort.ts');
  assert(/let port: SerialPort \| null = null;/.test(src),
    'requestAndOpen tracks port in a local variable');
  assert(/let writer: WritableStreamDefaultWriter \| null = null;/.test(src),
    'requestAndOpen tracks writer in a local variable');
  assert(/let reader: ReadableStreamDefaultReader \| null = null;/.test(src),
    'requestAndOpen tracks reader in a local variable');
  assert(/signal\?\.throwIfAborted\(\)/.test(src),
    'AbortSignal acceptance via throwIfAborted');
  assert(/portOpened && port/.test(src),
    'cleanup conditions on portOpened flag');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
