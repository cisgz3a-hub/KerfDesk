/**
 * Regression: GRBL `ok` drains the host stream, but physical job completion
 * requires a fresh `<Idle...>` status report after the final `ok`.
 *
 * Run: npx tsx tests/grbl-final-ok-awaits-idle.test.ts
 */
import { GrblController } from '../src/controllers/grbl/GrblController';
import { MockSerialPort } from '../src/communication/SerialPort';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 10));
}

async function run(): Promise<void> {
  console.log('\n=== GRBL final ok waits for physical idle ===\n');

  const port = new MockSerialPort((line: string) => {
    if (line === '$I') return ['[VER:1.1h:]', '[OPT:V,15,128]', 'ok'];
    if (line === '$$') return ['$10=0', '$30=1000', 'ok'];
    if (line === '$#') return ['[G54:0.000,0.000,0.000]', 'ok'];
    return [];
  });
  const ctrl = new GrblController();

  port.open();
  await ctrl.connect(port);
  await flush();
  await flush();

  await ctrl.sendJob([
    '; OBJ ids=obj-a',
    'G1 X1 F100',
    'M2',
  ]);
  await flush();

  port.injectResponse('ok');
  await flush();
  assert(ctrl.isJobRunning, 'job remains running after first ok');
  assert(ctrl.state.status === 'run', `status remains run after first ok (got ${ctrl.state.status})`);

  const statusQueriesBeforeFinalOk = port.realtimeBytes.filter(byte => byte === 0x3F).length;
  port.nextStatusQueryResponse = '<Run|MPos:0.500,0.000,0.000|FS:100,0>';
  port.injectResponse('ok');
  await flush();

  assert(ctrl.isJobRunning, 'final ok does not complete while fresh status is Run');
  assert(ctrl.state.status === 'run', `fresh Run status keeps controller running (got ${ctrl.state.status})`);
  assert(
    port.realtimeBytes.filter(byte => byte === 0x3F).length > statusQueriesBeforeFinalOk,
    'controller asks GRBL for a fresh status report after final ok',
  );

  port.nextStatusQueryResponse = '<Idle|MPos:1.000,0.000,0.000|FS:0,0>';
  ctrl.requestStatusReport();
  await flush();

  assert(!ctrl.isJobRunning, 'later fresh Idle status completes the job');
  assert(ctrl.state.status === 'idle', `status is idle after physical completion (got ${ctrl.state.status})`);

  await ctrl.disconnect();

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
