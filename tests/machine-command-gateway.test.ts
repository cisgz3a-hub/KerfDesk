import { MachineCommandGateway } from '../src/app/MachineCommandGateway';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function createController() {
  const sent: Array<{ command: string; source?: 'internal' | 'user' }> = [];
  let safetyOffCalls = 0;
  return {
    sent,
    get safetyOffCalls() {
      return safetyOffCalls;
    },
    controller: {
      sendCommand(command: string, source?: 'internal' | 'user') {
        sent.push({ command, source });
      },
      async safetyOff() {
        safetyOffCalls += 1;
        return { stage: 'm5' as const };
      },
    },
  };
}

async function run(): Promise<void> {
  {
    const { controller, sent } = createController();
    const gateway = new MachineCommandGateway(controller);

    gateway.sendInternalCommand('$X');
    assert(sent.length === 1, 'sendInternalCommand delegates exactly once');
    assert(sent[0]?.command === '$X', 'sendInternalCommand preserves command');
    assert(sent[0]?.source === 'internal', 'sendInternalCommand marks source internal');
  }

  {
    const { controller, sent } = createController();
    const gateway = new MachineCommandGateway(controller);

    gateway.unlock();
    gateway.home();
    gateway.setOriginAtCurrentPosition();
    gateway.resetWcsToMachineOrigin();
    gateway.jog('X', 5, 1200);

    assert(
      sent.map(e => e.command).join('|') === '$X|$H|G10 L20 P1 X0 Y0|G10 L2 P1 X0 Y0 Z0|$J=G91 G21 X5 F1200',
      'operation helpers delegate expected command sequence',
    );
    assert(sent.every(e => e.source === 'internal'), 'operation helpers use internal source');
  }

  {
    const created = createController();
    const { controller } = created;
    const gateway = new MachineCommandGateway(controller);
    const result = await gateway.laserOff();

    assert(result.stage === 'm5', 'laserOff delegates to controller safetyOff');
    assert(created.safetyOffCalls === 1, 'laserOff calls safetyOff once');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
