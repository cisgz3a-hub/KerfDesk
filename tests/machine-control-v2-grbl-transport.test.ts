import { GrblTransportV2 } from '../src/machine-control-v2/grbl/GrblTransportV2';

const sent: string[] = [];
const transport = new GrblTransportV2({
  rxBufferSize: 20,
  write: async (data) => {
    sent.push(data);
  },
});

async function main(): Promise<void> {
  await transport.sendGcodeLine('G1 X1');
  const countAfterGcode = Number(transport.bufferCount);
  if (countAfterGcode !== 6) {
    throw new Error(
      `buffer count after G-code should be 6, got ${countAfterGcode}`,
    );
  }

  await transport.sendRealtime('!');
  const countAfterRealtime = Number(transport.bufferCount);
  if (countAfterRealtime !== 6) {
    throw new Error('realtime command must not count against buffer');
  }

  transport.acceptResponse('ok\n');
  const countAfterAck = Number(transport.bufferCount);
  if (countAfterAck !== 0) {
    throw new Error(
      `buffer count after ok should be 0, got ${countAfterAck}`,
    );
  }

  if (sent.join('|') !== 'G1 X1\n|!') {
    throw new Error(`wrong transcript: ${sent.join('|')}`);
  }
}

void main();
