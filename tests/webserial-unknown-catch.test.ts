/**
 * T1-233: WebSerialPort catch paths must treat thrown values as unknown.
 *
 * Browser stream/writer promises can reject with non-Error values. The adapter
 * should keep diagnostic value instead of assuming `.message` exists.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { messageFromUnknownError, WebSerialPort } from '../src/communication/WebSerialPort';
import { FakeNavigatorSerial } from './harness/fakeWebSerial';

function waitForMicrotasks(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

test('messageFromUnknownError preserves useful non-Error diagnostics', () => {
  assert.equal(messageFromUnknownError(new Error('native boom')), 'native boom');
  assert.equal(messageFromUnknownError('string boom'), 'string boom');
  assert.equal(messageFromUnknownError(7), '7');
  assert.equal(messageFromUnknownError({ message: () => 'not a string' }), '[object Object]');
  assert.equal(
    messageFromUnknownError({ toString() { throw new Error('toString failed'); } }),
    'Unknown error',
  );
});

test('read loop reports string rejections instead of undefined message text', async () => {
  const fake = new FakeNavigatorSerial();
  fake.installAsGlobal();
  try {
    const port = fake.preparePort();
    const ws = new WebSerialPort();
    let errorMessage = '';
    ws.onError(error => { errorMessage = error.message; });

    await ws.requestAndOpen(115200);
    port.scheduleReaderFault('reader string fault', 0);
    await waitForMicrotasks();
    await waitForMicrotasks();

    assert.equal(errorMessage, 'Read error: reader string fault');
  } finally {
    fake.removeFromGlobal();
  }
});

test('fire-and-forget write reports non-Error rejections as Error objects', async () => {
  const fake = new FakeNavigatorSerial();
  fake.installAsGlobal();
  try {
    const port = fake.preparePort();
    const ws = new WebSerialPort();
    let errorMessage = '';
    ws.onError(error => { errorMessage = error.message; });

    await ws.requestAndOpen(115200);
    port.rejectNextWriteFault('write string fault');
    ws.write('G0 X1\n');
    await waitForMicrotasks();

    assert.equal(errorMessage, 'write string fault');
    await ws.close();
  } finally {
    fake.removeFromGlobal();
  }
});

test('source does not reintroduce any-typed WebSerial catch handlers', () => {
  const src = readFileSync('src/communication/WebSerialPort.ts', 'utf8');
  assert.doesNotMatch(src, /catch\s*\(\s*e:\s*any\s*\)/);
  assert.doesNotMatch(src, /\.catch\(\(e:\s*Error\)/);
  assert.match(src, /catch\s*\(\s*e:\s*unknown\s*\)/);
  assert.match(src, /messageFromUnknownError\(e\)/);
});
