/**
 * GrblController.sendJob: fresh `?` status before accepting a job.
 * Run: npx tsx tests/controller-fresh-status-recheck.test.ts
 */
import { GrblController } from '../src/controllers/grbl/GrblController';
import { MockSerialPort } from '../src/communication/SerialPort';

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function flush(ms = 20): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
console.log('\n=== sendJob — fresh status recheck ===');

{
  const port = new MockSerialPort();
  port.open();
  const ctrl = new GrblController();
  await ctrl.connect(port);
  await flush(50);
  port.nextStatusQueryResponse = null;
  port.blockStatusQueryResponse = false;
  await ctrl.sendJob(['G21', 'G90', 'G0 X1 Y1', 'M2']);
  assert(ctrl.isJobRunning, 'idle report → job streams');
  while (ctrl.isJobRunning) {
    port.injectResponse('ok');
    await flush(2);
  }
  await ctrl.disconnect();
}

{
  const port = new MockSerialPort();
  port.open();
  const ctrl = new GrblController();
  await ctrl.connect(port);
  await flush(50);
  port.nextStatusQueryResponse = '<Alarm|FS:0,0>';
  let err: string | null = null;
  try {
    await ctrl.sendJob(['G0 X0']);
  } catch (e: unknown) {
    err = e instanceof Error ? e.message : String(e);
  }
  assert(err != null, 'rejects on alarm');
  assert(
    err!.includes('alarm') && err!.toLowerCase().includes('machine'),
    `message reports alarm: ${err}`,
  );
  await ctrl.disconnect();
}

{
  const port = new MockSerialPort();
  port.open();
  const ctrl = new GrblController();
  await ctrl.connect(port);
  await flush(50);
  port.nextStatusQueryResponse = '<Run|FS:100,0>';
  let err: string | null = null;
  try {
    await ctrl.sendJob(['G0 X0']);
  } catch (e: unknown) {
    err = e instanceof Error ? e.message : String(e);
  }
  assert(err != null, 'rejects on run');
  assert(err!.includes('run'), `message reports run: ${err}`);
  await ctrl.disconnect();
}

{
  const port = new MockSerialPort();
  port.open();
  const ctrl = new GrblController();
  await ctrl.connect(port);
  await flush(50);
  port.blockStatusQueryResponse = true;
  let err: string | null = null;
  try {
    await ctrl.sendJob(['G0 X0']);
  } catch (e: unknown) {
    err = e instanceof Error ? e.message : String(e);
  }
  assert(err != null, 'rejects when no status within timeout');
  assert(
    err!.toLowerCase().includes('unknown'),
    `message mentions unknown: ${err}`,
  );
  port.blockStatusQueryResponse = false;
  await ctrl.disconnect();
}

if (failed > 0) process.exit(1);
process.stdout.write(`\nController fresh status recheck: ${passed} passed\n`);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
