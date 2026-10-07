import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { connectDesktop, pairPhone } from './support.mjs';
import {
  admitControl,
  controlWitness,
  operationReceipt,
  startControlWorker,
} from './control-support.mjs';

const close = (desktop) => {
  if (desktop?.socket.readyState < 2) desktop.socket.close();
};
const jog = () => ({
  expectedRevision: 'audit-1',
  requestId: randomUUID(),
  axis: 'x',
  direction: 1,
  distanceMm: 1,
});

test('real workerd: admitted IDs survive object eviction and never replay across commands or changed payloads', async () => {
  const worker = startControlWorker();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop, ['read', 'control']);
    const args = jog();
    const admitted = await admitControl(desktop, phone, 'jog_machine', args);
    assert.equal(admitted.result.operation.state, 'accepted');
    let records = await controlWitness(worker, desktop.deviceId, 'records');
    assert.equal(records.records.length, 1);
    assert.equal(records.counts[0][1].ordinary, 1);
    await assert.rejects(controlWitness(worker, desktop.deviceId, 'reset'));
    close(desktop);
    desktop = await connectDesktop(worker, desktop);
    records = await controlWitness(worker, desktop.deviceId, 'records');
    assert.equal(records.records.length, 1);
    const repeated = await phone.post('/api/client/command', { name: 'jog_machine', args });
    assert.equal(repeated.status, 200);
    const result = (await repeated.json()).result;
    assert.equal(result.operation.operationId, args.requestId);
    assert.equal(result.operation.state, 'unknown');
    assert.equal(result.operation.committed, null);
    for (const command of [
      { name: 'jog_machine', args: { ...args, distanceMm: 2 } },
      {
        name: 'frame_job',
        args: { expectedRevision: args.expectedRevision, requestId: args.requestId },
      },
    ]) {
      const conflict = await phone.post('/api/client/command', command);
      assert.equal(conflict.status, 400);
      assert.equal((await conflict.json()).error.code, 'invalid_input');
    }
    assert.equal(
      desktop.inbox.queue.some((item) => item.type === 'command'),
      false,
    );
  } finally {
    close(desktop);
    await worker.dispose();
  }
});

test('real workerd: no desktop reply produces uncertainty, never a completed or safely cancelled action', async () => {
  const worker = startControlWorker({ timeoutMs: 100 });
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop, ['read', 'control']);
    const args = jog();
    const pending = phone.post('/api/client/command', { name: 'jog_machine', args });
    const sent = await desktop.inbox.next('command');
    const response = await pending;
    assert.equal(response.status, 200);
    const result = (await response.json()).result;
    assert.equal(result.operation.state, 'unknown');
    assert.equal(result.operation.committed, null);
    await desktop.inbox.next('cancel', (item) => item.requestId === sent.requestId);
    const repeat = await phone.post('/api/client/command', { name: 'jog_machine', args });
    assert.equal((await repeat.json()).result.operation.state, 'unknown');
    assert.equal(
      desktop.inbox.queue.some((item) => item.type === 'command'),
      false,
    );
  } finally {
    close(desktop);
    await worker.dispose();
  }
});

test('real workerd: independent Abort quota survives ordinary exhaustion and reserve exhaustion is explicit no-dispatch', async () => {
  const worker = startControlWorker();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop, ['read', 'control']);
    await controlWitness(worker, desktop.deviceId, 'quota', {
      clientId: phone.clientId,
      ordinary: 4096,
      abort: 0,
    });
    const denied = await phone.post('/api/client/command', { name: 'jog_machine', args: jog() });
    assert.equal((await denied.json()).error.code, 'control_limit');
    assert.equal(
      desktop.inbox.queue.some((item) => item.type === 'command'),
      false,
    );
    await admitControl(desktop, phone, 'abort_job', { requestId: randomUUID() });
    const records = await controlWitness(worker, desktop.deviceId, 'records');
    assert.equal(records.counts[0][1].ordinary, 4096);
    assert.equal(records.counts[0][1].abort, 1);
    await controlWitness(worker, desktop.deviceId, 'quota', {
      clientId: phone.clientId,
      ordinary: 4096,
      abort: 256,
    });
    const exhausted = await phone.post('/api/client/command', {
      name: 'abort_job',
      args: { requestId: randomUUID() },
    });
    const error = (await exhausted.json()).error;
    assert.equal(error.code, 'control_limit');
    assert.match(error.message, /No machine action was dispatched/);
    assert.equal(
      desktop.inbox.queue.some((item) => item.type === 'command'),
      false,
    );
  } finally {
    close(desktop);
    await worker.dispose();
  }
});

