import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { start, connectDesktop, pairPhone } from './support.mjs';
import { closeSocket } from './post-release-support.mjs';
import { operationReceipt } from './control-support.mjs';

function startAdmissionWitness() {
  const source = readFileSync(new URL('../dist/index.js', import.meta.url), 'utf8');
  return start({
    extra: {
      scriptPath: undefined,
      script: `${source}
class AdmissionAuditDevice extends RemoteDevice {
  constructor(ctx, env) {
    super(ctx, env);
    const reserve = this.controlActions.reserve.bind(this.controlActions);
    this.controlActions.reserve = async (...args) => {
      await new Promise(resolve => { this.auditRelease = resolve; });
      return reserve(...args);
    };
  }
  auditAdmission(action) {
    if (action === 'waiting') return Boolean(this.auditRelease);
    if (action === 'release') { this.auditRelease?.(); this.auditRelease = undefined; return true; }
    throw new Error('Invalid local admission witness action');
  }
}
export { AdmissionAuditDevice };`,
      durableObjects: { REMOTE_DEVICES: { className: 'AdmissionAuditDevice', useSQLite: true } },
    },
  });
}

test('workerd: cancellation during durable control admission cannot later dispatch movement', async () => {
  const worker = startAdmissionWitness();
  let desktop;
  try {
    desktop = await connectDesktop(worker);
    const phone = await pairPhone(worker, desktop, ['read', 'control']);
    const namespace = await worker.getDurableObjectNamespace('REMOTE_DEVICES');
    const stub = namespace.get(namespace.idFromName(desktop.deviceId));
    const session = await stub.session(
      phone.clientId,
      createHash('sha256').update(phone.cookie.split('.').at(-1)).digest('hex'),
    );
    const props = {
      deviceId: desktop.deviceId,
      clientId: phone.clientId,
      leaseId: session.leaseId,
    };
    const sent = [];
    desktop.socket.addEventListener('message', (event) => {
      const command = JSON.parse(event.data);
      if (command.type !== 'command') return;
      sent.push(command);
      desktop.send({
        type: 'result',
        requestId: command.requestId,
        result: operationReceipt(command),
      });
    });
    const requestId = randomUUID();
    const result = stub.runCommand(
      props,
      ['read', 'control'],
      requestId,
      JSON.stringify({
        name: 'jog_machine',
        args: {
          requestId: randomUUID(),
          expectedRevision: 'audit-1',
          axis: 'x',
          direction: 1,
          distanceMm: 1,
        },
      }),
    );
    const deadline = Date.now() + 1500;
    while (!(await stub.auditAdmission('waiting'))) {
      assert.ok(Date.now() < deadline, 'Control admission did not start');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await stub.cancelCommand(phone.clientId, requestId);
    await stub.auditAdmission('release');
    const response = JSON.parse(await result);
    assert.equal(response.error?.code, 'cancelled');
    assert.equal(sent.length, 0, 'Cancelled admission must never reach the desktop');
  } finally {
    closeSocket(desktop?.socket);
    await worker.dispose();
  }
});
