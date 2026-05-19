import { strict as assert } from 'node:assert';
import { MockSerialPort } from '../src/communication/SerialPort';
import { GrblController } from '../src/controllers/grbl/GrblController';

function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function makeHandshakePort(): MockSerialPort {
  return new MockSerialPort(line => {
    if (line === '$I') return ['[VER:1.1h.20250101:LaserForge]', '[OPT:V,15,128]', 'ok'];
    if (line === '$$') return ['$10=0', '$30=1000', '$31=0', '$32=1', 'ok'];
    if (line === '$#') return ['[G54:0.000,0.000,0.000]', 'ok'];
    return ['ok'];
  });
}

async function main() {
  const port = makeHandshakePort();
  await port.open({ baudRate: 115200 });
  const controller = new GrblController();
  await controller.connect(port);
  await flush();

  const sent: string[] = [];
  const result = await controller.operations.jog({
    axis: 'X',
    distanceMm: 5,
    feedMmPerMin: 1000,
    mode: 'legacy-gcode',
    onCommand: (line: string) => sent.push(line),
  } as never);

  assert.equal(result.ok, true, `legacy jog should be accepted: ${JSON.stringify(result)}`);
  assert(!sent.some(line => line.startsWith('$J=')), `legacy jog must not emit $J commands: ${JSON.stringify(sent)}`);
  assert.deepEqual(sent, [
    'G91 G21',
    'G0 X5 F1000',
    'G90',
  ]);

  await controller.disconnect();
  console.log('ok - legacy jog mode emits G-code fallback instead of $J');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
