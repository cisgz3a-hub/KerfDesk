/**
 * GrblController.setStopOnError — when false, error:N does not abort the job stream.
 *
 * T1-116: pre-fix the controller accepted setStopOnError(false) from
 * any caller. Post-fix it requires an UnsafeStopOnErrorOverrideToken
 * minted by createStopOnErrorOverrideToken(reason). This test was
 * updated to mint a token explicitly and to add a contract that
 * setStopOnError(false) without a token throws.
 *
 * Run: npx tsx tests/stop-on-error-override.test.ts
 */
import {
  createStopOnErrorOverrideToken,
  GrblController,
} from '../src/controllers/grbl/GrblController';
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

  console.log('\n=== setStopOnError(false) with override token → error:20 does not abort; job can finish ===');
  {
    const port = makeError20Port();
    const ctrl = new GrblController();
    port.open();
    await ctrl.connect(port);
    await flush();
    const token = createStopOnErrorOverrideToken('test: continue past error:20 to verify behavior');
    ctrl.setStopOnError(false, token);
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
    const token = createStopOnErrorOverrideToken('test: temporarily disabled, then re-enabled');
    ctrl.setStopOnError(false, token);
    ctrl.setStopOnError(true);
    const job = ['G21', 'G0 X0', 'G0 X1', 'G0 X2', 'M2'];
    await ctrl.sendJob(job);
    await waitUntil(() => !ctrl.isJobRunning, 3000);
    assert(!ctrl.isJobRunning, 're-enabled stopOnError aborts again');
    await ctrl.disconnect();
  }

  console.log('\n=== T1-116: setStopOnError(false) without a token throws ===');
  {
    const ctrl = new GrblController();
    let threw = false;
    let message = '';
    try {
      ctrl.setStopOnError(false);
    } catch (err) {
      threw = true;
      message = err instanceof Error ? err.message : String(err);
    }
    assert(threw, 'setStopOnError(false) without a token throws');
    assert(/UnsafeStopOnErrorOverrideToken/i.test(message),
      'thrown error names UnsafeStopOnErrorOverrideToken');
    assert(/createStopOnErrorOverrideToken/i.test(message),
      'thrown error names the createStopOnErrorOverrideToken factory');
  }

  console.log('\n=== T1-116: createStopOnErrorOverrideToken requires a non-empty reason ===');
  {
    let threwOnEmpty = false;
    try { createStopOnErrorOverrideToken(''); } catch { threwOnEmpty = true; }
    assert(threwOnEmpty, 'empty reason → throws');

    let threwOnWhitespace = false;
    try { createStopOnErrorOverrideToken('   '); } catch { threwOnWhitespace = true; }
    assert(threwOnWhitespace, 'whitespace-only reason → throws');

    const token = createStopOnErrorOverrideToken('legitimate reason');
    assert(token.kind === 'unsafe-stop-on-error-override-token',
      'minted token has the expected kind');
    assert(token.reason === 'legitimate reason',
      'minted token records the caller-supplied reason');
    assert(typeof token.mintedAt === 'number' && token.mintedAt > 0,
      'minted token records mintedAt timestamp');
  }

  console.log('\n=== T1-116: a fake/forged token is rejected ===');
  {
    const ctrl = new GrblController();
    const fake = {
      kind: 'unsafe-stop-on-error-override-token',
      // Missing reason — strips the audit trail.
    } as unknown as Parameters<GrblController['setStopOnError']>[1];
    let threw = false;
    try { ctrl.setStopOnError(false, fake); } catch { threw = true; }
    assert(threw, 'token missing reason field → throws');
  }

  console.log(`\nStop on error override: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
