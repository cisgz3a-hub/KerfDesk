import { MachineCommandGateway } from '../src/app/MachineCommandGateway';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function createController() {
  const sent: Array<{ command: string; source?: 'internal' | 'user' }> = [];
  return {
    sent,
    controller: {
      sendCommand(command: string, source?: 'internal' | 'user') {
        sent.push({ command, source });
      },
    },
  };
}

async function run(): Promise<void> {
  {
    const { controller, sent } = createController();
    const gateway = new MachineCommandGateway(controller);

    gateway.sendCommand('G0 X1', 'internal');
    assert(sent.length === 1, 'sendCommand delegates exactly once');
    assert(sent[0]?.command === 'G0 X1', 'sendCommand preserves command');
    assert(sent[0]?.source === 'internal', 'sendCommand preserves internal source');
  }

  {
    const { controller, sent } = createController();
    const gateway = new MachineCommandGateway(controller);

    gateway.sendCommand('G0 X1', 'user');
    assert(sent.length === 1, 'safe user command forwards without approval token');
    assert(sent[0]?.source === 'user', 'safe user command preserves user source');
  }

  {
    const { controller, sent } = createController();
    const gateway = new MachineCommandGateway(controller);
    let blocked: Error & { code?: string; blockReason?: string } | null = null;

    try {
      gateway.sendCommand('M3 S100', 'user');
    } catch (err: unknown) {
      blocked = err as Error & { code?: string; blockReason?: string };
    }

    assert(sent.length === 0, 'dangerous user command is not forwarded without approval token');
    assert(blocked?.code === 'COMMAND_BLOCKED', 'dangerous user command throws COMMAND_BLOCKED');
    assert(blocked?.blockReason === 'no-token', 'dangerous user command reports missing approval token');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
