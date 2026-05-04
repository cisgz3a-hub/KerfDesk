/**
 * T2-13: pin contracts on `tests/helpers/FaultInjectingSerialPort.ts`.
 *
 * Each fault mode is tested independently before any safety test in
 * dependent tickets (T1-22 follow-ups, T1-25, T1-28, T1-29) leans on it.
 *
 * Run: npx tsx tests/fault-injecting-serial-port.test.ts
 */
import { FaultInjectingSerialPort } from './helpers/FaultInjectingSerialPort';

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

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

console.log('\n=== T2-13 FaultInjectingSerialPort ===\n');

async function run(): Promise<void> {

// 1. Normal mode passes through to the underlying MockSerialPort
{
  const fp = new FaultInjectingSerialPort();
  fp.open();
  const lines: string[] = [];
  fp.onData((l) => lines.push(l));

  fp.write('G21');
  await sleep(20);

  assert(fp.received.includes('G21'), 'normal: write reaches mock.received');
  assert(lines.includes('ok'), 'normal: ok delivered to data callback');
  assert(fp.injectionLog.length === 0, 'normal: no fault entries logged');
}

// 2. drop-write: data is silently swallowed
{
  const fp = new FaultInjectingSerialPort();
  fp.open();
  const lines: string[] = [];
  fp.onData((l) => lines.push(l));

  fp.setFault({ kind: 'drop-write' });
  fp.write('G21');
  await sleep(20);

  assert(!fp.received.includes('G21'), 'drop-write: data does NOT reach mock.received');
  assert(!lines.includes('ok'), 'drop-write: no ok delivered');
  assert(fp.injectionLog.some((e) => e.kind === 'drop-write' && e.data === 'G21'),
    'drop-write: injectionLog records the drop');
}

// 2b. drop-write with matching: only matching lines drop
{
  const fp = new FaultInjectingSerialPort();
  fp.open();
  const lines: string[] = [];
  fp.onData((l) => lines.push(l));

  fp.setFault({ kind: 'drop-write', matching: /^M5/ });
  fp.write('G21');
  fp.write('M5');
  await sleep(20);

  assert(fp.received.includes('G21'), 'drop-write+match: non-matching G21 passes through');
  assert(!fp.received.includes('M5'), 'drop-write+match: matching M5 is dropped');
}

// 3. partial-write: only first N bytes delivered
{
  const fp = new FaultInjectingSerialPort();
  fp.open();
  fp.setFault({ kind: 'partial-write', bytesToWrite: 3 });
  fp.write('G1 X10 Y10');
  await sleep(20);

  assert(fp.received.includes('G1 '),
    `partial-write: mock received truncated 'G1 ' (got ${JSON.stringify(fp.received)})`);
  assert(fp.injectionLog.some((e) => e.kind === 'partial-write'),
    'partial-write: injectionLog has entry');
}

// 4. close-mid-write: writes truncated portion then closes the port
{
  const fp = new FaultInjectingSerialPort();
  fp.open();
  let closed = false;
  fp.onClose(() => { closed = true; });
  fp.setFault({ kind: 'close-mid-write', afterBytes: 2 });
  fp.write('G1 X10 Y10');
  await sleep(20);

  assert(fp.received.includes('G1'),
    `close-mid-write: truncated bytes hit mock (got ${JSON.stringify(fp.received)})`);
  assert(closed, 'close-mid-write: onClose fires after the truncated write');
  assert(!fp.isOpen, 'close-mid-write: port is closed');
  assert(fp.injectionLog.some((e) => e.kind === 'close-mid-write'),
    'close-mid-write: injectionLog has entry');
}

// 5. omit-ok: write reaches mock; the ok response is filtered out
{
  const fp = new FaultInjectingSerialPort();
  fp.open();
  const lines: string[] = [];
  fp.onData((l) => lines.push(l));

  fp.setFault({ kind: 'omit-ok' });
  fp.write('G21');
  await sleep(20);

  assert(fp.received.includes('G21'), 'omit-ok: data reaches mock.received');
  assert(!lines.includes('ok'), 'omit-ok: ok is filtered before user callback');
  assert(fp.injectionLog.some((e) => e.kind === 'omit-ok'),
    'omit-ok: injectionLog records the omission');
}

// 5b. omit-ok with matching: only the matching line's ok is dropped
{
  const fp = new FaultInjectingSerialPort();
  fp.open();
  const okEvents: string[] = [];
  fp.onData((l) => { if (l === 'ok') okEvents.push(l); });

  fp.setFault({ kind: 'omit-ok', matching: /^M5/ });
  fp.write('M5');
  fp.write('G21');
  await sleep(20);

  assert(okEvents.length === 1,
    `omit-ok+match: exactly one ok survives (got ${okEvents.length})`);
}

// 6. delay-ok: ok arrives after the configured delay
{
  const fp = new FaultInjectingSerialPort();
  fp.open();
  let okAt: number | null = null;
  fp.onData((l) => { if (l === 'ok' && okAt == null) okAt = Date.now(); });

  fp.setFault({ kind: 'delay-ok', ms: 100 });
  const start = Date.now();
  fp.write('G21');
  await sleep(40);
  assert(okAt == null, 'delay-ok: ok NOT delivered before delay elapses');
  await sleep(120);
  assert(okAt != null && okAt - start >= 100,
    `delay-ok: ok arrived after ≥100ms (got delta=${okAt != null ? okAt - start : 'null'}ms)`);
  assert(fp.injectionLog.some((e) => e.kind === 'delay-ok'),
    'delay-ok: injectionLog has entry');
}

// 7. fake-ok: line never reaches mock; ok is fabricated
{
  const fp = new FaultInjectingSerialPort();
  fp.open();
  const lines: string[] = [];
  fp.onData((l) => lines.push(l));

  fp.setFault({ kind: 'fake-ok', matching: /^M5/ });
  fp.write('M5');
  await sleep(20);

  assert(!fp.received.includes('M5'), 'fake-ok: M5 NOT delivered to mock');
  assert(lines.includes('ok'), 'fake-ok: fabricated ok reaches user callback');
  assert(fp.injectionLog.some((e) => e.kind === 'fake-ok'),
    'fake-ok: injectionLog has entry');
}

// 8. stale-status: cached <...> reply replays on subsequent ?
{
  const fp = new FaultInjectingSerialPort();
  fp.open();
  const statusLines: string[] = [];
  fp.onData((l) => { if (l.startsWith('<')) statusLines.push(l); });

  fp.setFault({ kind: 'stale-status' });
  fp.writeByte(0x3F); // ? — first reply gets cached AND delivered
  await sleep(20);
  fp.writeByte(0x3F); // ? — replays the cached line
  await sleep(20);
  fp.writeByte(0x3F); // ? — same cached line again
  await sleep(20);

  assert(statusLines.length === 3, `stale-status: 3 status replies delivered (got ${statusLines.length})`);
  assert(statusLines[0] === statusLines[1] && statusLines[1] === statusLines[2],
    'stale-status: all replies are identical (the cached line)');
  assert(fp.injectionLog.filter((e) => e.kind === 'stale-status').length >= 2,
    'stale-status: injectionLog has at least 2 stale entries (replays beyond the first)');
}

// 8b. stale-status: pre-seeded reply
{
  const fp = new FaultInjectingSerialPort();
  fp.open();
  const statusLines: string[] = [];
  fp.onData((l) => { if (l.startsWith('<')) statusLines.push(l); });

  fp.setFault({ kind: 'stale-status' });
  fp.setStaleStatusReply('<Run|MPos:50.000,0.000,0.000|FS:1000,500>');

  fp.writeByte(0x3F);
  await sleep(20);
  fp.writeByte(0x3F);
  await sleep(20);

  assert(statusLines.length >= 1, 'stale-status pre-seed: at least one status reply');
  assert(statusLines[statusLines.length - 1].includes('Run'),
    `stale-status pre-seed: replays the seeded Run state (got ${statusLines[statusLines.length - 1]})`);
}

// 9. buffer-full: writeByte / writeByteCritical throw
{
  const fp = new FaultInjectingSerialPort();
  fp.open();
  fp.setFault({ kind: 'buffer-full' });

  let threw = false;
  try {
    fp.writeByte(0x18);
  } catch (e) {
    threw = e instanceof Error && /buffer-full/i.test(e.message);
  }
  assert(threw, 'buffer-full: writeByte throws with descriptive message');

  let asyncRejected = false;
  try {
    await fp.writeByteCritical(0x18);
  } catch (e) {
    asyncRejected = e instanceof Error && /buffer-full/i.test(e.message);
  }
  assert(asyncRejected, 'buffer-full: writeByteCritical rejects with descriptive message');

  assert(fp.injectionLog.some((e) => e.kind === 'buffer-full'),
    'buffer-full: injectionLog has entry');
}

// 10. reject-write-after-return: write returns success; onError fires later
{
  const fp = new FaultInjectingSerialPort();
  fp.open();
  let asyncErr: Error | null = null;
  fp.onError((e) => { asyncErr = e; });

  fp.setFault({ kind: 'reject-write-after-return', afterMs: 50, matching: /^M5/ });

  // Sync write returns normally (no throw)
  let syncThrew = false;
  try {
    fp.write('M5');
  } catch {
    syncThrew = true;
  }
  assert(!syncThrew, 'reject-write-after-return: write() does NOT throw synchronously');
  assert(fp.received.includes('M5'),
    'reject-write-after-return: data still hits mock.received (write succeeded at the API level)');

  await sleep(20);
  assert(asyncErr == null, 'reject-write-after-return: error has NOT yet fired before delay');
  await sleep(80);
  assert(asyncErr != null,
    `reject-write-after-return: onError fires after ~afterMs (got ${asyncErr == null ? 'null' : (asyncErr as Error).message})`);
  assert(fp.injectionLog.some((e) => e.kind === 'reject-write-after-return'),
    'reject-write-after-return: injectionLog has entry');
}

// 10b. reject-write-after-return on writeCritical
{
  const fp = new FaultInjectingSerialPort();
  fp.open();
  let asyncErr: Error | null = null;
  fp.onError((e) => { asyncErr = e; });

  fp.setFault({ kind: 'reject-write-after-return', afterMs: 50 });
  await fp.writeCritical('M5');
  await sleep(80);

  assert(asyncErr != null,
    'reject-write-after-return + writeCritical: onError fires asynchronously');
}

// 11. setFault clears stale-status cache when switching modes
{
  const fp = new FaultInjectingSerialPort();
  fp.open();
  fp.setFault({ kind: 'stale-status' });
  fp.setStaleStatusReply('<Run|MPos:50.000,0.000,0.000|FS:1000,500>');

  fp.setFault({ kind: 'normal' });
  // After switching back to stale-status, the previous seed should NOT carry over
  fp.setFault({ kind: 'stale-status' });
  const statusLines: string[] = [];
  fp.onData((l) => { if (l.startsWith('<')) statusLines.push(l); });

  fp.writeByte(0x3F);
  await sleep(20);
  // First reply gets cached fresh (mock's live status), not the previous seed
  assert(!statusLines[0].includes('Run|MPos:50.000'),
    `setFault clears stale cache (got ${statusLines[0]})`);
}

// 12. injectionLog is append-only across multiple faults
{
  const fp = new FaultInjectingSerialPort();
  fp.open();
  const before = fp.injectionLog.length;

  fp.setFault({ kind: 'drop-write' });
  fp.write('G21'); // dropped pre-mock → logs synchronously
  fp.setFault({ kind: 'omit-ok' });
  fp.write('G90'); // mock ok will be intercepted async → logs after sleep
  await sleep(20);

  assert(fp.injectionLog.length >= before + 2,
    `injectionLog accumulates entries across mode switches (got ${fp.injectionLog.length - before})`);
}

// 13. Source-level pins
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));

  const src = fs.readFileSync(
    path.resolve(here, 'helpers/FaultInjectingSerialPort.ts'),
    'utf-8',
  );
  assert(/T2-13/.test(src), 'T2-13 marker in helper source');
  assert(/class FaultInjectingSerialPort implements SerialPortLike/.test(src),
    'FaultInjectingSerialPort declared as SerialPortLike');
  for (const k of [
    'normal', 'reject-write-after-return', 'drop-write', 'partial-write',
    'close-mid-write', 'omit-ok', 'delay-ok', 'fake-ok', 'stale-status',
    'buffer-full',
  ]) {
    assert(src.includes(`'${k}'`), `FaultMode kind '${k}' declared in source`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

}

void run().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
