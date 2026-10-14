import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ORIGIN, start, connectDesktop, pairPhone, authorizeMcp } from './support.mjs';
import { closeSocket } from './post-release-support.mjs';

function startWitness() {
  const source = readFileSync(new URL('../dist/index.js', import.meta.url), 'utf8');
  return start({
    extra: {
      scriptPath: undefined,
      script: `${source}
class WaitAuditDevice extends RemoteDevice {
  auditWaitState() { return { waits: this.live.waiters.size, pending: this.pending.size, active: this.mcpRequests.active.size }; }
}
export { WaitAuditDevice };`,
      durableObjects: { REMOTE_DEVICES: { className: 'WaitAuditDevice', useSQLite: true } },
    },
  });
}

function mcpPost(worker, credentials, message) {
  return worker.dispatchFetch(`${ORIGIN}/mcp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credentials.access_token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-11-25',
    },
    body: JSON.stringify(message),
  });
}
const waitTool = (id) => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: {
    name: 'wait_for_change',
    arguments: { sinceRevision: 'rev-1', sinceMachineSeq: 1, timeoutMs: 15000 },
  },
});
async function untilState(stub, predicate, message) {
  const deadline = Date.now() + 1500;
  let state;
  do {
    state = await stub.auditWaitState();
    if (predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 10));
  } while (Date.now() < deadline);
  assert.fail(`${message}: ${JSON.stringify(state)}`);
}
async function setup(worker) {
  const desktop = await connectDesktop(worker);
  const phone = await pairPhone(worker, desktop, ['read']);
  const namespace = await worker.getDurableObjectNamespace('REMOTE_DEVICES');
  const stub = namespace.get(namespace.idFromName(desktop.deviceId));
  desktop.send({ type: 'changed', revision: 'rev-1', machineSeq: 1 });
  // A second owner message provides a deterministic barrier for the observed counters.
  desktop.send({ type: 'pair.create', requestId: crypto.randomUUID() });
  await desktop.inbox.next('pair.offer');
  return { desktop, phone, stub };
}

test('workerd: cancelling an MCP wait releases it promptly and fences late changes', async () => {
  const worker = startWitness();
  let desktop;
  try {
    const context = await setup(worker);
    ({ desktop } = context);
    const { phone, stub } = context;
    const credentials = await authorizeMcp(worker, phone, 'kerfdesk:read');
    const response = await mcpPost(worker, credentials, waitTool(10));
    const body = response.text();
    await untilState(stub, (state) => state.waits === 1, 'Wait was not registered');
    const cancelled = await mcpPost(worker, credentials, {
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: 10 },
    });
    assert.equal(cancelled.status, 202);
    await untilState(
      stub,
      (state) => state.waits === 0 && state.active === 0,
      'Cancelled wait retained',
    );
    desktop.send({ type: 'changed', revision: 'rev-2', machineSeq: 2 });
    const text = await body;
    assert.match(text, /The request was cancelled/);
    assert.doesNotMatch(text, /rev-2/);
    assert.equal(
      desktop.inbox.queue.some((item) => item.type === 'command' || item.type === 'cancel'),
      false,
    );
  } finally {
    closeSocket(desktop?.socket);
    await worker.dispose();
  }
});

test('workerd: a pre-cancelled MCP reservation cannot read relay change counters', async () => {
  const worker = startWitness();
  let desktop;
  try {
    const context = await setup(worker);
    ({ desktop } = context);
    const { phone, stub } = context;
    const session = await stub.session(
      phone.clientId,
      createHash('sha256').update(phone.cookie.split('.').at(-1)).digest('hex'),
    );
    const props = {
      deviceId: desktop.deviceId,
      clientId: phone.clientId,
      leaseId: session.leaseId,
    };
    const key = createHash('sha256').update('wait-pre-cancel').digest('hex');
    const reservation = { key, id: await stub.beginMcpRequest(props, ['read'], key) };
    await stub.cancelMcpRequest(props, ['read'], key);
    const response = JSON.parse(
      await stub.runCommand(
        props,
        ['read'],
        crypto.randomUUID(),
        JSON.stringify({ name: 'wait_for_change', args: { sinceRevision: 'rev-0', timeoutMs: 0 } }),
        undefined,
        reservation,
      ),
    );
    assert.equal(response.error?.code, 'cancelled');
    assert.equal(response.result, null);
    await stub.endMcpRequest(props, reservation);
  } finally {
    closeSocket(desktop?.socket);
    await worker.dispose();
  }
});

for (const transition of ['revoked', 'replaced'])
  test(`workerd: a ${transition} connection promptly ends its pending phone wait`, async () => {
    const worker = startWitness();
    let desktop;
    let replacement;
    try {
      const context = await setup(worker);
      ({ desktop } = context);
      const { phone, stub } = context;
      const waiting = phone.post('/api/client/command', {
        name: 'wait_for_change',
        args: waitTool(0).params.arguments,
      });
      await untilState(stub, (state) => state.waits === 1, 'Wait was not registered');
      if (transition === 'revoked') await phone.post('/api/client/revoke', {});
      else
        replacement = await connectDesktop(worker, {
          deviceId: desktop.deviceId,
          ownerSecret: desktop.ownerSecret,
        });
      await untilState(stub, (state) => state.waits === 0, 'Ended connection retained wait');
      const response = await (await waiting).json();
      assert.equal(response.error?.code, transition === 'revoked' ? 'cancelled' : 'unavailable');
      assert.equal('result' in response, false);
    } finally {
      closeSocket(desktop?.socket);
      closeSocket(replacement?.socket);
      await worker.dispose();
    }
  });
