/**
 * T3-2 case 5: a transport error mid-job behaves like a cable pull.
 * Run: npx tsx tests/cable-yanked-mid-job.test.ts
 */
import { MockSerialPort } from '../src/communication/SerialPort';
import { GrblController } from '../src/controllers/grbl/GrblController';
import { writeAutosaveAsync, readAutosave } from '../src/app/autosavePersistence';
import { InMemoryStorageAdapter } from '../src/core/storage/InMemoryStorageAdapter';
import { setStorageForTest } from '../src/core/storage/storage';

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function flush(ms = 20): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function connectController(controller: GrblController, port: MockSerialPort): Promise<void> {
  port.open();
  await controller.connect(port);
  await flush(60);
}

async function waitForIdle(controller: GrblController): Promise<void> {
  for (let i = 0; i < 3000; i++) {
    await flush(5);
    if (!controller.isJobRunning && controller.state.status === 'idle') return;
  }
  throw new Error(`Controller did not return idle; status=${controller.state.status}`);
}

async function run(): Promise<void> {
  console.log('\n=== cable-yanked-mid-job ===\n');

  setStorageForTest(new InMemoryStorageAdapter());
  await writeAutosaveAsync('{"scene":"before-cable-yank","objects":[1]}');

  const controller = new GrblController();
  const stalledPort = new MockSerialPort(() => []);
  const errors: string[] = [];
  const stateChanges: string[] = [];
  controller.onError((_code, message) => errors.push(message));
  controller.onStateChange(state => stateChanges.push(state.status));

  await connectController(controller, stalledPort);

  const firstJob = [
    'G21',
    'G90',
    'M4 S100',
    'G1 X10 F500',
    'G1 X20 F500',
    'M5',
  ];

  void controller.sendJob(firstJob);
  await flush(60);
  assert(controller.isJobRunning, 'job is running before simulated cable error');

  stalledPort.simulateError('USB cable yanked');
  await flush(60);

  const autosave = await readAutosave();
  assert(autosave?.json === '{"scene":"before-cable-yank","objects":[1]}', 'autosave record survives cable error');
  assert(errors.some(message => message.includes('USB cable yanked')), 'serial error is surfaced to listeners');
  assert(!controller.isJobRunning, 'job is aborted on transport error');
  assert(controller.state.status === 'disconnected', 'controller status becomes disconnected on transport error');
  assert(stateChanges.includes('disconnected'), 'UI state listeners see disconnected transition');
  assert(!stalledPort.isOpen, 'failed port is closed after transport error');

  const recoveryPort = new MockSerialPort();
  await connectController(controller, recoveryPort);
  assert(controller.state.status === 'idle', 'controller can reconnect after transport error');

  const receivedBeforeRecoveryJob = recoveryPort.received.length;
  await controller.sendJob(['G21', 'G90', 'G0 X1 Y1', 'M5']);
  await waitForIdle(controller);
  const recoveryJobLines = recoveryPort.received.slice(receivedBeforeRecoveryJob);
  assert(!controller.isJobRunning, 'reconnect-then-start completes a new job');
  assert(
    recoveryJobLines.some(line => line.trim() === 'G21')
    && recoveryJobLines.some(line => line.trim() === 'M5'),
    'new job streams on the recovered connection',
  );

  await controller.disconnect();
  setStorageForTest(null);

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void run().catch((err: unknown) => {
  console.error(err);
  setStorageForTest(null);
  process.exit(1);
});
