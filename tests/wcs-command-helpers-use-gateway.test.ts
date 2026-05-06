import { readFileSync } from 'node:fs';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

for (const file of ['src/app/sendSetOriginWcsCommand.ts', 'src/app/sendResetWcsCommand.ts']) {
  const source = readFileSync(file, 'utf8');
  assert(source.includes("import { MachineCommandGateway } from './MachineCommandGateway';"), `${file} imports MachineCommandGateway`);
  assert(source.includes('new MachineCommandGateway(controller)'), `${file} creates a gateway from the controller`);
  assert(!source.includes('controller.sendCommand('), `${file} does not call controller.sendCommand directly`);
}
