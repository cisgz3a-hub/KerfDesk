import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ORIGIN, poster, start } from './support.mjs';

export const consentHash = (handle) => createHash('sha256').update(handle).digest('hex');

/** Control only storage visibility, scheduling and faults around the actual built production Worker. */
export function startConsentWorker(options = {}) {
  const source =
    options.source ?? readFileSync(new URL('../dist/index.js', import.meta.url), 'utf8');
  const matches = [...source.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*_default) as default/g)];
  assert.equal(matches.length, 1, 'The witness must wrap the real Worker default.');
  assert.equal(source.includes('__audit_consent'), false);
  const script =
    'let consentAuditOffset = 0; const consentActualNow = Date.now.bind(Date); Date.now = () => consentActualNow() + consentAuditOffset;\n' +
    source.replace(matches[0][0], 'consentAuditDefault as default') +
    `
const consentAuditSnapshots = new Map();
let consentAuditStale = false; let consentAuditFreshBinding = false;
let consentAuditKvFault = null; let consentAuditBarrier = null;
class ConsentAuditDevice extends RemoteDevice {
  auditConsent(action, data) {
    if (action === 'configure') {
      if (data.offset !== undefined) consentAuditOffset = data.offset;
      this.ctx.storage.kv.put('audit:consent-fault', data.deviceFault ?? null);
      return true;
    }
    if (action === 'reset') this.ctx.abort('Synthetic consent object restart');
    if (action === 'records') return [...this.ctx.storage.kv.list({ prefix: 'consent:v1:' })]
      .map(([key, value]) => ({ hash: key.slice('consent:v1:'.length), consumed: value.consumed, expiresAt: value.expiresAt }));
    if (action === 'resave') {
      const record = this.ctx.storage.kv.get('consent:v1:' + data.hash);
      if (!record) return null;
      const { consumed, ...binding } = record;
      return super.saveConsent(data.hash, binding);
    }
    if (action === 'forget') return this.ctx.storage.kv.delete('consent:v1:' + data.hash);
    throw new Error('Invalid synthetic consent action');
  }
  saveConsent(...args) {
    if (this.ctx.storage.kv.get('audit:consent-fault') === 'save') throw new Error('Synthetic consent save RPC outage');
    return super.saveConsent(...args);
  }
  consumeConsent(...args) {
    const fault = this.ctx.storage.kv.get('audit:consent-fault');
    if (fault === 'consume-before') throw new Error('Synthetic consent consume RPC outage');
    const result = super.consumeConsent(...args);
    if (fault === 'consume-after') throw new Error('Synthetic consent reply lost after storage write');
    return result;
  }
}
const consentAuditDefault = { async fetch(request, env, ctx) {
  if (new URL(request.url).pathname === '/__audit_consent') {
    const data = await request.json();
    if (data.action === 'configure') {
      consentAuditStale = data.stale ?? false;
      consentAuditFreshBinding = data.freshBinding ?? false;
      consentAuditKvFault = data.kvFault ?? null;
      if (![null, 'delete'].includes(consentAuditKvFault)) throw new Error('Invalid synthetic KV fault');
      if (![undefined, null, 'save', 'consume-before', 'consume-after'].includes(data.deviceFault)) throw new Error('Invalid synthetic device fault');
      if (data.offset !== undefined) {
        if (!Number.isSafeInteger(data.offset) || data.offset < 0 || data.offset > 86400000) throw new Error('Invalid synthetic clock');
        consentAuditOffset = data.offset;
      }
      if (data.barrier) {
        const { hash, count, manual } = data.barrier;
        if (!/^[a-f0-9]{64}$/.test(hash) || !Number.isInteger(count) || count < 1 || count > 8) throw new Error('Invalid synthetic barrier');
        consentAuditBarrier = { key: 'transaction:' + hash, count, manual: manual === true, reads: 0, resumes: [], released: false };
      }
      if (data.deviceId) await env.REMOTE_DEVICES.get(env.REMOTE_DEVICES.idFromName(data.deviceId)).auditConsent('configure', data);
      return Response.json({ changed: true });
    }
    if (data.action === 'barrier') return Response.json({ reads: consentAuditBarrier?.reads ?? 0 });
    if (data.action === 'release') {
      if (!consentAuditBarrier) throw new Error('No synthetic barrier');
      consentAuditBarrier.released = true;
      for (const resume of consentAuditBarrier.resumes) resume();
      return Response.json({ released: true });
    }
    const stub = env.REMOTE_DEVICES.get(env.REMOTE_DEVICES.idFromName(data.deviceId));
    try { return Response.json(await stub.auditConsent(data.action, data)); }
    catch { return Response.json({ unavailable: true }, { status: 503 }); }
  }
  const actual = env.OAUTH_KV;
  const OAUTH_KV = {
    async get(key, ...args) {
      const snapshot = consentAuditStale ? consentAuditSnapshots.get(key) : undefined;
      let value = snapshot === undefined ? await actual.get(key, ...args)
        : args[0] === 'json' ? JSON.parse(snapshot) : snapshot;
      if (consentAuditFreshBinding && key.startsWith('kerfdesk:consent-binding:v1:') && value)
        value = { ...value, expiresAt: Date.now() + 600000 };
      const barrier = consentAuditBarrier;
      if (barrier && barrier.key === key && !barrier.released) {
        barrier.reads++;
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Synthetic race barrier timed out')), 5000);
          barrier.resumes.push(() => { clearTimeout(timer); resolve(); });
          if (!barrier.manual && barrier.reads === barrier.count) {
            barrier.released = true;
            for (const resume of barrier.resumes) resume();
          }
        });
      }
      return value;
    },
    getWithMetadata(key, ...args) { return actual.getWithMetadata(key, ...args); },
    put(key, value, ...args) {
      if (key.startsWith('transaction:') || key.startsWith('kerfdesk:consent-binding:v1:'))
        consentAuditSnapshots.set(key, value);
      return actual.put(key, value, ...args);
    },
    delete(key) {
      if (consentAuditKvFault === 'delete' && key.startsWith('kerfdesk:consent-binding:v1:'))
        throw new Error('Synthetic consent cleanup outage');
      return actual.delete(key);
    },
    list(...args) { return actual.list(...args); }
  };
  return ${matches[0][1]}.fetch(request, { ...env, OAUTH_KV }, ctx);
} };
export { ConsentAuditDevice };
`;
  return start({
    extra: {
      scriptPath: undefined,
      script,
      durableObjects: { REMOTE_DEVICES: { className: 'ConsentAuditDevice', useSQLite: true } },
    },
  });
}

export async function consentAudit(worker, data) {
  return poster(worker)('/__audit_consent', data);
}

export async function configureConsent(worker, data = {}) {
  assert.equal((await consentAudit(worker, { action: 'configure', ...data })).status, 200);
}

export async function consentRecords(worker, deviceId) {
  const response = await consentAudit(worker, { action: 'records', deviceId });
  assert.equal(response.status, 200);
  return response.json();
}

export async function waitForConsentRead(worker) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await consentAudit(worker, { action: 'barrier' });
    if ((await response.json()).reads === 1) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('The provider never reached the controlled consent read.');
}

export async function phoneSession(worker, phone) {
  return worker.dispatchFetch(`${ORIGIN}/api/session`, { headers: { Cookie: phone.cookie } });
}
