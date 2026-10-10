/* global Response */
import test from 'node:test';
import assert from 'node:assert/strict';
import { authorityRequest } from './http.mjs';
import { licenceEmailEnabled, licenceEmailMessage, paddleCustomerEmail } from './licence-email.mjs';
import {
  checkoutOrder,
  deviceId,
  fixture,
  paddleTransaction,
  request,
  signedPaddle,
  webhookRequest,
} from './test-support.mjs';

const CUSTOMER = `ctm_${'d'.repeat(26)}`;

async function emailing(overrides = {}) {
  const f = await fixture();
  Object.assign(f.env, { PAYMENTS_ENABLED: 'true' });
  const sent = [];
  const env = {
    ...f.env,
    LICENCE_EMAIL_ENABLED: 'true',
    LICENCE_EMAIL_FROM: 'licences@kerfdesk.com',
    EMAIL: { send: async (message) => sent.push(message) },
    ...overrides,
  };
  const lookups = [];
  const fetcher = async (url, options) => {
    lookups.push({ url, options });
    return new Response(JSON.stringify({ data: { id: CUSTOMER, email: 'buyer@example.com' } }));
  };
  return { f, env, sent, lookups, fetcher };
}

async function pay(f, env, fetcher, operation = 'purchase', eventId = 'evt_1') {
  const { intent } = await checkoutOrder(f, deviceId(70), { operation });
  const data = paddleTransaction(env, intent, { customer_id: CUSTOMER });
  const response = await authorityRequest(
    webhookRequest(signedPaddle(env, data, eventId)),
    env,
    f.authority,
    { fetcher },
  );
  return { intent, response: await response.json() };
}

test('a fulfilled purchase emails the buyer the same key the claim returns, once', async () => {
  const { f, env, sent, lookups, fetcher } = await emailing();
  const { intent, response } = await pay(f, env, fetcher);
  assert.equal(response.duplicate, false);
  assert.equal(sent.length, 1);
  assert.equal(lookups[0].url, `https://sandbox-api.paddle.com/customers/${CUSTOMER}`);
  assert.equal(lookups[0].options.redirect, 'manual');
  const message = sent[0];
  assert.equal(message.to, 'buyer@example.com');
  assert.deepEqual(message.from, { email: 'licences@kerfdesk.com', name: 'KerfDesk' });
  assert.equal(message.replyTo, 'support@kerfdesk.com');
  const claimed = await authorityRequest(
    request('/v1/orders/claim', {
      orderId: intent.orderId,
      claimToken: await f.authority.crypto.derive('order-claim', intent.orderId),
    }),
    env,
    f.authority,
  ).then((answer) => answer.json());
  assert.ok(message.text.includes(claimed.licenseKey));
  assert.ok(message.html.includes(claimed.licenseKey));
  assert.ok(message.text.includes(`Order number: ${intent.orderId}`));
  // The address is used, never kept.
  const order = f.records.get(`order:${intent.orderId}`);
  assert.equal(order.keyEmail.status, 'sent');
  assert.equal(
    JSON.stringify(f.database.prepare('SELECT * FROM records').all()).includes('buyer@example.com'),
    false,
  );
  // A redelivered webhook sends nothing more.
  const data = paddleTransaction(env, intent, { customer_id: CUSTOMER });
  await authorityRequest(webhookRequest(signedPaddle(env, data, 'evt_1')), env, f.authority, {
    fetcher,
  });
  assert.equal(sent.length, 1);
});

test('nothing is sent while switched off, for renewals, or without a binding or address', async () => {
  for (const overrides of [
    { LICENCE_EMAIL_ENABLED: 'false' },
    { EMAIL: undefined },
    { LICENCE_EMAIL_FROM: 'licences@example.com' },
  ]) {
    const { f, env, sent, fetcher } = await emailing(overrides);
    assert.equal(licenceEmailEnabled(env), false);
    const { response } = await pay(f, env, fetcher);
    assert.equal(response.duplicate, false);
    assert.equal(sent.length, 0);
  }
  const { f, env, sent } = await emailing();
  const noAddress = async () => new Response('{}', { status: 404 });
  const { intent } = await pay(f, env, noAddress);
  assert.equal(sent.length, 0);
  assert.deepEqual(
    {
      status: f.records.get(`order:${intent.orderId}`).keyEmail.status,
      code: f.records.get(`order:${intent.orderId}`).keyEmail.code,
    },
    { status: 'failed', code: 'no_address' },
  );
});

test('a failed send records only its code and never undoes the purchase', async () => {
  const failing = async () => {
    const error = new Error('domain not onboarded: buyer@example.com');
    error.code = 'E_SENDER_DOMAIN_NOT_AVAILABLE';
    throw error;
  };
  const { f, env, fetcher } = await emailing({ EMAIL: { send: failing } });
  const { intent, response } = await pay(f, env, fetcher);
  assert.equal(response.received, true);
  const order = f.records.get(`order:${intent.orderId}`);
  assert.equal(order.status, 'fulfilled');
  assert.equal(order.keyEmail.status, 'failed');
  assert.equal(order.keyEmail.code, 'E_SENDER_DOMAIN_NOT_AVAILABLE');
  assert.equal(JSON.stringify(order).includes('buyer@example.com'), false);
});

test('customer lookup refuses malformed IDs and addresses, and the message carries the steps', async () => {
  const env = { PADDLE_ENVIRONMENT: 'live', PADDLE_API_KEY: 'k'.repeat(40) };
  let calls = 0;
  const reply = (email) => async (url) => {
    calls += 1;
    assert.equal(url, `https://api.paddle.com/customers/${CUSTOMER}`);
    return new Response(JSON.stringify({ data: { email } }));
  };
  assert.equal(await paddleCustomerEmail(env, 'ctm_../evil', reply('a@b.co')), null);
  assert.equal(calls, 0);
  assert.equal(await paddleCustomerEmail(env, CUSTOMER, reply('a@b.co')), 'a@b.co');
  for (const bad of ['no-at-sign', 'a@b', 'a b@c.co', 'a@b.co\r\nBcc: x@y.co', 42])
    assert.equal(await paddleCustomerEmail(env, CUSTOMER, reply(bad)), null);
  const message = licenceEmailMessage(
    `KD1.${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}.${'a'.repeat(43)}`,
    'order-1',
  );
  assert.match(message.text, /Help > Licence.*Paste key.*Activate licence/su);
  assert.equal(message.subject, 'Your KerfDesk Pro licence key');
});
