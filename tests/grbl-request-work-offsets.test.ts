/**
 * Saved-origin verification depends on querying GRBL `$#` after Set Origin.
 * This pins the one-off query path separately from the connect-time WCS
 * consent query: it must parse `[G54:...]` without triggering WCS normalization.
 *
 * Run: npx tsx tests/grbl-request-work-offsets.test.ts
 */
import { MockSerialPort } from '../src/communication/SerialPort';
import { GrblController } from '../src/controllers/grbl/GrblController';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok ${message}`);
  } else {
    failed++;
    console.error(`  fail ${message}`);
  }
}

async function waitUntil(condition: () => boolean, timeoutMs = 1000, stepMs = 10): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (condition()) return;
    await new Promise<void>(resolve => setTimeout(resolve, stepMs));
  }
}

async function run(): Promise<void> {
  console.log('\n=== GRBL requestWorkOffsets ===\n');

  let reportedG54 = { x: 0, y: 0, z: 0 };
  const port = new MockSerialPort((line: string) => {
    if (line === '?') return ['<Idle|MPos:0.000,0.000,0.000|FS:0,0>'];
    if (line === '$I') return ['[VER:1.1h:mock]', '[OPT:V,15,128]', 'ok'];
    if (line === '$$') {
      return [
        '$10=0',
        '$22=0',
        '$23=0',
        '$32=1',
        '$30=1000.000',
        '$110=10000.000',
        '$111=10000.000',
        '$120=10.000',
        '$121=10.000',
        '$130=400.000',
        '$131=300.000',
        'ok',
      ];
    }
    if (line === '$#') {
      return [
        `[G54:${reportedG54.x.toFixed(3)},${reportedG54.y.toFixed(3)},${reportedG54.z.toFixed(3)}]`,
        '[G55:0.000,0.000,0.000]',
        'ok',
      ];
    }
    return ['ok'];
  });

  const ctrl = new GrblController();
  let wcsConsentCalls = 0;
  ctrl.onWcsConsentNeeded?.(() => {
    wcsConsentCalls++;
  });

  await port.open();
  await ctrl.connect(port);
  await waitUntil(() => port.received.includes('G10 L2 P1 X0 Y0 Z0'));
  const baselineNormalizationCount = port.received.filter(line => line === 'G10 L2 P1 X0 Y0 Z0').length;

  reportedG54 = { x: 12.5, y: -3.25, z: 0 };
  const currentG54 = await ctrl.requestWorkOffsets?.(250);

  assert(currentG54 != null, 'one-off $# query resolves with a parsed G54');
  assert(Math.abs((currentG54?.x ?? 0) - 12.5) < 0.001, 'parsed G54 X is returned');
  assert(Math.abs((currentG54?.y ?? 0) - (-3.25)) < 0.001, 'parsed G54 Y is returned');
  assert((currentG54?.z ?? 99) === 0, 'parsed G54 Z is returned');
  assert(wcsConsentCalls === 0, 'one-off query does not fire WCS consent listeners');
  assert(
    port.received.filter(line => line === 'G10 L2 P1 X0 Y0 Z0').length === baselineNormalizationCount,
    'one-off query does not normalize G54 back to machine origin',
  );

  await ctrl.disconnect();

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
