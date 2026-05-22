import { MachineOperationService } from '../src/machine-control-v2/MachineOperationService';
import { GRBL_REALTIME } from '../src/machine-control-v2/grbl/GrblRealtime';

const sent: string[] = [];
const service = new MachineOperationService({
  sendLine: async (line) => {
    sent.push(line);
  },
  sendRealtime: async (char) => {
    sent.push(char);
  },
});

async function main(): Promise<void> {
  await service.jog({
    kind: 'jog',
    axis: 'X',
    distanceMm: 5,
    feedMmPerMin: 1000,
  });
  await service.pause();
  await service.resume();
  await service.stop('operator requested');

  if (sent[0] !== '$J=G91 G21 X5 F1000') {
    throw new Error(`wrong jog: ${sent[0]}`);
  }
  if (!sent.includes(GRBL_REALTIME.feedHold)) {
    throw new Error('pause did not send feed hold');
  }
  if (!sent.includes(GRBL_REALTIME.cycleStart)) {
    throw new Error('resume did not send cycle start');
  }
  if (!sent.includes('M5')) {
    throw new Error('stop did not send laser off');
  }
  if (!sent.includes(GRBL_REALTIME.softReset)) {
    throw new Error('stop did not soft reset');
  }
}

void main();
