/**
 * T2-31: SerialPortLike.close() returns Promise<void>.
 *
 * Pre-T2-31 the interface declared `close(): void` and the WebSerialPort
 * implementation set `isOpen = false` synchronously then started
 * `port.close().then(...)` un-awaited. A caller that called close() and
 * immediately reconnected could race the still-closing handle, hitting
 * a "port busy" error from the browser permission system.
 *
 * Post-T2-31 close() returns a promise that resolves after the browser-
 * level close (and best-effort `forget()`) actually completes.
 * `isOpen` still flips synchronously at entry so existing
 * `if (!port.isOpen)` guards remain back-compat.
 *
 * Run: npx tsx tests/serial-port-close-async.test.ts
 */
import { MockSerialPort, type SerialPortLike } from '../src/communication/SerialPort';

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

console.log('\n=== T2-31 SerialPortLike.close() async ===\n');

async function run(): Promise<void> {

// ── 1. Interface contract: close() returns a Promise (compile-time check
//      via the SerialPortLike type; runtime check via .then) ──
{
  const p = new MockSerialPort();
  p.open();
  const result = p.close();
  assert(result instanceof Promise,
    'close() returns a Promise (T2-31: was void pre-fix)');
  await result;
  assert(!p.isOpen, 'isOpen is false after awaited close');
}

// ── 2. isOpen flips synchronously at close-entry (back-compat with
//      `if (!port.isOpen)` guards that were valid pre-T2-31) ──
{
  const p = new MockSerialPort();
  p.open();
  assert(p.isOpen, 'open() makes isOpen true');
  // Don't await — we want to verify the synchronous flip.
  const closePromise = p.close();
  assert(!p.isOpen,
    'isOpen is false synchronously at close-entry (back-compat with !isOpen guards)');
  await closePromise;
}

// ── 3. close() resolves after the close callback fires ──
{
  const p = new MockSerialPort();
  let closeCallbackFired = false;
  p.onClose(() => { closeCallbackFired = true; });
  p.open();
  await p.close();
  assert(closeCallbackFired,
    'onClose callback has fired by the time close() promise resolves');
}

// ── 4. Idempotent close — calling close() twice doesn't throw ──
{
  const p = new MockSerialPort();
  p.open();
  await p.close();
  let threw = false;
  try {
    await p.close();
  } catch {
    threw = true;
  }
  assert(!threw, 'second close() does not throw (idempotent)');
}

// ── 5. Source-level pin: T2-31 marker + interface change ──
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));

  const ifSrc = fs.readFileSync(
    path.resolve(here, '../src/communication/SerialPort.ts'),
    'utf-8',
  );
  assert(/T2-31/.test(ifSrc), 'T2-31 marker in SerialPort.ts');
  assert(/close\(\): Promise<void>;/.test(ifSrc),
    'SerialPortLike.close() interface declares Promise<void> return');
  assert(/async close\(\): Promise<void>/.test(ifSrc),
    'MockSerialPort.close is now async');

  const wsSrc = fs.readFileSync(
    path.resolve(here, '../src/communication/WebSerialPort.ts'),
    'utf-8',
  );
  assert(/T2-31/.test(wsSrc), 'T2-31 marker in WebSerialPort.ts');
  assert(/async close\(\): Promise<void>/.test(wsSrc),
    'WebSerialPort.close is now async');
  // The previous un-awaited `port.close().then(...)` chain is gone.
  assert(!/port\.close\(\)\s*\n\s*\.then\(/.test(wsSrc),
    'OLD un-awaited port.close().then(...) chain removed');
  assert(/await port\.close\(\)/.test(wsSrc),
    'browser port.close() is awaited inside the implementation');

  const ctrlSrc = fs.readFileSync(
    path.resolve(here, '../src/controllers/grbl/GrblController.ts'),
    'utf-8',
  );
  assert(/T2-31/.test(ctrlSrc), 'T2-31 marker in GrblController.ts');
  assert(/await this\._port\.close\(\)/.test(ctrlSrc),
    'GrblController.disconnect awaits port.close()');
  assert(/void this\._port\.close\(\)\.catch\(\(\) => \{/.test(ctrlSrc),
    'GrblController connect-timeout uses void + .catch (cannot await inside setTimeout)');

  const svcSrc = fs.readFileSync(
    path.resolve(here, '../src/app/MachineService.ts'),
    'utf-8',
  );
  assert(/T2-31/.test(svcSrc), 'T2-31 marker in MachineService.ts');
  assert(/await ws\.close\(\)/.test(svcSrc),
    'MachineService connectRealLaser catch awaits ws.close()');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
