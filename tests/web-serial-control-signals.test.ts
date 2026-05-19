import { strict as assert } from 'node:assert';
import { WebSerialPort } from '../src/communication/WebSerialPort';

async function main() {
  let openedAtBaud: number | null = null;
  let capturedSignals: unknown = null;
  const fakeReadable = new ReadableStream<Uint8Array>({
    start() {
      // Keep the stream open until WebSerialPort.close() cancels the reader.
    },
  });
  const fakeWritable = new WritableStream<Uint8Array>();
  const fakePort = {
    readable: fakeReadable,
    writable: fakeWritable,
    open: async (options: { baudRate: number }) => {
      openedAtBaud = options.baudRate;
    },
    close: async () => {},
    setSignals: async (signals: unknown) => {
      capturedSignals = signals;
    },
    getInfo: () => ({ usbVendorId: 1234, usbProductId: 5678 }),
  };

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      serial: {
        requestPort: async () => fakePort,
      },
    },
  });

  const port = new WebSerialPort();
  await port.requestAndOpen(230400, undefined, {
    dataTerminalReady: false,
    requestToSend: true,
  } as never);

  assert.equal(openedAtBaud, 230400);
  assert.deepEqual(capturedSignals, {
    dataTerminalReady: false,
    requestToSend: true,
  });

  await port.close();
  console.log('ok - WebSerial applies configured DTR/RTS control signals after open');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
