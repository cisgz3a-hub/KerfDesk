import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { start } from './support.mjs';

/** Test-only storage/clock/fault witness around the actual production bundle. Never deployed. */
export function startControlWorker(options = {}) {
  let source = readFileSync(new URL('../dist/index.js', import.meta.url), 'utf8');
  assert.equal(source.includes('ControlAuditDevice'), false);
  if (options.timeoutMs !== undefined) {
    assert.equal(source.includes('var COMMAND_TIMEOUT_MS = 2e4;'), true);
    source = source.replace(
      'var COMMAND_TIMEOUT_MS = 2e4;',
      `var COMMAND_TIMEOUT_MS = ${options.timeoutMs};`,
    );
  }
  const script =
    'let controlAuditOffset = 0; const controlActualNow = Date.now.bind(Date); Date.now = () => controlActualNow() + controlAuditOffset;\n' +
    source +
    `\n
class ControlAuditDevice extends RemoteDevice {
  auditControl(action, data = {}) {
    if (action === 'records') return {
      records: [...this.ctx.storage.kv.list({ prefix: 'control-action:v1:' })],
      counts: [...this.ctx.storage.kv.list({ prefix: 'control-count:v1:' })],
      clients: (this.ctx.storage.kv.get('device')?.clients ?? []).map(({ id, leaseId, scopes }) => ({ id, leaseId, scopes }))
    };
    if (action === 'quota') {
      const client = this.ctx.storage.kv.get('device')?.clients.find(item => item.id === data.clientId);
      if (!client) throw new Error('Synthetic client missing');
      this.ctx.storage.kv.put('control-count:v1:' + data.clientId, { leaseId: client.leaseId, ordinary: data.ordinary, abort: data.abort });
      return true;
    }
    if (action === 'reserve-wire') {
      const client = this.ctx.storage.kv.get('device')?.clients.find(item => item.id === data.clientId);
      if (!client) throw new Error('Synthetic client missing');
      return this.beginMcpRequest({ deviceId: data.deviceId, clientId: client.id, leaseId: client.leaseId }, data.scopes, data.key, data.priority);
    }
    if (action === 'advance') { controlAuditOffset = data.offset; return true; }
    if (action === 'reset') this.ctx.abort('Synthetic control object restart');
    if (action === 'revoke-crash') {
      this.ctx.storage.kv.put('audit:control-crash', true);
      this.revoke(data.clientId);
      return true;
    }
    if (action === 'clear-crash') { this.ctx.storage.kv.delete('audit:control-crash'); return true; }
    throw new Error('Invalid synthetic control audit action');
  }
  revokePending(clientId) {
    super.revokePending(clientId);
    if (this.ctx.storage.kv.get('audit:control-crash')) this.ctx.abort('Synthetic crash inside atomic control revocation');
  }
}
export { ControlAuditDevice };\n`;
  return start({
    extra: {
      script,
      scriptPath: undefined,
      durableObjects: { REMOTE_DEVICES: { className: 'ControlAuditDevice', useSQLite: true } },
    },
  });
}

export async function controlWitness(worker, deviceId, action, data = {}) {
  const namespace = await worker.getDurableObjectNamespace('REMOTE_DEVICES');
  return namespace.get(namespace.idFromName(deviceId)).auditControl(action, data);
}

export function operationReceipt(command, state = 'accepted') {
  return {
    revision: command.command.args.expectedRevision ?? 'audit-1',
    operation: {
      operationId: command.command.args.requestId,
      revision: command.command.args.expectedRevision ?? 'audit-1',
      kind:
        command.command.name === 'jog_machine'
          ? 'jog'
          : command.command.name === 'frame_job'
            ? 'frame'
            : command.command.name === 'abort_job'
              ? 'abort'
              : 'job',
      state,
      committed: state === 'running',
    },
  };
}

export async function admitControl(desktop, phone, name, args, resultFor = operationReceipt) {
  const pending = phone.post('/api/client/command', { name, args });
  const command = await desktop.inbox.next('command');
  desktop.send({ type: 'result', requestId: command.requestId, result: resultFor(command) });
  const response = await pending;
  assert.equal(response.status, 200);
  return { command, result: (await response.json()).result };
}
