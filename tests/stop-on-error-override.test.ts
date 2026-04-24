/**
 * GrblController.setStopOnError — when false, error:N does not abort the job stream.
 * Run: npx tsx tests/stop-on-error-override.test.ts
 */
import { GrblController } from '../src/controllers/grbl/GrblController';
import { MockSerialPort } from '../src/communication/SerialPort';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function flush(): Promise<void> {
  return new Promise(r => setTimeout(r, 20));
}

async function waitUntil(cond: () => boolean, timeoutMs: number, stepMs = 20): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (cond()) return;
    await new Promise<void>(x => setTimeout(x, stepMs));
  }
}

/** Second movement line (G0 X1) gets error:20; others ok. */
function makeError20Port(): MockSerialPort {
  return new MockSerialPort((line: string) => {
    if (line.startsWith(';')) return [];
    if (line === 'G0 X1' || line.trim() === 'G0 X1') return ['error:20'];
    return ['ok'];
  });
}

async function main(): Promise<void> {
  console.log('\n=== setStopOnError default / true → job aborts on error ===');
  {
    const port = makeError20Port();
    const ctrl = new GrblController();
    port.open();
    await ctrl.connect(port);
    await flush();
    ctrl.setStopOnError(true);
    const job = ['G21', 'G0 X0', 'G0 X1', 'G0 X2', 'M2'];
    await ctrl.sendJob(job);
    await waitUntil(() => !ctrl.isJobRunning, 3000);
    assert(!ctrl.isJobRunning, 'job no longer running after error (aborted)');
    await ctrl.disconnect();
  }

  console.log('\n=== setStopOnError(false) → error:20 does not abort; job can finish ===');
  {
    const port = makeError20Port();
    const ctrl = new GrblController();
    port.open();
    await ctrl.connect(port);
    await flush();
    ctrl.setStopOnError(false);
    let errCount = 0;
    ctrl.onError((code) => { errCount++; if (code !== 20) console.error('expected 20, got', code); });
    const job = ['G21', 'G0 X0', 'G0 X1', 'G0 X2', 'M2'];
    await ctrl.sendJob(job);
    await waitUntil(() => !ctrl.isJobRunning, 5000);
    assert(errCount >= 1, 'error listener still fired (logged, job continued)');
    assert(!ctrl.isJobRunning, 'job completed after continuing past error');
    await ctrl.disconnect();
  }

  console.log('\n=== setStopOnError(true) restores abort behavior ===');
  {
    const port = makeError20Port();
    const ctrl = new GrblController();
    port.open();
    await ctrl.connect(port);
    await flush();
    ctrl.setStopOnError(false);
    ctrl.setStopOnError(true);
    const job = ['G21', 'G0 X0', 'G0 X1', 'G0 X2', 'M2'];
    await ctrl.sendJob(job);
    await waitUntil(() => !ctrl.isJobRunning, 3000);
    assert(!ctrl.isJobRunning, 're-enabled stopOnError aborts again');
    await ctrl.disconnect();
  }

  console.log(`\nStop on error override: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
