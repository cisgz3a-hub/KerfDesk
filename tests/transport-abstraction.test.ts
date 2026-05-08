/**
 * T3-45: transport abstraction layer foundation.
 *
 * Run: npx tsx tests/transport-abstraction.test.ts
 */

import { readFileSync } from 'node:fs';
import { MockSerialPort } from '../src/communication/SerialPort';
import { WebSerialPort } from '../src/communication/WebSerialPort';
import {
  isByteTransport,
  isHttpJobTransport,
  isLineTransport,
  type ByteTransport,
  type HttpJobTransport,
  type LineTransport,
  type TransportCapabilities,
  type TransportJobHandle,
} from '../src/transports/Transport';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  OK ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

function acceptsLineTransport(transport: LineTransport): LineTransport {
  return transport;
}

function makeCapabilities(overrides: Partial<TransportCapabilities>): TransportCapabilities {
  return {
    line: false,
    byte: false,
    httpJob: false,
    realtimeByte: false,
    criticalWrites: false,
    ...overrides,
  };
}

async function main(): Promise<void> {
  console.log('\n=== T3-45 transport abstraction ===\n');

  const mock = new MockSerialPort();
  const web = new WebSerialPort();
  const mockLine = acceptsLineTransport(mock);
  const webLine = acceptsLineTransport(web);

  assert(mockLine.kind === 'mock-serial', 'MockSerialPort declares mock-serial transport kind');
  assert(webLine.kind === 'web-serial', 'WebSerialPort declares web-serial transport kind');
  assert(isLineTransport(mockLine), 'MockSerialPort satisfies LineTransport runtime guard');
  assert(isLineTransport(webLine), 'WebSerialPort satisfies LineTransport runtime guard');
  assert(mockLine.capabilities.line === true, 'MockSerialPort exposes line capability');
  assert(webLine.capabilities.line === true, 'WebSerialPort exposes line capability');
  assert(webLine.capabilities.userGestureOpenRequired === true, 'WebSerialPort marks user-gesture open requirement');
  assert(mockLine.capabilities.httpJob === false, 'MockSerialPort does not claim HTTP job upload');

  const seen: string[] = [];
  const unsubscribeLine = mock.onLine(line => seen.push(line));
  await mock.open();
  await Promise.resolve();
  assert(seen.some(line => line.startsWith('Grbl 1.1')), 'onLine receives mock GRBL banner');

  await mock.writeLine('$X');
  await Promise.resolve();
  assert(mock.received.includes('$X'), 'writeLine routes through legacy line writer');

  const countBeforeUnsubscribe = seen.length;
  unsubscribeLine();
  mock.injectResponse('ok-after-unsubscribe');
  await Promise.resolve();
  assert(seen.length === countBeforeUnsubscribe, 'LineTransport unsubscribe detaches line listener');

  let byteSink: Uint8Array | null = null;
  const byteTransport: ByteTransport = {
    kind: 'usb-binary',
    capabilities: makeCapabilities({ byte: true, criticalWrites: true }),
    isOpen: false,
    open: async () => {},
    close: async () => {},
    onError: () => () => {},
    onClose: () => () => {},
    writeBytes: async bytes => { byteSink = bytes; },
    onBytes: () => () => {},
  };
  assert(isByteTransport(byteTransport), 'ByteTransport runtime guard accepts byte transport');
  await byteTransport.writeBytes(new Uint8Array([1, 2, 3]));
  assert(byteSink?.[2] === 3, 'ByteTransport writeBytes contract carries bytes');
  assert(!isLineTransport(byteTransport), 'ByteTransport does not masquerade as LineTransport');

  let uploadedSize = 0;
  const httpTransport: HttpJobTransport = {
    kind: 'http',
    capabilities: makeCapabilities({ httpJob: true }),
    isOpen: false,
    open: async () => {},
    close: async () => {},
    onError: () => () => {},
    onClose: () => () => {},
    uploadJob: async (job, metadata): Promise<TransportJobHandle> => {
      uploadedSize = job instanceof Uint8Array ? job.byteLength : metadata.sizeBytes ?? 0;
      return { id: 'job-1' };
    },
    startJob: async () => {},
    stopJob: async () => {},
  };
  assert(isHttpJobTransport(httpTransport), 'HttpJobTransport runtime guard accepts job upload transport');
  await httpTransport.uploadJob(new Uint8Array([4, 5]), { outputHash: 'abc' });
  assert(uploadedSize === 2, 'HttpJobTransport uploadJob contract receives binary payloads');
  assert(!isByteTransport(httpTransport), 'HttpJobTransport does not masquerade as ByteTransport');

  const transportSource = readFileSync('src/transports/Transport.ts', 'utf8');
  const serialSource = readFileSync('src/communication/SerialPort.ts', 'utf8');
  const webSource = readFileSync('src/communication/WebSerialPort.ts', 'utf8');

  assert(transportSource.includes('T3-45'), 'Transport.ts carries T3-45 marker');
  assert(transportSource.includes('export interface LineTransport'), 'LineTransport is exported');
  assert(transportSource.includes('export interface ByteTransport'), 'ByteTransport is exported');
  assert(transportSource.includes('export interface HttpJobTransport'), 'HttpJobTransport is exported');
  assert(transportSource.includes('export function isLineTransport'), 'LineTransport runtime guard is exported');
  assert(/implements\s+SerialPortLike/.test(serialSource), 'MockSerialPort remains a SerialPortLike');
  assert(serialSource.includes('writeLine(line: string)'), 'MockSerialPort implements writeLine');
  assert(webSource.includes('writeLine(line: string)'), 'WebSerialPort implements writeLine');
  assert(webSource.includes("kind = 'web-serial'"), 'WebSerialPort source declares web-serial kind');

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

void main().catch(err => {
  failed++;
  console.error(err);
  process.exitCode = 1;
});
