/**
 * T3-16: a running GRBL job must detect cable-pull style status silence,
 * not only explicit port close / write-failure events.
 *
 * Run: npx tsx tests/webserial-cable-pull-heartbeat.test.ts
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

function flush(ms = 20): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function connectController(controller: GrblController, port: MockSerialPort): Promise<void> {
  port.open();
  await controller.connect(port);
  await flush(80);
}

async function run(): Promise<void> {
  console.log('\n=== T3-16 cable-pull heartbeat recovery ===\n');

  // A long-running controller can acknowledge normal streamed G-code while
  // missing realtime status replies. `ok` traffic proves the transport is
  // alive; the heartbeat must not disconnect a healthy burn just because the
  // `<Run|...>` report was delayed or suppressed.
  {
    const controller = new GrblController();
    const port = new MockSerialPort();
    const errors: string[] = [];
    controller.onError((_code, message) => errors.push(message));

    await connectController(controller, port);

    const moves = Array.from({ length: 40 }, (_v, i) => `G1 X${i + 1} F60`);
    await controller.sendJob([
      'G21',
      'G90',
      'M4 S100',
      ...moves,
      'M5',
    ]);
    assert(controller.isJobRunning, 'long job is running before status-only silence');

    port.blockStatusQueryResponse = true;
    await flush(1100);

    assert(controller.isJobRunning, 'ok acknowledgements keep the running-job heartbeat alive');
    assert(controller.state.status !== 'disconnected',
      `ok acknowledgements prevent false disconnect (got ${controller.state.status})`);
    assert(errors.every(message => !/status heartbeat/i.test(message)),
      'no status-heartbeat error is emitted while ok acknowledgements are flowing');

    port.blockStatusQueryResponse = false;
    await controller.disconnect();
  }

  {
    const controller = new GrblController();
    const port = new MockSerialPort((line) => {
      if (line === '$$') return ['$30=1000', '$32=1', 'ok'];
      return [];
    });
    const errors: string[] = [];
    const states: string[] = [];
    controller.onError((_code, message) => errors.push(message));
    controller.onStateChange(state => states.push(state.status));

    await connectController(controller, port);

    await controller.sendJob([
      'G21',
      'G90',
      'M4 S100',
      'G1 X10 F500',
      'G1 X20 F500',
      'M5',
    ]);
    assert(controller.isJobRunning, 'job is running before heartbeat silence');

    port.blockStatusQueryResponse = true;
    await flush(1800);

    assert(controller.isJobRunning, 'delayed status heartbeat warns but keeps the active job alive');
    assert(controller.state.status !== 'disconnected',
      `delayed status heartbeat does not disconnect immediately (got ${controller.state.status})`);
    assert(port.isOpen, 'delayed status heartbeat keeps the port open');
    assert(errors.some(message => /status heartbeat delayed/i.test(message) && /running job/i.test(message)),
      'warning message names delayed heartbeat without declaring transport failure');
    assert(errors.every(message => !/Status polling failed/i.test(message)),
      'delayed status heartbeat does not emit a failed-polling transport error');

    await flush(7000);

    assert(!controller.isJobRunning, 'hard controller silence aborts the active job');
    assert(controller.state.status === 'disconnected',
      `hard controller silence disconnects controller (got ${controller.state.status})`);
    assert(!port.isOpen, 'hard controller silence closes the failed port');
    assert(states.includes('disconnected'), 'state listeners see the disconnected transition after hard silence');
    assert(errors.some(message => /controller silent/i.test(message) && /running job/i.test(message)),
      'hard-abort message names controller silence during running job');
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(resolve(here, '../src/controllers/grbl/GrblController.ts'), 'utf-8');
  const start = source.indexOf('T3-16');
  const body = start >= 0 ? source.slice(start, source.indexOf('// ─── POST-CONNECT MACHINE SETTINGS', start)) : '';
  assert(body.length > 0, 'GrblController carries a T3-16 cable-pull heartbeat marker');
  assert(/JOB_STATUS_REPLY_WARN_MS\s*=\s*1500/.test(source),
    'delayed status heartbeat warns after a human-visible grace period');
  assert(/JOB_NO_RX_ABORT_MS\s*=\s*8000/.test(source),
    'hard disconnect requires sustained controller RX silence, not two late status replies');
  assert(/_handleJobStatusHeartbeatTimeout/.test(body),
    'controller has a dedicated job heartbeat timeout handler');
  assert(/_recordJobStatusHeartbeatResponse\(\);\s*this\._handleOk\(\);/s.test(source),
    'job heartbeat treats normal ok acknowledgements as controller-alive traffic');
  assert(/_recordControllerRx\(\);/.test(source),
    'controller tracks last RX time for any GRBL response line');
  assert(/this\._handleTransportDisconnect\(true\)/.test(body),
    'hard controller silence uses the same failed-transport disconnect path');

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

void run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
