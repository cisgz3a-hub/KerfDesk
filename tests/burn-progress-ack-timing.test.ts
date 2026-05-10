/**
 * T3-11: burn-progress object lifecycle should advance on GRBL `ok` ack,
 * not when a line is merely sent into the planner buffer.
 *
 * Run: npx tsx tests/burn-progress-ack-timing.test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MockSerialPort } from '../src/communication/SerialPort';
import { GrblController } from '../src/controllers/grbl/GrblController';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ok ${m}`);
  } else {
    failed++;
    console.error(`  fail ${m}`);
  }
}

function flush(ms = 15): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sawActive(events: readonly (readonly string[])[], id: string): boolean {
  return events.some(event => event.includes(id));
}

console.log('\n=== T3-11 burn progress ack timing ===\n');

async function main(): Promise<void> {
  // T1-117: $$ response must include $10= explicitly. Pre-T1-117 a
  // missing $10 setting silently defaulted to mask=0 and combined with
  // the verified-zero G54 to auto-applyWcsNormalization. Post-T1-117
  // the same setup fails closed (placement-uncertain) — tests that
  // need the auto-normalize path must publish $10 explicitly so the
  // verified-zero classification fires.
  // T1-118: $I response must include `ok`. T3-50 (commit 92df22a)
  // started soliciting $I before $$ from _queryMachineSettings; this
  // mock predates that change and was returning [] for $I, leaving the
  // controller's _awaitingIdentityOk flag set. The test's later
  // port.injectResponse('ok') was then consumed by the identity-await
  // branch instead of the streamed-job-line ack, so lifecycle never
  // advanced.
  const port = new MockSerialPort((line: string) => {
    if (line === '$I') return ['[VER:1.1f.test]', '[OPT:VL]', 'ok'];
    if (line === '$$') return ['$10=0', '$30=1000', 'ok'];
    if (line === '$#') return ['[G54:0.000,0.000,0.000]', 'ok'];
    return [];
  });
  const ctrl = new GrblController();
  const lifecycleEvents: string[][] = [];

  ctrl.onObjectLifecycle(ids => lifecycleEvents.push([...ids]));
  port.open();
  await ctrl.connect(port);
  await flush();

  await ctrl.sendJob([
    '; OBJ ids=obj-a',
    'G1 X1 F100',
    'M2',
  ]);
  await flush();

  assert(!sawActive(lifecycleEvents, 'obj-a'), 'object lifecycle does not advance on send');

  port.injectResponse('ok');
  await flush();
  assert(sawActive(lifecycleEvents, 'obj-a'), 'object lifecycle advances after line ok ack');

  port.injectResponse('ok');
  await flush();
  assert(!ctrl.isJobRunning, 'job completes after remaining ok ack');

  await ctrl.disconnect();

  const controllerSrc = readFileSync(resolve(process.cwd(), 'src/controllers/grbl/GrblController.ts'), 'utf-8');
  const drainStart = controllerSrc.indexOf('private _drainQueue()');
  const drainEnd = controllerSrc.indexOf('// ─── JOB LIFECYCLE', drainStart);
  const handleOkStart = controllerSrc.indexOf('private _handleOk()');
  const handleOkEnd = controllerSrc.indexOf('private _handleError', handleOkStart);
  const drainBody = controllerSrc.slice(drainStart, drainEnd);
  const handleOkBody = controllerSrc.slice(handleOkStart, handleOkEnd);

  assert(!drainBody.includes('_emitObjectLifecycle(marker)'), '_drainQueue does not emit object lifecycle');
  assert(handleOkBody.includes('oldest.marker'), '_handleOk reads marker from acknowledged line');
  assert(handleOkBody.includes('_emitObjectLifecycle(oldest.marker)'), '_handleOk emits lifecycle from acked line');

  const rendererSrc = readFileSync(resolve(process.cwd(), 'src/ui/renderers/SceneRenderer.ts'), 'utf-8');
  assert(rendererSrc.includes('burnedMarkerInset'), 'SceneRenderer insets burned-object marker from bounds');
  assert(rendererSrc.includes('worldBounds.maxX - burnedMarkerInset'), 'burned marker is inset from right edge');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
}).finally(() => {
  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
});
