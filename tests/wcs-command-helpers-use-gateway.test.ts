import { readFileSync } from 'node:fs';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

for (const file of ['src/app/sendSetOriginWcsCommand.ts', 'src/app/sendResetWcsCommand.ts']) {
  const source = readFileSync(file, 'utf8');
  assert(!source.includes("import { MachineCommandGateway } from './MachineCommandGateway';"), `${file} does not import MachineCommandGateway`);
  assert(!source.includes('new MachineCommandGateway(controller)'), `${file} does not create a gateway from the controller`);
  assert(!source.includes('controller.sendCommand('), `${file} does not call controller.sendCommand directly`);
  assert(source.includes('controller.operations.'), `${file} calls controller operations`);
}
