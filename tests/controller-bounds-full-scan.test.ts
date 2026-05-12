/**
 * T1-108: GrblController._checkJobBounds must inspect every motion line.
 *
 * Pre-T1-108 the controller scanned only the first 500 lines before accepting
 * a job. A raw or stale job with an out-of-bounds move at line 501 could pass
 * this final controller-layer defense. These tests pin the full-scan contract
 * for both absolute and relative-mode jobs.
 *
 * Run: npx tsx tests/controller-bounds-full-scan.test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { GrblController } from '../src/controllers/grbl/GrblController';
import { MockSerialPort } from '../src/communication/SerialPort';

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  ok ${message}`);
  } else {
    failed++;
    console.error(`  fail ${message}`);
  }
}

function flush(ms = 20): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function port400x300(): MockSerialPort {
  return new MockSerialPort((line: string) => {
    if (line === '$$') {
      return [
        '$10=0',
        '$22=0',
        '$23=0',
        '$32=0',
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
    if (line === '$#') return ['[G54:0.000,0.000,0.000]', 'ok'];
    if (line === '' || line.startsWith(';')) return line === '' ? ['ok'] : [];
    if (line.startsWith('$') && !line.startsWith('$J=')) return ['ok'];
    if (/^G|^M|^S|^F/.test(line)) return ['ok'];
    return ['ok'];
  });
}

async function rejectMessageFor(lines: string[]): Promise<string | null> {
  const port = port400x300();
  port.open();
  const ctrl = new GrblController();
  await ctrl.connect(port);
  await flush(30);
  try {
    await ctrl.sendJob(lines);
    if (ctrl.isJobRunning) {
      while (ctrl.isJobRunning) {
        port.injectResponse('ok');
        await flush(1);
      }
    }
    return null;
  } catch (err: unknown) {
    return err instanceof Error ? err.message : String(err);
  } finally {
    await ctrl.disconnect();
  }
}

async function main(): Promise<void> {
  console.log('\n=== T1-108 controller bounds full scan ===\n');

  {
    const lines: string[] = ['G21', 'G90'];
    for (let i = 0; i < 500; i++) {
      lines.push('G0 X1 Y1');
    }
    lines.push('G0 X9999 Y0');
    lines.push('M2');

    const msg = await rejectMessageFor(lines);
    assert(msg != null, 'absolute out-of-bounds move after first 500 lines rejects');
    assert(/X=9999\.000/.test(msg ?? ''), 'absolute rejection reports late X position');
  }

  {
    const lines: string[] = ['G21', 'G91'];
    for (let i = 0; i < 500; i++) {
      lines.push('G0 X0.5');
    }
    lines.push('G0 X200');
    lines.push('M2');

    const msg = await rejectMessageFor(lines);
    assert(msg != null, 'relative out-of-bounds move after first 500 lines rejects');
    assert(/X=450\.000/.test(msg ?? ''), 'relative rejection reports accumulated late X');
  }

  {
    const here = dirname(fileURLToPath(import.meta.url));
    const controllerSrc = readFileSync(resolve(here, '../src/controllers/grbl/GrblController.ts'), 'utf8');
    const helperSrc = readFileSync(resolve(here, '../src/controllers/grbl/GrblJobBoundsChecker.ts'), 'utf8');
    const start = controllerSrc.indexOf('private _checkJobBounds(');
    const end = controllerSrc.indexOf('private _queryFreshStatus', start);
    const body = controllerSrc.slice(start, end);
    assert(controllerSrc.includes('T1-108: all lines are inspected') || helperSrc.includes('T1-108: deliberately O(n)'),
      'source documents the full-scan safety rationale');
    assert(!/MAX_LINES/.test(body) && !/MAX_LINES/.test(helperSrc),
      'old MAX_LINES cap is absent from _checkJobBounds');
    assert(/for \(let i = 0; i < lines\.length; i\+\+\)/.test(helperSrc),
      'job-bounds helper loops across all lines');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
