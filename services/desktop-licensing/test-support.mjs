/* global crypto, Request, Headers, Response */
import { DatabaseSync } from 'node:sqlite';
import { createHmac } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { LicensingAuthority } from './authority.mjs';
import { base64url, createCryptography } from './crypto.mjs';
import { SqliteRecords } from './storage.mjs';

export const NOW = 1_800_000_000;
export const deviceId = (number) => base64url(new Uint8Array(32).fill(number));

export async function fixture() {
  const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const env = {
    LICENSING_ENABLED: 'true',
    PAYMENTS_ENABLED: 'false',
    SIGNING_KEY_ID: 'test-only',
    SIGNING_PRIVATE_JWK: JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)),
    HASH_SECRET: deviceId(45),
    DERIVATION_SECRET: deviceId(46),
    ADMIN_TOKEN: deviceId(47),
    PAYMENT_PROVIDER: 'paddle',
    PADDLE_ENVIRONMENT: 'sandbox',
    PADDLE_PURCHASE_PRICE_ID: `pri_${'a'.repeat(26)}`,
    PADDLE_RENEWAL_PRICE_ID: `pri_${'b'.repeat(26)}`,
    PADDLE_CHECKOUT_URL: 'https://kerfdesk.com/buy.html',
    PADDLE_API_KEY: 'test-only-api-key-'.repeat(3),
    PADDLE_WEBHOOK_SECRET: 'test-only-webhook-secret-'.repeat(3),
    PADDLE_CLIENT_TOKEN: 'test_public_client_token_only_1234',
  };
  const database = new DatabaseSync(':memory:');
  const storage = {
    sql: {
      exec: (sql, ...values) => {
        const rows = database.prepare(sql).all(...values);
        return { toArray: () => rows };
      },
    },
    transactionSync: (callback) => {
      database.exec('BEGIN IMMEDIATE');
      try {
        const result = callback();
        database.exec('COMMIT');
        return result;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const records = new SqliteRecords(storage);
  const cryptography = await createCryptography(env);
  let now = NOW;
  const authority = new LicensingAuthority(records, cryptography, () => now);
  return {
    authority,
    records,
    database,
    storage,
    env,
    pair,
    setNow: (value) => {
      now = value;
    },
  };
}

export function claims(result) {
  return JSON.parse(Buffer.from(result.entitlement.payload, 'base64url').toString('utf8'));
}

export function credentials(result) {
  const value = claims(result);
  return {
    licenseId: value.licenseId,
    activationId: value.activationId,
    deviceId: value.deviceId,
    activationToken: result.activationToken,
  };
}

export function request(path, body, headers = {}) {
  return new Request(`https://licensing.example${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

export function paddleTransaction(env, intent, overrides = {}) {
  const amount = intent.operation === 'purchase' ? '4950' : '2000';
  return {
    id: `txn_${'c'.repeat(26)}`,
    status: 'completed',
    currency_code: 'USD',
    collection_mode: 'automatic',
    subscription_id: null,
    discount_id: null,
    custom_data: {
      kerfdesk_order_id: intent.orderId,
      kerfdesk_operation: intent.operation,
      kerfdesk_order_proof: intent.orderProof,
    },
    items: [
      {
        quantity: 1,
        price: {
          id:
            intent.operation === 'purchase'
              ? env.PADDLE_PURCHASE_PRICE_ID
              : env.PADDLE_RENEWAL_PRICE_ID,
          unit_price: { amount, currency_code: 'USD' },
          billing_cycle: null,
          trial_period: null,
          tax_mode: 'external',
        },
      },
    ],
    details: {
      totals: {
        subtotal: amount,
        discount: '0',
        total: String(Number(amount) + 200),
        tax: '200',
        currency_code: 'USD',
      },
    },
    checkout: { url: `https://kerfdesk.com/buy.html?_ptxn=txn_${'c'.repeat(26)}` },
    ...overrides,
  };
}

export function signedPaddle(env, data, eventId = 'evt_test', timestamp = NOW) {
  const raw = JSON.stringify({ event_id: eventId, event_type: 'transaction.completed', data });
  const signature = createHmac('sha256', env.PADDLE_WEBHOOK_SECRET)
    .update(`${timestamp}:${raw}`)
    .digest('hex');
  return { raw, headers: new Headers({ 'paddle-signature': `ts=${timestamp};h1=${signature}` }) };
}

export function paddleFetcher(env, observe = () => undefined) {
  return async (_url, options) => {
    const body = JSON.parse(options.body);
    observe(body, options);
    const intent = {
      orderId: body.custom_data.kerfdesk_order_id,
      orderProof: body.custom_data.kerfdesk_order_proof,
      operation: body.custom_data.kerfdesk_operation,
    };
    return new Response(JSON.stringify({ data: paddleTransaction(env, intent) }), {
      headers: { 'content-type': 'application/json' },
    });
  };
}
