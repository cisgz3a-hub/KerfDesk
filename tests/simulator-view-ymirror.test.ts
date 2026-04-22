import { mapMachineYToCanvasY } from '../src/ui/components/SimulatorView';

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

console.log('\n=== SimulatorView Y mapping ===');

{
  const bedHeight = 400;
  const liveHeadY = 50;
  const canvasY = mapMachineYToCanvasY(liveHeadY, bedHeight, 'front-left');
  assert(canvasY === 350, 'front-left origin flips Y (50 -> 350 on 400mm bed)');
}

{
  const bedHeight = 400;
  const liveHeadY = 50;
  const canvasY = mapMachineYToCanvasY(liveHeadY, bedHeight, 'rear-left');
  assert(canvasY === 50, 'rear-left origin keeps Y as-is (50 -> 50)');
}

console.log(`\nSimulatorView Y mapping: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
