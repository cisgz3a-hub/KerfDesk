/**
 * Guardrails: GrblController.stop() must not send $X (unlock) or soft reset (0x18);
 * clean stop uses feed hold (0x21). emergencyStop() uses 0x18.
 * Run: npx tsx tests/controller-stop-safety.test.ts
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


function hasUnlock(lines: string[]): boolean {
  return lines.some(l => l.includes('$X'));
}

async function main(): Promise<void> {
  console.log('\n=== Controller stop safety guardrails ===');

  {
    const ctrl = new GrblController();
    const port = new MockSerialPort();
    port.open();
    await ctrl.connect(port);
    await flush();
    port.received.length = 0;
    port.realtimeBytes.length = 0;
    ctrl.stop();
    await flush();
    assert(!hasUnlock(port.received), 'stop() while idle: no $X in port.received');
    assert(
      port.realtimeBytes.includes(0x21) && !port.realtimeBytes.includes(0x18),
      'stop() while idle: feed hold (0x21), not soft reset (0x18)',
    );
    await ctrl.disconnect();
  }

  {
    const ctrl = new GrblController();
    const port = new MockSerialPort();
    port.open();
    await ctrl.connect(port);
    await flush();
    const lines = ['G21', 'G90', 'G0 X1 Y1', 'M2'].join('\n').split('\n');
    ctrl.sendJob(lines);
    await flush();
    port.received.length = 0;
    port.realtimeBytes.length = 0;
    ctrl.stop();
    await flush();
    assert(!hasUnlock(port.received), 'stop() during job: no $X in port.received');
    assert(
      port.realtimeBytes.includes(0x21) && !port.realtimeBytes.includes(0x18),
      'stop() during job: feed hold (0x21), not soft reset (0x18)',
    );
    await ctrl.disconnect();
  }

  {
    const ctrl = new GrblController();
    const port = new MockSerialPort();
    port.open();
    await ctrl.connect(port);
    await flush();
    ctrl.sendCommand('$X');
    await flush();
    assert(hasUnlock(port.received), 'sanity: explicit sendCommand("$X") appears in port.received');
    await ctrl.disconnect();
  }

  {
    const ctrl = new GrblController();
    const port = new MockSerialPort();
    port.open();
    await ctrl.connect(port);
    await flush();
    port.realtimeBytes.length = 0;
    ctrl.emergencyStop();
    await flush();
    assert(
      port.realtimeBytes.includes(0x18),
      'emergencyStop() sends soft reset (0x18)',
    );
    assert(!hasUnlock(port.received), 'emergencyStop(): no $X in port.received');
    await ctrl.disconnect();
  }

  console.log(`\nController stop safety: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
