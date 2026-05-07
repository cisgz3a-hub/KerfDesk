/**
 * T2-48: shared simulator-device contract and compliance harness.
 *
 * Run: npx tsx tests/simulators/simulated-controller-device.test.ts
 */

import { readFileSync } from 'node:fs';
import {
  runControllerComplianceChecks,
  type SimulatedControllerDevice,
} from './SimulatedControllerDevice';
import {
  GrblSimulator,
  type GrblFirmwareSnapshot,
} from './GrblSimulator';

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

function decode(chunks: Uint8Array[]): string {
  return chunks.map(chunk => new TextDecoder().decode(chunk)).join('');
}

async function main(): Promise<void> {
  console.log('\n=== T2-48 simulated controller device framework ===');

  {
    const device: SimulatedControllerDevice<GrblFirmwareSnapshot> = new GrblSimulator();
    assert(device.identity.family === 'grbl', 'GrblSimulator declares GRBL family identity');
    assert(device.identity.protocol === 'GRBL 1.1', 'GrblSimulator declares protocol identity');
    assert(device.capabilities.output.jobExecution === 'line-stream', 'GrblSimulator exposes controller capabilities');

    device.receiveBytes(new TextEncoder().encode('$$\n'));
    const output = decode(device.readOutgoingBytes());
    assert(output.includes('$130='), 'readOutgoingBytes returns firmware output bytes');
    assert(output.includes('ok'), 'readOutgoingBytes includes ok terminator');

    device.receiveBytes(new TextEncoder().encode('G1 X10 F600\n'));
    device.tick(10);
    assert(device.snapshot().plannerQueueLength === 1, 'framework snapshot can expose simulator-specific fields');
    device.reset();
    assert(device.snapshot().plannerQueueLength === 0, 'reset clears simulator planner state');
  }

  {
    const results = runControllerComplianceChecks(() => new GrblSimulator());
    assert(results.length >= 5, 'compliance harness runs multiple checks');
    assert(results.every(result => result.passed), 'GRBL simulator passes the shared compliance harness');
    assert(results.some(result => result.name === 'identity'), 'compliance checks include identity');
    assert(results.some(result => result.name === 'capabilities'), 'compliance checks include capabilities');
    assert(results.some(result => result.name === 'io-bytes'), 'compliance checks include byte I/O');
    assert(results.some(result => result.name === 'reset'), 'compliance checks include reset');
  }

  {
    const device = new GrblSimulator();
    const id = device.injectFault({ type: 'enter-alarm', alarmCode: 1, trigger: 'after-ms', param: 1 });
    assert(id.startsWith('fault_'), 'injectFault returns a traceable fault id');
  }

  const contract = readFileSync('tests/simulators/SimulatedControllerDevice.ts', 'utf8');
  const grbl = readFileSync('tests/simulators/GrblSimulator.ts', 'utf8');
  assert(contract.includes('T2-48'), 'contract source carries T2-48 marker');
  assert(/interface SimulatedControllerDevice/.test(contract), 'SimulatedControllerDevice interface declared');
  assert(/identity: SimulatedControllerIdentity/.test(contract), 'contract declares identity');
  assert(/capabilities: ControllerCapabilities/.test(contract), 'contract declares capabilities');
  assert(/receiveBytes\(bytes: Uint8Array\): void/.test(contract), 'contract declares receiveBytes');
  assert(/readOutgoingBytes\(\): Uint8Array\[\]/.test(contract), 'contract declares readOutgoingBytes');
  assert(/runControllerComplianceChecks/.test(contract), 'contract exports compliance harness');
  assert(/implements SimulatedControllerDevice/.test(grbl), 'GrblSimulator implements the shared contract');

  console.log(`\nSimulated controller device framework: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
