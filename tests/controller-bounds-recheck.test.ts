/**
 * GrblController.sendJob: absolute G0/G1 X/Y within known $130/$131 bed.
 * Run: npx tsx tests/controller-bounds-recheck.test.ts
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

function portWithSettingsBed(w: number, h: number, extraForLines?: (line: string) => string[] | null): MockSerialPort {
  return new MockSerialPort((line: string) => {
    const extra = extraForLines?.(line);
    if (extra) return extra;
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
        `$130=${w.toFixed(3)}`,
        `$131=${h.toFixed(3)}`,
        'ok',
      ];
    }
    if (line === '$#') {
      return ['[G54:0.000,0.000,0.000]', 'ok'];
    }
    if (line === '' || line.startsWith(';')) return line === '' ? ['ok'] : [];
    if (line.startsWith('$') && !line.startsWith('$J=')) return ['ok'];
    if (/^G|^M|^S|^F/.test(line)) return ['ok'];
    return ['ok'];
  });
}

async function main(): Promise<void> {
console.log('\n=== sendJob — bounds precheck ===');

{
  const port = portWithSettingsBed(400, 300);
  port.open();
  const ctrl = new GrblController();
  await ctrl.connect(port);
  await flush(30);
  let acceptErr: string | null = null;
  try {
    await ctrl.sendJob(['G21', 'G90', 'G0 X100 Y100', 'M2']);
  } catch (e: unknown) {
    acceptErr = e instanceof Error ? e.message : String(e);
  }
  assert(acceptErr === null, `G0 X100 Y100 within bed: sendJob accepted (${acceptErr})`);
  assert(ctrl.getMachineInfo().bedWidth === 400, 'bed 400 from $$');
  while (ctrl.isJobRunning) {
    port.injectResponse('ok');
    await flush(2);
  }
  await ctrl.disconnect();
}

{
  const port = portWithSettingsBed(400, 300);
  port.open();
  const ctrl = new GrblController();
  await ctrl.connect(port);
  await flush(30);
  let err: string | null = null;
  try {
    await ctrl.sendJob(['G21', 'G90', 'G0 X500 Y100', 'M2']);
  } catch (e: unknown) {
    err = e instanceof Error ? e.message : String(e);
  }
  assert(err != null, 'rejects X=500 for 400mm bed');
  assert(
    err!.includes('X=500.000') && err!.includes('400') && err!.toLowerCase().includes('wide'),
    `X message: ${err}`,
  );
  assert(!ctrl.isJobRunning, 'no job after bounds failure');
  await ctrl.disconnect();
}

{
  const port = portWithSettingsBed(400, 300);
  port.open();
  const ctrl = new GrblController();
  await ctrl.connect(port);
  await flush(30);
  let err: string | null = null;
  try {
    await ctrl.sendJob(['G21', 'G90', 'G1 Y350 F1000', 'M2']);
  } catch (e: unknown) {
    err = e instanceof Error ? e.message : String(e);
  }
  assert(err != null, 'rejects Y=350 for 300mm height');
  assert(
    err!.includes('Y=350.000') && err!.includes('300') && err!.toLowerCase().includes('tall'),
    `Y message: ${err}`,
  );
  await ctrl.disconnect();
}

{
  const noBed = new MockSerialPort((line: string) => {
    if (line === '$$') {
      return [
        '$10=0', '$30=1000.000', '$32=0',
        'ok',
      ];
    }
    if (line === '$#') return ['[G54:0,0,0]', 'ok'];
    if (line === '' || line.startsWith(';')) return line === '' ? ['ok'] : [];
    if (line.startsWith('$')) return ['ok'];
    if (/^G|^M|^F|^S/.test(line)) return ['ok'];
    return ['ok'];
  });
  noBed.open();
  const ctrl = new GrblController();
  await ctrl.connect(noBed);
  await flush(30);
  assert(ctrl.getMachineInfo().bedWidth === 0, 'no $130 → 0');
  let threw = false;
  try {
    await ctrl.sendJob(['G0 X9999', 'M2']);
    threw = false;
  } catch {
    threw = true;
  }
  assert(!threw, 'no bed extents → bounds check skipped (no false reject)');
  if (ctrl.isJobRunning) {
    while (ctrl.isJobRunning) {
      noBed.injectResponse('ok');
      await flush(2);
    }
  }
  await ctrl.disconnect();
}

// T1-44: relative-mode bounds simulation. Pre-T1-44 these two G0 X9999
// jobs were silently accepted because `_checkJobBounds` skipped relative
// lines entirely. Now the cursor is seeded from the controller's last
// confirmed position (here {0,0,0} from the welcome status report) and
// the simulated +9999 from origin → off-bed → reject.
{
  const port = portWithSettingsBed(400, 300);
  port.open();
  const ctrl = new GrblController();
  await ctrl.connect(port);
  await flush(30);
  let err: string | null = null;
  try {
    await ctrl.sendJob(['G90', 'G91', 'G0 X9999', 'M2']);
  } catch (e: unknown) {
    err = e instanceof Error ? e.message : String(e);
  }
  assert(err != null, 'T1-44: G90 then G91 G0 X9999 → reject (relative move accumulates off-bed)');
  await ctrl.disconnect();
}

{
  const port = portWithSettingsBed(400, 300);
  port.open();
  const ctrl = new GrblController();
  await ctrl.connect(port);
  await flush(30);
  let err: string | null = null;
  try {
    await ctrl.sendJob(['G91', 'G0 X9999', 'M2']);
  } catch (e: unknown) {
    err = e instanceof Error ? e.message : String(e);
  }
  assert(err != null, 'T1-44: G91 at start + G0 X9999 → reject (relative simulation from origin)');
  await ctrl.disconnect();
}

{
  const port = portWithSettingsBed(400, 300);
  port.open();
  const ctrl = new GrblController();
  await ctrl.connect(port);
  await flush(30);
  let err: string | null = null;
  try {
    await ctrl.sendJob(['G90', 'G91', 'G0 X9999', 'G90', 'G0 X9999', 'M2']);
  } catch (e: unknown) {
    err = e instanceof Error ? e.message : String(e);
  }
  assert(
    err != null,
    'G90 G91 (relative) G0, then G90, then G0 out of range → reject',
  );
  await ctrl.disconnect();
}

{
  const port = portWithSettingsBed(400, 300);
  port.open();
  const ctrl = new GrblController();
  await ctrl.connect(port);
  await flush(30);
  const longJob: string[] = [];
  for (let i = 0; i < 1000; i++) {
    if (i === 599) longJob.push('G0 X9999 Y0');
    else longJob.push('G0 X1 Y1');
  }
  longJob.push('M2');
  let threw = false;
  try {
    await ctrl.sendJob(longJob);
  } catch {
    threw = true;
  }
  assert(!threw, 'bad coord only after line 500 → not scanned, job accepted');
  if (ctrl.isJobRunning) {
    while (ctrl.isJobRunning) {
      port.injectResponse('ok');
      await flush(1);
    }
  }
  await ctrl.disconnect();
}

if (failed > 0) process.exit(1);
process.stdout.write(`\nController bounds recheck: ${passed} passed\n`);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
