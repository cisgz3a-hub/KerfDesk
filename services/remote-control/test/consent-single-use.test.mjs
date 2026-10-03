import assert from 'node:assert/strict';
import test from 'node:test';
import { connectDesktop, pairPhone } from './support.mjs';
import { closeSocket, prepareConsent, redeem } from './post-release-support.mjs';
import {
  configureConsent,
  consentAudit,
  consentHash,
  consentRecords,
  phoneSession,
  startConsentWorker,
  waitForConsentRead,
} from './consent-single-use-support.mjs';

const scopes = ['kerfdesk:read', 'kerfdesk:edit', 'offline_access'];

function scenario(name, run) {
  test(`single-use consent workerd: ${name}`, async () => {
    const worker = startConsentWorker();
    let desktop;
    try {
      desktop = await connectDesktop(worker);
      const phone = await pairPhone(worker, desktop);
      await run({ worker, desktop, phone });
    } finally {
      closeSocket(desktop?.socket);
      await worker.dispose();
    }
  });
}

async function requireToken(worker, consent, response) {
  assert.equal(response.status, 303);
  assert.equal((await redeem(worker, consent.tokenForm(response))).status, 200);
}

function oneDecision(results, count) {
  assert.equal(results.length, count);
  const redirects = results.filter((response) => response.status === 303);
  assert.equal(redirects.length, 1, 'Only one browser-validated decision may consume a consent.');
  assert.equal(results.filter((response) => response.status === 403).length, count - 1);
  return redirects[0];
}

scenario('two simultaneous Allow requests issue one redeemable code', async ({ worker, phone }) => {
  const consent = await prepareConsent(worker, phone);
  await configureConsent(worker, { barrier: { hash: consentHash(consent.handle), count: 2 } });
  const results = await Promise.all([consent.approve(), consent.approve()]);
  await requireToken(worker, consent, oneDecision(results, 2));
});

scenario(
  'eight valid concurrent Allow requests still issue only one code',
  async ({ worker, phone }) => {
    const consent = await prepareConsent(worker, phone);
    await configureConsent(worker, { barrier: { hash: consentHash(consent.handle), count: 8 } });
    const results = await Promise.all(Array.from({ length: 8 }, () => consent.approve()));
    await requireToken(worker, consent, oneDecision(results, 8));
  },
);

scenario(
  'Allow and Decline cannot both redirect from the same consent',
  async ({ worker, phone }) => {
    const consent = await prepareConsent(worker, phone);
    await configureConsent(worker, { barrier: { hash: consentHash(consent.handle), count: 2 } });
    const decision = oneDecision(await Promise.all([consent.approve(), consent.decline()]), 2);
    const callback = new URL(decision.headers.get('Location'));
    if (callback.searchParams.has('code')) await requireToken(worker, consent, decision);
    else assert.equal(callback.searchParams.get('error'), 'access_denied');
    assert.equal((await consent.approve()).status, 403);
  },
);

scenario(
  'simultaneous Decline requests consume once and return no code',
  async ({ worker, phone }) => {
    const consent = await prepareConsent(worker, phone);
    await configureConsent(worker, { barrier: { hash: consentHash(consent.handle), count: 2 } });
    const decision = oneDecision(await Promise.all([consent.decline(), consent.decline()]), 2);
    const callback = new URL(decision.headers.get('Location'));
    assert.equal(callback.searchParams.has('code'), false);
    assert.equal(callback.searchParams.get('error'), 'access_denied');
  },
);

scenario(
  'wrong browser and malformed forms leave the valid consent available',
  async ({ worker, desktop, phone }) => {
    const consent = await prepareConsent(worker, phone);
    const malformed = [
      () => consent.submit('allow', phone.cookie, scopes, [], ''),
      () => consent.submit('allow', phone.cookie, scopes, [], 'unrelated_browser=wrong'),
      () => consent.submit('unexpected', phone.cookie, scopes),
      () => consent.approve(phone.cookie, scopes, [['handle', consent.handle]]),
      () => consent.approve(phone.cookie, [...scopes, 'kerfdesk:edit']),
      () => consent.approve(phone.cookie, ['kerfdesk:read', 'machine:start']),
    ];
    for (const submit of malformed) {
      const refused = await submit();
      assert.notEqual(refused.status, 303);
      assert.equal(refused.headers.get('Location'), null);
      const records = await consentRecords(worker, desktop.deviceId);
      assert.equal(records.length, 1);
      assert.equal(records[0].consumed, false);
    }
    await requireToken(worker, consent, await consent.approve());
  },
);

