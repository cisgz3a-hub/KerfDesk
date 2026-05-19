import { strict as assert } from 'node:assert';
import { MockSerialPort } from '../src/communication/SerialPort';
import { GrblController } from '../src/controllers/grbl/GrblController';

function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function makeHandshakePort(): MockSerialPort {
  return new MockSerialPort(line => {
    if (line === '$I') {
      return ['[VER:1.1h.20250101:LaserForge]', '[OPT:V,15,128]', 'ok'];
    }
    if (line === '$$') {
      return ['$10=0', '$30=1000', '$31=0', '$32=1', 'ok'];
    }
    if (line === '$#') {
      return ['[G54:0.000,0.000,0.000]', '[G55:0.000,0.000,0.000]', 'ok'];
    }
    return [];
  });
}

async function main() {
  const port = makeHandshakePort();
  await port.open({ baudRate: 115200 });
  const controller = new GrblController();
  await controller.connect(port);
  await flush();

  await controller.executeJob(
    {
      kind: 'gcode-lines',
      dialect: 'grbl',
      lines: ['G21', 'G90', 'G1 X1 F100', 'G1 X2', 'M5', 'M2'],
    },
    {
      ticketId: 'sync-ticket',
      sceneHash: 'scene',
      profileHash: 'profile',
      outputHash: 'output',
      transferMode: 'synchronous',
    } as never,
  );
  await flush();

  const jobWritesAfterStart = port.received.filter(line => ['G21', 'G90', 'G1 X1 F100', 'G1 X2', 'M5', 'M2'].includes(line));
  assert.deepEqual(
    jobWritesAfterStart,
    ['G21'],
    `synchronous mode must wait for ok before sending the next job line; got ${JSON.stringify(jobWritesAfterStart)}`,
  );

  port.injectResponse('ok');
  await flush();

  const jobWritesAfterFirstOk = port.received.filter(line => ['G21', 'G90', 'G1 X1 F100', 'G1 X2', 'M5', 'M2'].includes(line));
  assert.deepEqual(
    jobWritesAfterFirstOk,
    ['G21', 'G90'],
    `synchronous mode should advance exactly one line per ok; got ${JSON.stringify(jobWritesAfterFirstOk)}`,
  );

  for (let i = 0; i < 5; i++) {
    port.injectResponse('ok');
    await flush();
  }
  await controller.disconnect();

  console.log('ok - GRBL synchronous transfer mode sends one job line per ok');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
