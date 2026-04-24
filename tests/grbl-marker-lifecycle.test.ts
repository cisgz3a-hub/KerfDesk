/**
 * GrblController parses ; OBJ ids= markers in sendJob and fires onObjectLifecycle.
 * Run: npx tsx tests/grbl-marker-lifecycle.test.ts
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
  return new Promise(r => setTimeout(r, 15));
}

console.log('\n=== grbl-marker-lifecycle ===');

(async () => {
  const ctrl = new GrblController();
  const port = new MockSerialPort();
  port.open();
  await ctrl.connect(port);
  await flush();
  await flush();

  const events: string[][] = [];
  ctrl.onObjectLifecycle?.(ids => {
    events.push([...ids]);
  });

  const lines = [
    '; OBJ ids=obj-1',
    'G0 X10 Y10',
    '; OBJ ids=obj-2',
    'G1 X20 Y20 F1000',
  ];
  await ctrl.sendJob(lines);
  await flush();
  await flush();
  await flush();

  assert(events.length >= 1, 'at least initial lifecycle event');
  assert(events.some(e => e.length === 0), 'includes reset [] at job start');
  assert(events.some(e => e.join(',') === 'obj-1'), 'includes obj-1 before G0');
  assert(events.some(e => e.join(',') === 'obj-2'), 'includes obj-2 before G1');

  const joined = port.received.join('\n');
  assert(!joined.includes('OBJ'), 'port never receives OBJ comment lines');

  for (let i = 0; i < 30; i++) {
    await flush();
    if (!ctrl.isJobRunning) break;
  }

  assert(events.length >= 2 && events[events.length - 1]?.length === 0, 'job end emits []');

  await ctrl.disconnect();

  console.log(`\ngrbl-marker-lifecycle: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
