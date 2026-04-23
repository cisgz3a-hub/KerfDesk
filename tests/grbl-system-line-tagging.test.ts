/**
 * Post-connect handshake TX lines are tagged kind=system on RawLineCallback.
 * Run: npx tsx tests/grbl-system-line-tagging.test.ts
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
  return new Promise(resolve => setTimeout(resolve, 20));
}

async function testHandshakeTxTaggedSystem(): Promise<void> {
  console.log('\n=== GRBL system line tagging: handshake TX ===');

  const ctrl = new GrblController();
  const port = new MockSerialPort();
  port.open();

  const events: Array<{ line: string; dir: 'tx' | 'rx'; kind?: 'user' | 'system' }> = [];
  ctrl.onRawLine((line, dir, kind) => {
    events.push({ line, dir, kind });
  });

  await ctrl.connect(port);
  for (let i = 0; i < 25; i++) {
    await flush();
    const sys = events.filter(e => e.dir === 'tx' && e.kind === 'system');
    if (
      sys.some(e => e.line === '$$') &&
      sys.some(e => e.line === 'G10 L2 P1 X0 Y0 Z0') &&
      sys.some(e => e.line === '$10=0')
    ) {
      break;
    }
  }

  const txSystem = events.filter(e => e.dir === 'tx' && e.kind === 'system');
  assert(txSystem.some(e => e.line === '$$'), '$$ handshake tx has kind system');
  assert(
    txSystem.some(e => e.line === 'G10 L2 P1 X0 Y0 Z0'),
    'G10 L2 P1 X0 Y0 Z0 handshake tx has kind system',
  );
  assert(txSystem.some(e => e.line === '$10=0'), '$10=0 handshake tx has kind system');

  ctrl.sendCommand('G21');
  await flush();
  const g21 = events.filter(e => e.dir === 'tx' && e.line === 'G21');
  assert(g21.some(e => e.kind === 'user'), 'manual sendCommand(G21) tx has kind user');

  await ctrl.disconnect();
}

async function testUserSendCommandNotSystem(): Promise<void> {
  console.log('\n=== GRBL system line tagging: user sendCommand ===');

  const ctrl = new GrblController();
  const port = new MockSerialPort();
  port.open();

  const events: Array<{ line: string; dir: 'tx' | 'rx'; kind?: 'user' | 'system' }> = [];
  ctrl.onRawLine((line, dir, kind) => {
    events.push({ line, dir, kind });
  });

  await ctrl.connect(port);
  for (let i = 0; i < 25; i++) {
    await flush();
    const sys = events.filter(e => e.dir === 'tx' && e.kind === 'system');
    if (sys.some(e => e.line === '$10=0')) break;
  }

  ctrl.sendCommand('G90');
  await flush();
  await flush();

  const g90Tx = events.filter(e => e.dir === 'tx' && e.line === 'G90');
  assert(g90Tx.length >= 1, 'G90 appears as tx');
  assert(
    g90Tx.every(e => e.kind !== 'system'),
    'user G90 tx is not system (user or undefined)',
  );

  await ctrl.disconnect();
}

async function runAll(): Promise<void> {
  await testHandshakeTxTaggedSystem();
  await testUserSendCommandNotSystem();

  console.log(`\n${'='.repeat(40)}`);
  console.log(`GRBL system line tagging: ${passed} passed, ${failed} failed`);
  console.log(`${'='.repeat(40)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

runAll().catch(e => {
  console.error(e);
  process.exit(1);
});
