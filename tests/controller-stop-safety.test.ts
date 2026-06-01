/**
 * GrblController.stop() must send soft reset (0x18) so the planner
 * buffer is purged; M5 is not a realtime command and must not be relied
 * on to stop an in-flight job. emergencyStop() also uses 0x18, then
 * disconnects to sever the command path.
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

function hasM5S0InReceived(lines: string[]): boolean {
  return lines.some(l => /M5\s*S0/i.test(l) || l.trim() === 'M5');
}

async function main(): Promise<void> {
  console.log('\n=== Controller stop safety (soft reset) ===');

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
      port.realtimeBytes.includes(0x18) && !port.realtimeBytes.includes(0x21),
      'stop() while idle: soft reset (0x18), not feed hold (0x21)',
    );
    assert(!hasM5S0InReceived(port.received), 'stop() while idle: no M5 in g-code stream');
    assert(port.isOpen, 'stop() leaves port open');
    await ctrl.disconnect();
  }

  {
    // No `ok` for G0 so the buffer does not finish before stop() (job stays "running" like real undrained queue).
    const port = new MockSerialPort((line: string) => {
      if (line.startsWith(';')) return [];
      if (/\bG0\b|\bG00\b/.test(line)) return [];
      return ['ok'];
    });
    const ctrl = new GrblController();
    port.open();
    await ctrl.connect(port);
    await flush();
    const lines = ['G21', 'G90', 'G0 X1 Y1', 'M2'].join('\n').split('\n');
    await ctrl.sendJob(lines);
    await flush();
    port.received.length = 0;
    port.realtimeBytes.length = 0;
    assert(ctrl.isJobRunning, 'sanity: job is running before stop()');
    let progressFires = 0;
    ctrl.onProgress(() => {
      progressFires++;
    });
    const before = progressFires;
    ctrl.stop();
    await flush();
    assert(!ctrl.isJobRunning, 'stop() during job: isJobRunning is false');
    assert(
      port.realtimeBytes.includes(0x18) && !port.realtimeBytes.includes(0x21),
      'stop() during job: soft reset (0x18), not feed hold (0x21)',
    );
    assert(!hasM5S0InReceived(port.received), 'stop() during job: no M5 in g-code stream');
    assert(progressFires > before, 'stop() notifies progress listener');
    assert(port.isOpen, 'stop() during job still leaves port open');
    await ctrl.disconnect();
  }

  {
    const ctrl = new GrblController();
    let threw = false;
    try {
      ctrl.stop();
    } catch {
      threw = true;
    }
    assert(!threw, 'stop() with no connection: does not throw');
  }

  {
    const ctrl = new GrblController();
    const port = new MockSerialPort();
    port.open();
    await ctrl.connect(port);
    await flush();
    await ctrl.disconnect();
    let threw = false;
    try {
      ctrl.stop();
    } catch {
      threw = true;
    }
    assert(!threw, 'stop() after disconnect: does not throw');
  }

  {
    // Disconnect during a live job must first send GRBL soft reset so RX /
    // planner buffers are purged before the host closes the only command path.
    const port = new MockSerialPort((line: string) => {
      if (line.startsWith(';')) return [];
      if (/\bG0\b|\bG00\b/.test(line)) return [];
      return ['ok'];
    });
    const ctrl = new GrblController();
    port.open();
    await ctrl.connect(port);
    await flush();
    await ctrl.sendJob(['G21', 'G90', 'G0 X1 Y1', 'M2']);
    await flush();
    assert(ctrl.isJobRunning, 'sanity: job is running before disconnect()');
    port.received.length = 0;
    port.realtimeBytes.length = 0;
    await ctrl.disconnect();
    await flush();
    assert(port.realtimeBytes.includes(0x18), 'disconnect() during job sends soft reset (0x18)');
    assert(!port.realtimeBytes.includes(0x21), 'disconnect() during job does not rely on feed hold');
    assert(!hasM5S0InReceived(port.received), 'disconnect() during job does not rely on queued M5');
    assert(!port.isOpen, 'disconnect() during job closes port after reset');
  }

  {
    const ctrl = new GrblController();
    const port = new MockSerialPort();
    port.open();
    await ctrl.connect(port);
    await flush();
    assert(ctrl.isJobRunning === false, 'sanity: idle before emergencyStop');
    port.realtimeBytes.length = 0;
    ctrl.emergencyStop();
    await new Promise(r => setTimeout(r, 250));
    assert(port.realtimeBytes.includes(0x18), 'emergencyStop() sends soft reset (0x18)');
    assert(!ctrl.isJobRunning, 'emergencyStop() aborts job state');
    assert(!port.isOpen, 'emergencyStop() closes port (severs command path)');
    assert(!hasUnlock(port.received), 'emergencyStop(): no $X in port.received');
    let sendThrew = false;
    try {
      ctrl.sendCommand('G0 X0');
    } catch (e) {
      sendThrew = true;
      assert(
        (e as Error).message.includes('Not connected'),
        'sendCommand after emergencyStop throws Not connected',
      );
    }
    assert(sendThrew, 'sendCommand is blocked after emergencyStop');
  }

  console.log(`\nController stop safety: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