test('real workerd: persisted action metadata excludes reviewed artwork and a confirmed dispatch stays confirmed on replay', async () => {
  const worker = startControlWorker();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop, ['read', 'control']);
    const args = { expectedRevision: 'audit-1', requestId: randomUUID() };
    await admitControl(desktop, phone, 'review_machine_job', args, (command) => ({
      ...operationReceipt(command, 'awaiting_review'),
      operation: {
        ...operationReceipt(command, 'awaiting_review').operation,
        review: {
          reviewId: randomUUID(),
          revision: 'audit-1',
          mode: 'laser',
          stats: [{ label: 'PRIVATE ARTWORK', value: '1', detail: 'PRIVATE SOURCE TEXT' }],
          warnings: [{ code: 'material', message: 'PRIVATE ARTWORK' }],
          operations: [{ operationId: 'layer-1', summaries: ['PRIVATE OPERATION NAME'] }],
          acknowledgement: { kind: 'laser-verified' },
          frame: { required: true, complete: true },
        },
      },
    }));
    const records = await controlWitness(worker, desktop.deviceId, 'records');
    assert.doesNotMatch(
      JSON.stringify(records.records),
      /PRIVATE|"review"|"stats"|"warnings"|"summaries"|"message"|"gcode"|"args"/,
    );
    const startArgs = {
      expectedRevision: 'audit-1',
      requestId: randomUUID(),
      reviewId: randomUUID(),
    };
    await admitControl(desktop, phone, 'start_job', startArgs, (command) =>
      operationReceipt(command, 'running'),
    );
    const replay = await phone.post('/api/client/command', { name: 'start_job', args: startArgs });
    const operation = (await replay.json()).result.operation;
    assert.equal(operation.state, 'unknown');
    assert.equal(operation.committed, true);
    assert.equal(
      desktop.inbox.queue.some((item) => item.type === 'command'),
      false,
    );
  } finally {
    close(desktop);
    await worker.dispose();
  }
});

test('real workerd: expired leases purge metadata and cannot regain admitted IDs', async () => {
  const worker = startControlWorker();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop, ['read', 'control']);
    const args = jog();
    await admitControl(desktop, phone, 'jog_machine', args);
    await controlWitness(worker, desktop.deviceId, 'advance', { offset: 8 * 3600000 + 1 });
    const expired = await phone.post('/api/client/command', { name: 'jog_machine', args });
    assert.equal(expired.status, 401);
    const records = await controlWitness(worker, desktop.deviceId, 'records');
    assert.equal(records.records.length, 0);
    assert.equal(records.counts.length, 0);
    assert.equal(records.clients.length, 0);
  } finally {
    close(desktop);
    await worker.dispose();
  }
});

test('real workerd: a crash inside revocation cannot restore approval without its consumed IDs', async () => {
  const worker = startControlWorker();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop, ['read', 'control']);
    await admitControl(desktop, phone, 'jog_machine', jog());
    await assert.rejects(
      controlWitness(worker, desktop.deviceId, 'revoke-crash', { clientId: phone.clientId }),
    );
    const saved = await controlWitness(worker, desktop.deviceId, 'records');
    const approved = saved.clients.some((item) => item.id === phone.clientId);
    assert.equal(saved.records.length > 0, approved);
    assert.equal(saved.counts.length > 0, approved);
    await controlWitness(worker, desktop.deviceId, 'clear-crash');
    close(desktop);
    desktop = await connectDesktop(worker, desktop);
    desktop.send({ type: 'client.revoke', clientId: phone.clientId });
    await desktop.inbox.next('clients');
    const revoked = await controlWitness(worker, desktop.deviceId, 'records');
    assert.equal(revoked.records.length, 0);
    assert.equal(revoked.counts.length, 0);
    assert.equal(revoked.clients.length, 0);
  } finally {
    close(desktop);
    await worker.dispose();
  }
});

test('real workerd: unavailable desktop receipts preserve confirmed dispatch only for their own paired client', async () => {
  const worker = startControlWorker();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const first = await pairPhone(worker, desktop, ['read', 'control']);
    const second = await pairPhone(worker, desktop, ['read', 'control']);
    const args = {
      expectedRevision: 'audit-1',
      requestId: randomUUID(),
      reviewId: randomUUID(),
    };
    await admitControl(desktop, first, 'start_job', args, (command) =>
      operationReceipt(command, 'running'),
    );
    const lookup = { name: 'get_control_operation', args: { operationId: args.requestId } };
    for (const phone of [first, second]) {
      const request = phone.post('/api/client/command', lookup);
      const sent = await desktop.inbox.next('command');
      assert.equal(sent.clientId, phone.clientId);
      desktop.send({
        type: 'result',
        requestId: sent.requestId,
        result: {
          revision: 'audit-2',
          operation: {
            operationId: args.requestId,
            kind: 'job',
            state: 'unknown',
            revision: 'audit-2',
            committed: null,
          },
        },
      });
      const result = (await (await request).json()).result;
      assert.equal(result.operation.state, 'unknown');
      assert.equal(result.operation.committed, phone === first ? true : null);
      assert.equal(result.operation.revision, phone === first ? 'audit-1' : 'unconfirmed');
    }
    const closed = new Promise((resolve) => desktop.socket.addEventListener('close', resolve));
    close(desktop);
    await closed;
    const offline = await first.post('/api/client/command', lookup);
    assert.equal(offline.status, 200);
    const result = (await offline.json()).result;
    assert.equal(result.operation.state, 'unknown');
    assert.equal(result.operation.committed, true);
    assert.equal('review' in result.operation, false);
  } finally {
    close(desktop);
    await worker.dispose();
  }
});
