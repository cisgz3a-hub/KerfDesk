import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ORIGIN,
  start,
  connectDesktop,
  pairPhone,
  authorizeMcp,
  workspace,
  directFetcher,
} from './support.mjs';
import { closeSocket } from './post-release-support.mjs';

const tool = (id) => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: { name: 'get_workspace', arguments: {} },
});
const options = (credentials, message, signal) => ({
  method: 'POST',
  signal,
  headers: {
    Authorization: `Bearer ${credentials.access_token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': '2025-03-26',
  },
  body: JSON.stringify(message),
});

/** Local-only RPC fault/state witness around the real bundle, never a product route or binding. */
function startBatchWitness(direct = false) {
  const source = readFileSync(new URL('../dist/index.js', import.meta.url), 'utf8');
  assert.equal(source.includes('BatchAuditDevice'), false);
  const script =
    source +
    `
class BatchAuditDevice extends RemoteDevice {
  auditBeginCount = 0; auditEndCount = 0; auditFailAt = 0;
  auditBatch(action, value) {
    if (action === 'fail') { this.auditBeginCount = 0; this.auditFailAt = value; return true; }
    if (action === 'state') return {
      active: this.mcpRequests.active.size, pending: this.pending.size,
      begins: this.auditBeginCount, ends: this.auditEndCount
    };
    throw new Error('Invalid local batch audit action');
  }
  async beginMcpRequest(...args) {
    this.auditBeginCount++;
    if (this.auditBeginCount === this.auditFailAt) {
      this.auditFailAt = 0; throw new Error('Synthetic reservation RPC failure');
    }
    return super.beginMcpRequest(...args);
  }
  async endMcpRequest(...args) { this.auditEndCount++; return super.endMcpRequest(...args); }
}
export { BatchAuditDevice };
`;
  return start({
    extra: {
      scriptPath: undefined,
      script,
      durableObjects: { REMOTE_DEVICES: { className: 'BatchAuditDevice', useSQLite: true } },
      ...(direct
        ? { assets: undefined, unsafeDirectSockets: [{ host: '127.0.0.1', port: 0, proxy: true }] }
        : {}),
    },
  });
}
async function witness(worker, desktop) {
  const namespace = await worker.getDurableObjectNamespace('REMOTE_DEVICES');
  return namespace.get(namespace.idFromName(desktop.deviceId));
}
async function released(stub) {
  const deadline = Date.now() + 3000;
  let state;
  do {
    state = await stub.auditBatch('state');
    if (state.active === 0 && state.pending === 0) return state;
    await new Promise((resolve) => setTimeout(resolve, 20));
  } while (Date.now() < deadline);
  assert.fail(`Batch cleanup did not finish: ${JSON.stringify(state)}`);
}

test(
  'workerd: an exceptional third batch reservation rolls back the first two before dispatch',
  { timeout: 20_000 },
  async () => {
    const worker = startBatchWitness();
    let desktop;
    try {
      desktop = await connectDesktop(worker);
      const phone = await pairPhone(worker, desktop);
      const credentials = await authorizeMcp(worker, phone);
      const stub = await witness(worker, desktop);
      await stub.auditBatch('fail', 3);
      const batch = [tool(40), tool(41), tool(42)];
      const failed = await worker.dispatchFetch(`${ORIGIN}/mcp`, options(credentials, batch));
      assert.equal(failed.status, 503);
      await failed.text();
      const rollback = await stub.auditBatch('state');
      assert.deepEqual(
        {
          active: rollback.active,
          pending: rollback.pending,
          begins: rollback.begins,
          ends: rollback.ends,
        },
        { active: 0, pending: 0, begins: 3, ends: 2 },
      );
      assert.equal(
        desktop.inbox.queue.some((message) => message.type === 'command'),
        false,
      );
      const retry = await worker.dispatchFetch(`${ORIGIN}/mcp`, options(credentials, batch));
      assert.equal(retry.status, 200);
      for (let index = 0; index < batch.length; index++) {
        const command = await desktop.inbox.next('command');
        desktop.send({ type: 'result', requestId: command.requestId, result: workspace });
      }
      assert.equal((await retry.text()).match(/Synthetic audit workspace/g).length, 6);
      assert.equal((await released(stub)).ends, 5);
    } finally {
      closeSocket(desktop?.socket);
      await worker.dispose();
    }
  },
);

test(
  'workerd: closing a real legacy batch HTTP stream cancels every pending member and releases all associations',
  { timeout: 20_000 },
  async () => {
    const worker = startBatchWitness(true);
    let desktop;
    try {
      desktop = await connectDesktop(worker);
      const phone = await pairPhone(worker, desktop);
      const credentials = await authorizeMcp(worker, phone);
      const stub = await witness(worker, desktop);
      const fetch = await directFetcher(worker);
      const batch = Array.from({ length: 8 }, (_, index) => tool(index));
      const abort = new AbortController();
      const exchange = await fetch(`${ORIGIN}/mcp`, options(credentials, batch, abort.signal));
      assert.equal(exchange.status, 200);
      const commands = [];
      for (let index = 0; index < batch.length; index++)
        commands.push(await desktop.inbox.next('command'));
      const state = await stub.auditBatch('state');
      assert.equal(state.active, 8);
      assert.equal(state.pending, 8);
      const body = exchange.text();
      const rejected = assert.rejects(
        body,
        (error) => error.name === 'AbortError' || /aborted|premature|closed/i.test(error.message),
      );
      abort.abort();
      await rejected;
      const cancelled = [];
      for (let index = 0; index < batch.length; index++)
        cancelled.push((await desktop.inbox.next('cancel')).requestId);
      assert.deepEqual(new Set(cancelled), new Set(commands.map((command) => command.requestId)));
      assert.equal((await released(stub)).ends, 8);
      for (const command of commands)
        desktop.send({ type: 'result', requestId: command.requestId, result: workspace });
      const next = await fetch(`${ORIGIN}/mcp`, options(credentials, batch));
      assert.equal(next.status, 200);
      for (let index = 0; index < batch.length; index++) {
        const command = await desktop.inbox.next('command');
        desktop.send({ type: 'result', requestId: command.requestId, result: workspace });
      }
      assert.doesNotMatch(await next.text(), /The request was cancelled|not available/);
      assert.equal((await released(stub)).ends, 16);
    } finally {
      closeSocket(desktop?.socket);
      await worker.dispose();
    }
  },
);

test(
  'workerd: revoking a batch approval cancels all members and fences their late desktop results',
  { timeout: 20_000 },
  async () => {
    const worker = startBatchWitness();
    let desktop;
    try {
      desktop = await connectDesktop(worker);
      const phone = await pairPhone(worker, desktop);
      const credentials = await authorizeMcp(worker, phone);
      const stub = await witness(worker, desktop);
      const batch = [tool(80), tool(81), tool(82)];
      const exchange = await worker.dispatchFetch(`${ORIGIN}/mcp`, options(credentials, batch));
      assert.equal(exchange.status, 200);
      const commands = [];
      for (let index = 0; index < batch.length; index++)
        commands.push(await desktop.inbox.next('command'));
      const revoke = await phone.post('/api/client/revoke', {});
      assert.equal(revoke.status, 200);
      await revoke.text();
      const cancelled = [];
      for (let index = 0; index < batch.length; index++)
        cancelled.push((await desktop.inbox.next('cancel')).requestId);
      assert.deepEqual(new Set(cancelled), new Set(commands.map((command) => command.requestId)));
      for (const command of commands)
        desktop.send({ type: 'result', requestId: command.requestId, result: workspace });
      const text = await exchange.text();
      assert.doesNotMatch(text, /Synthetic audit workspace/);
      assert.match(text, /The request was cancelled/);
      await released(stub);
      assert.equal(
        (await worker.dispatchFetch(`${ORIGIN}/mcp`, options(credentials, batch))).status,
        401,
      );
    } finally {
      closeSocket(desktop?.socket);
      await worker.dispose();
    }
  },
);
