import { readFileSync } from 'node:fs';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const serviceSource = readFileSync('src/app/MachineService.ts', 'utf8');
const gatewaySource = readFileSync('src/app/MachineCommandGateway.ts', 'utf8');

assert(
  serviceSource.includes("} from './MachineCommandGateway';")
    && serviceSource.includes('MachineCommandGateway'),
  'MachineService imports MachineCommandGateway',
);
assert(
  serviceSource.includes('.sendCommand(command, source, approvalToken,'),
  'MachineService.sendCommand delegates command forwarding and approval policy to gateway',
);
assert(
  !serviceSource.includes('private blockUserCommand('),
  'MachineService no longer owns the approval-token block decision',
);
assert(
  gatewaySource.includes('private blockUserCommand('),
  'MachineCommandGateway owns the approval-token block decision',
);
assert(
  gatewaySource.includes('classifyUserGrbl(command)'),
  'MachineCommandGateway classifies user commands before forwarding',
);
assert(
  gatewaySource.includes("this.controller.sendCommand(command, source)"),
  'MachineCommandGateway remains the single controller.sendCommand forwarding point',
);
