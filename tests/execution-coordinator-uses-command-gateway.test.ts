import { readFileSync } from 'node:fs';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const source = readFileSync('src/app/ExecutionCoordinator.ts', 'utf8');

assert(
  source.includes("import { MachineCommandGateway } from './MachineCommandGateway';"),
  'ExecutionCoordinator imports MachineCommandGateway',
);
assert(!source.includes('ctrl.sendCommand('), 'ExecutionCoordinator does not call ctrl.sendCommand directly');
assert(
  !source.includes('machineService.sendCommand('),
  'ExecutionCoordinator does not call machineService.sendCommand for command emission',
);
assert(
  !source.includes('sendSetOriginWcsCommand('),
  'ExecutionCoordinator set-origin routes through gateway, not the helper raw controller path',
);
assert(source.includes('new MachineCommandGateway(ctrl)'), 'ExecutionCoordinator creates a gateway from the current controller');
