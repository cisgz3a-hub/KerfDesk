import { readFileSync } from 'node:fs';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const source = readFileSync('src/app/ExecutionCoordinator.ts', 'utf8');

assert(
  !source.includes('MachineCommandGateway'),
  'ExecutionCoordinator no longer imports or creates MachineCommandGateway (superseded by T2-26 operations)',
);
assert(!source.includes('ctrl.sendCommand('), 'ExecutionCoordinator does not call ctrl.sendCommand directly');
assert(
  !source.includes('machineService.sendCommand('),
  'ExecutionCoordinator does not call machineService.sendCommand for command emission',
);
assert(
  !source.includes('sendSetOriginWcsCommand('),
  'ExecutionCoordinator set-origin does not route through the helper raw controller path',
);
assert(source.includes('ctrl.operations.unlockAlarm({'), 'ExecutionCoordinator unlock routes through operations API');
assert(source.includes('ctrl.operations.home({'), 'ExecutionCoordinator home routes through operations API');
assert(
  source.includes('ctrl.operations.setWorkOriginAtCurrentPosition({'),
  'ExecutionCoordinator set-origin routes through operations API',
);
assert(source.includes('onCommand: line => this.notifySimulator(line)'), 'ExecutionCoordinator gets simulator lines from operation observers');
