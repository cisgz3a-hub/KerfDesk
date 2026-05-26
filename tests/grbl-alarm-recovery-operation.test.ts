/**
 * GRBL4040 alarm recovery operation.
 *
 * Hard-limit ALARM:1 recovery needs a real GRBL recovery sequence, not
 * just an app-side checklist acknowledgement. The controller operation
 * sends realtime soft reset (0x18), then $X, then asks for fresh status.
 *
 * Run: npx tsx tests/grbl-alarm-recovery-operation.test.ts
 */
import { GrblController } from '../src/controllers/grbl/GrblController';
import { MockSerialPort } from '../src/communication/SerialPort';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

async function flush(ms = 30): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

console.log('\n=== GRBL4040 alarm recovery operation ===\n');

void (async () => {
  const port = new MockSerialPort((line: string) => {
    if (line === '$X') return ['ok'];
    return ['ok'];
  });
  const ctrl = new GrblController();

  port.open();
  await ctrl.connect(port);
  await flush();

  port.received.length = 0;
  port.realtimeBytes.length = 0;

  const mirrored: string[] = [];
  const recover = (ctrl.operations as unknown as {
    recoverFromAlarm?: (args?: { onCommand?: (line: string) => void }) => Promise<{ ok: boolean; reason?: string }>;
  }).recoverFromAlarm;

  assert(typeof recover === 'function', 'GrblController exposes recoverFromAlarm operation');
  if (recover) {
    const result = await recover({ onCommand: line => mirrored.push(line) });
    assert(result.ok, 'recoverFromAlarm returns ok');
  }

  assert(port.realtimeBytes.includes(0x18), 'recoverFromAlarm sends critical realtime soft reset byte 0x18');
  assert(port.received.includes('$X'), 'recoverFromAlarm sends $X after soft reset');
  assert(port.realtimeBytes.includes(0x3f), 'recoverFromAlarm requests fresh status after unlock');
  assert(mirrored.includes('$X'), 'recoverFromAlarm mirrors $X through onCommand');

  await ctrl.disconnect();

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
