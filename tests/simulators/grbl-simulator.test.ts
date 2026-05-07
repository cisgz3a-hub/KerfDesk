/**
 * T2-47: realistic GRBL firmware simulator foundation.
 *
 * Run: npx tsx tests/simulators/grbl-simulator.test.ts
 */

import { GrblController } from '../../src/controllers/grbl/GrblController';
import { GrblSimulator, SimulatedGrblSerialPort } from './GrblSimulator';

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

function flush(ms = 20): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function hasOutput(sim: GrblSimulator, pattern: RegExp): boolean {
  return sim.readOutgoingLines().some(line => pattern.test(line));
}

async function main(): Promise<void> {
  console.log('\n=== T2-47 GRBL simulator foundation ===');

  {
    const sim = new GrblSimulator();
    sim.receiveText('G21 G91 M4 S500 F600\n');
    const snap = sim.snapshot();
    assert(snap.modal.units === 'mm', 'G21 sets mm units');
    assert(snap.modal.distanceMode === 'relative', 'G91 sets relative mode');
    assert(snap.modal.laserMode === 'M4', 'M4 is tracked as modal laser mode');
    assert(snap.modal.spindleSpeed === 500, 'S word is tracked');
    assert(snap.modal.feedRate === 600, 'F word is tracked');
  }

  {
    const sim = new GrblSimulator();
    sim.receiveText('G1 X10\n');
    assert(hasOutput(sim, /^error:22$/), 'G1 without feed rate reports error:22');
    assert(sim.snapshot().plannerQueueLength === 0, 'invalid no-feed move is not queued');
  }

  {
    const sim = new GrblSimulator();
    sim.receiveText('G1 X10 F600\n');
    let snap = sim.snapshot();
    assert(snap.state === 'run', 'accepted move transitions to run');
    assert(snap.plannerQueueLength === 1, 'accepted move enters planner queue');
    assert(hasOutput(sim, /^ok$/), 'accepted move emits ok when queued');

    sim.tick(500);
    snap = sim.snapshot();
    assert(snap.position.x > 0 && snap.position.x < 10, 'tick advances active move to mid-position');
    assert(snap.state === 'run', 'mid-move state remains run');

    sim.tick(1000);
    snap = sim.snapshot();
    assert(Math.abs(snap.position.x - 10) < 0.001, 'tick completes active move');
    assert(snap.plannerQueueLength === 0, 'completed move leaves planner queue');
    assert(snap.state === 'idle', 'empty planner returns to idle');
  }

  {
    const sim = new GrblSimulator();
    sim.receiveText('G1 X10 F600\n');
    sim.receiveRealtimeByte(0x21);
    assert(sim.snapshot().state === 'hold', 'feed hold realtime byte enters hold');
    sim.tick(1000);
    assert(sim.snapshot().position.x === 0, 'held planner does not advance');
    sim.receiveRealtimeByte(0x7e);
    assert(sim.snapshot().state === 'run', 'cycle start resumes queued work');
  }

  {
    const sim = new GrblSimulator();
    sim.receiveText('G91 M3 S700 F600\n');
    sim.receiveText('G1 X10\n');
    sim.tick(250);
    sim.receiveRealtimeByte(0x18);
    const snap = sim.snapshot();
    assert(snap.state === 'alarm', 'soft reset transitions to alarm');
    assert(snap.positionTrusted === false, 'soft reset marks position untrusted');
    assert(snap.plannerQueueLength === 0, 'soft reset clears planner queue');
    assert(snap.modal.distanceMode === 'absolute', 'soft reset restores absolute distance mode');
    assert(snap.modal.laserMode === 'M5', 'soft reset turns laser modal state off');
    assert(snap.modal.spindleSpeed === 0, 'soft reset clears spindle speed');

    sim.receiveText('G1 X1 F600\n');
    assert(hasOutput(sim, /^error:9$/), 'motion command is locked out in alarm');
    sim.receiveText('$H\n');
    assert(hasOutput(sim, /^error:9$/), '$H is refused while simulator is alarm-locked');
    sim.receiveText('$X\n');
    assert(sim.snapshot().state === 'idle', '$X unlock transitions alarm to idle');
  }

  {
    const sim = new GrblSimulator({ rxBufferSize: 16 });
    sim.receiveText(`G1 X${'1'.repeat(30)}\n`);
    assert(sim.snapshot().rxOverflowCount >= 1, 'oversized input increments RX overflow count');
    assert(hasOutput(sim, /^error:24$/), 'oversized input emits GRBL overflow-style error:24');
  }

  {
    const sim = new GrblSimulator();
    const port = new SimulatedGrblSerialPort(sim, { autoTickMs: 1000 });
    const ctrl = new GrblController();
    port.open();
    await ctrl.connect(port);
    await flush(50);
    const lines = ['G21', 'G90'];
    for (let i = 0; i < 200; i++) {
      lines.push(`G1 X${i % 20} Y${Math.floor(i / 20)} F1200`);
    }
    await ctrl.sendJob(lines);
    await flush(500);
    const snap = sim.snapshot();
    assert(snap.rxOverflowCount === 0, 'GrblController 200-line stream does not overflow simulator RX buffer');
    assert(port.received.length >= 200, 'simulated serial port received streamed job lines');
  }

  const source = await import('node:fs').then(fs => fs.readFileSync('tests/simulators/GrblSimulator.ts', 'utf8'));
  assert(source.includes('T2-47'), 'GrblSimulator source carries T2-47 marker');
  assert(/class GrblSimulator/.test(source), 'GrblSimulator class exported');
  assert(/class SimulatedGrblSerialPort/.test(source), 'SimulatedGrblSerialPort adapter exported');
  assert(/rxBufferSize/.test(source), 'RX buffer size is modeled');
  assert(/plannerQueue/.test(source), 'planner queue is modeled');
  assert(/positionTrusted/.test(source), 'position trust is modeled');

  console.log(`\nGRBL simulator foundation: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