scenario(
  'stale KV reads and a repeated save cannot resurrect a consumed handle',
  async ({ worker, desktop, phone }) => {
    const consent = await prepareConsent(worker, phone);
    await configureConsent(worker, { stale: true });
    await requireToken(worker, consent, await consent.approve());
    const replay = await consent.approve();
    assert.equal(replay.status, 403);
    assert.equal(replay.headers.get('Location'), null);
    const resave = await consentAudit(worker, {
      action: 'resave',
      deviceId: desktop.deviceId,
      hash: consentHash(consent.handle),
    });
    assert.equal(await resave.json(), false);
    assert.equal((await consentRecords(worker, desktop.deviceId))[0].consumed, true);
    const independent = await prepareConsent(worker, phone);
    await requireToken(worker, independent, await independent.approve());
  },
);

scenario(
  'two tabs and a second PC keep independent consent and scope ceilings',
  async ({ worker, desktop, phone }) => {
    let secondDesktop;
    try {
      const first = await prepareConsent(worker, phone);
      const readOnly = await prepareConsent(worker, phone, { scope: 'kerfdesk:read' });
      secondDesktop = await connectDesktop(worker);
      const secondPhone = await pairPhone(worker, secondDesktop);
      const second = await prepareConsent(worker, secondPhone);
      assert.notEqual(first.handle, readOnly.handle);
      assert.equal((await first.approve(secondPhone.cookie)).status, 403);
      assert.equal((await readOnly.approve(phone.cookie, scopes)).status, 403);
      const decisions = await Promise.all([first.approve(), readOnly.approve(), second.approve()]);
      for (const [index, consent] of [first, readOnly, second].entries())
        await requireToken(worker, consent, decisions[index]);
      assert.equal((await consentRecords(worker, desktop.deviceId)).length, 2);
      assert.equal((await consentRecords(worker, secondDesktop.deviceId)).length, 1);
    } finally {
      closeSocket(secondDesktop?.socket);
    }
  },
);

scenario(
  'pending and consumed records survive a real Durable Object reset',
  async ({ worker, desktop, phone }) => {
    const consumed = await prepareConsent(worker, phone);
    const pending = await prepareConsent(worker, phone);
    await configureConsent(worker, { stale: true });
    await requireToken(worker, consumed, await consumed.approve());
    const before = await consentRecords(worker, desktop.deviceId);
    assert.equal(before.filter((record) => record.consumed).length, 1);
    assert.equal(
      (await consentAudit(worker, { action: 'reset', deviceId: desktop.deviceId })).status,
      503,
    );
    assert.deepEqual(await consentRecords(worker, desktop.deviceId), before);
    assert.equal((await consumed.approve()).status, 403);
    await requireToken(worker, pending, await pending.approve());
  },
);

scenario(
  'expired durable state refuses stale provider and apparently fresh KV presentation',
  async ({ worker, desktop, phone }) => {
    const old = await prepareConsent(worker, phone);
    await configureConsent(worker, {
      deviceId: desktop.deviceId,
      offset: 601_000,
      stale: true,
      freshBinding: true,
    });
    const expired = await old.approve();
    assert.equal(expired.status, 403);
    assert.equal(expired.headers.get('Location'), null);
    assert.equal((await consentRecords(worker, desktop.deviceId)).length, 0);
    const fresh = await prepareConsent(worker, phone);
    await requireToken(worker, fresh, await fresh.approve());
  },
);

scenario(
  'durable save RPC failure exposes no form and a fresh attempt recovers',
  async ({ worker, desktop, phone }) => {
    await configureConsent(worker, { deviceId: desktop.deviceId, deviceFault: 'save' });
    await assert.rejects(
      prepareConsent(worker, phone),
      (error) => error.actual === 503 && error.expected === 200,
    );
    assert.equal((await consentRecords(worker, desktop.deviceId)).length, 0);
    assert.equal((await phoneSession(worker, phone)).status, 200);
    await configureConsent(worker, { deviceId: desktop.deviceId });
    const fresh = await prepareConsent(worker, phone);
    await requireToken(worker, fresh, await fresh.approve());
  },
);

scenario(
  'consume RPC outage after provider consumption requires a fresh consent page',
  async ({ worker, desktop, phone }) => {
    const old = await prepareConsent(worker, phone);
    await configureConsent(worker, { deviceId: desktop.deviceId, deviceFault: 'consume-before' });
    const unavailable = await old.approve();
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.headers.get('Location'), null);
    await configureConsent(worker, { deviceId: desktop.deviceId });
    assert.notEqual((await old.approve()).status, 303);
    const fresh = await prepareConsent(worker, phone);
    await requireToken(worker, fresh, await fresh.approve());
  },
);

