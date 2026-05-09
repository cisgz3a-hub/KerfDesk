/**
 * T3-53: status-poll write failures must collapse into one transport-failure
 * transition instead of throwing from the interval forever.
 *
 * Run: npx tsx tests/poll-status-failure-normalized.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MockSerialPort } from '../src/communication/SerialPort';
import { GrblController } from '../src/controllers/grbl/GrblController';

let passed = 0;
let failed = 0;
function assert(condition: unknown, message: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

const flush = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

class PollFailingSerialPort extends MockSerialPort {
  failNextStatusWrite = false;

  override writeByte(byte: number): void {
    if (byte === 0x3F && this.failNextStatusWrite) {
      this.failNextStatusWrite = false;
      throw new Error('interval status byte write failed');
    }
    super.writeByte(byte);
  }
}

console.log('\n=== T3-53 status poll failure normalization ===\n');

async function run(): Promise<void> {
  const ctrl = new GrblController();
  const port = new MockSerialPort();
  port.open();
  await ctrl.connect(port);
  await flush(250);

  const errors: string[] = [];
  ctrl.onError((_code, message) => errors.push(message));

  const testController = ctrl as unknown as {
    _pollTimer: unknown;
    _handleStatusPollFailure?: (err: unknown) => void;
  };

  assert(typeof testController._handleStatusPollFailure === 'function',
    'controller exposes a private status-poll failure normalizer');

  testController._handleStatusPollFailure?.(new Error('status byte write failed'));
  await flush();

  assert(ctrl.state.status === 'disconnected',
    `poll failure transitions controller to disconnected (got ${ctrl.state.status})`);
  assert(testController._pollTimer === null,
    'poll failure stops the status-poll interval');
  assert(errors.length === 1,
    `poll failure emits exactly one controller error (got ${errors.length})`);
  assert(errors[0]?.includes('Status polling failed') === true,
    'controller error names status polling');
  assert(errors[0]?.includes('status byte write failed') === true,
    'controller error includes the original write failure');

  const intervalCtrl = new GrblController();
  const intervalPort = new PollFailingSerialPort();
  intervalPort.open();
  await intervalCtrl.connect(intervalPort);
  await flush(250);

  const intervalErrors: string[] = [];
  intervalCtrl.onError((_code, message) => intervalErrors.push(message));

  intervalPort.failNextStatusWrite = true;
  await flush(260);

  assert(intervalCtrl.state.status === 'disconnected',
    `real poll interval write failure disconnects controller (got ${intervalCtrl.state.status})`);
  assert(intervalErrors.length === 1,
    `real poll interval emits one normalized error (got ${intervalErrors.length})`);

  await flush(260);
  assert(intervalErrors.length === 1,
    'status polling remains stopped after the first failure');

  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(resolve(here, '../src/controllers/grbl/GrblController.ts'), 'utf-8');
  const start = source.indexOf('T3-53');
  const body = start >= 0 ? source.slice(start, source.indexOf('// ─── POST-CONNECT MACHINE SETTINGS', start)) : '';

  assert(body.length > 0, 'GrblController carries a T3-53 status-poll marker');
  assert(/private _pollStatus\(\): void/.test(body), 'polling is routed through _pollStatus');
  assert(/this\.requestStatusReport\(\)/.test(body), '_pollStatus still requests realtime status');
  assert(/catch \(err/.test(body) && /this\._handleStatusPollFailure\(err\)/.test(body),
    '_pollStatus catches write failures and normalizes them');
  assert(/this\._stopStatusPolling\(\)/.test(body),
    'failure normalizer stops polling');
  assert(/this\._handleTransportDisconnect\(true\)/.test(body),
    'failure normalizer closes the failed transport best-effort');

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