scenario(
  'lost consume reply keeps the durable marker and refuses stale-KV retry',
  async ({ worker, desktop, phone }) => {
    const old = await prepareConsent(worker, phone);
    await configureConsent(worker, {
      deviceId: desktop.deviceId,
      deviceFault: 'consume-after',
      stale: true,
    });
    const unavailable = await old.approve();
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.headers.get('Location'), null);
    assert.equal((await consentRecords(worker, desktop.deviceId))[0].consumed, true);
    await configureConsent(worker, { deviceId: desktop.deviceId, stale: true });
    assert.equal((await old.approve()).status, 403);
    const fresh = await prepareConsent(worker, phone);
    await requireToken(worker, fresh, await fresh.approve());
  },
);

scenario(
  'KV cleanup failure grants nothing and a stale-KV retry cannot authorize',
  async ({ worker, desktop, phone }) => {
    const old = await prepareConsent(worker, phone);
    await configureConsent(worker, { kvFault: 'delete', stale: true });
    const unavailable = await old.approve();
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.headers.get('Location'), null);
    assert.equal((await consentRecords(worker, desktop.deviceId))[0].consumed, true);
    await configureConsent(worker, { stale: true });
    assert.equal((await old.approve()).status, 403);
    const fresh = await prepareConsent(worker, phone);
    await requireToken(worker, fresh, await fresh.approve());
  },
);

scenario(
  'revocation while a provider read is pending defeats the captured approved session',
  async ({ worker, desktop, phone }) => {
    const consent = await prepareConsent(worker, phone);
    await configureConsent(worker, {
      barrier: { hash: consentHash(consent.handle), count: 1, manual: true },
    });
    const decision = consent.approve();
    await waitForConsentRead(worker);
    desktop.send({ type: 'client.revoke', clientId: phone.clientId });
    await desktop.inbox.next('clients', (message) => message.clients.length === 0);
    assert.equal((await consentRecords(worker, desktop.deviceId)).length, 0);
    assert.equal((await consentAudit(worker, { action: 'release' })).status, 200);
    const revoked = await decision;
    assert.equal(revoked.status, 403);
    assert.equal(revoked.headers.get('Location'), null);
  },
);

scenario(
  'the bounded ledger refuses extra forms, then prunes expired capacity',
  async ({ worker, desktop, phone }) => {
    for (let index = 0; index < 64; index++) await prepareConsent(worker, phone);
    assert.equal((await consentRecords(worker, desktop.deviceId)).length, 64);
    await assert.rejects(
      prepareConsent(worker, phone),
      (error) => error.actual === 503 && error.expected === 200,
    );
    await configureConsent(worker, { deviceId: desktop.deviceId, offset: 601_000 });
    const fresh = await prepareConsent(worker, phone);
    assert.equal((await consentRecords(worker, desktop.deviceId)).length, 1);
    await requireToken(worker, fresh, await fresh.approve());
  },
);

scenario(
  'a consent without a durable record fails closed and a new page recovers',
  async ({ worker, desktop, phone }) => {
    const old = await prepareConsent(worker, phone);
    assert.equal(
      await (
        await consentAudit(worker, {
          action: 'forget',
          deviceId: desktop.deviceId,
          hash: consentHash(old.handle),
        })
      ).json(),
      true,
    );
    const unavailable = await old.approve();
    assert.equal(unavailable.status, 403);
    assert.equal(unavailable.headers.get('Location'), null);
    assert.equal((await phoneSession(worker, phone)).status, 200);
    const fresh = await prepareConsent(worker, phone);
    await requireToken(worker, fresh, await fresh.approve());
  },
);

scenario(
  'Decline cleanup failure returns no redirect and its stale form cannot be allowed',
  async ({ worker, desktop, phone }) => {
    const old = await prepareConsent(worker, phone);
    await configureConsent(worker, { kvFault: 'delete', stale: true });
    const unavailable = await old.decline();
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.headers.get('Location'), null);
    assert.equal((await consentRecords(worker, desktop.deviceId))[0].consumed, true);
    await configureConsent(worker, { stale: true });
    assert.equal((await old.approve()).status, 403);
    assert.equal((await old.decline()).status, 403);
    const fresh = await prepareConsent(worker, phone);
    await requireToken(worker, fresh, await fresh.approve());
  },
);
