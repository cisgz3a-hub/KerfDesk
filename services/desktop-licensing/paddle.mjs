/* global crypto, TextEncoder, URL, fetch, AbortSignal */
import { CATALOG } from './payments.mjs';
import { identifier, parseBody, readBody, requireValue, ServiceError } from './validation.mjs';

const encoder = new TextEncoder();

export function paddleConfiguration(env) {
  requireValue(
    env.PAYMENTS_ENABLED === 'true' && env.PAYMENT_PROVIDER === 'paddle',
    503,
    'payment_provider_not_configured',
  );
  requireValue(
    ['sandbox', 'live'].includes(env.PADDLE_ENVIRONMENT),
    503,
    'payment_provider_not_configured',
  );
  const prices = { purchase: env.PADDLE_PURCHASE_PRICE_ID, renewal: env.PADDLE_RENEWAL_PRICE_ID };
  requireValue(
    Object.values(prices).every((value) => /^pri_[a-z0-9]{26}$/u.test(value ?? '')) &&
      prices.purchase !== prices.renewal,
    503,
    'payment_provider_not_configured',
  );
  requireValue(
    typeof env.PADDLE_API_KEY === 'string' &&
      env.PADDLE_API_KEY.length >= 32 &&
      typeof env.PADDLE_WEBHOOK_SECRET === 'string' &&
      env.PADDLE_WEBHOOK_SECRET.length >= 32,
    503,
    'payment_provider_not_configured',
  );
  requireValue(
    typeof env.PADDLE_CLIENT_TOKEN === 'string' &&
      env.PADDLE_CLIENT_TOKEN.startsWith(env.PADDLE_ENVIRONMENT === 'live' ? 'live_' : 'test_') &&
      env.PADDLE_CLIENT_TOKEN.length >= 20,
    503,
    'payment_provider_not_configured',
  );
  const checkout = new URL(env.PADDLE_CHECKOUT_URL);
  requireValue(
    checkout.protocol === 'https:' &&
      !checkout.username &&
      !checkout.password &&
      !checkout.search &&
      !checkout.hash,
    503,
    'payment_provider_not_configured',
  );
  return {
    prices,
    checkout: checkout.href,
    api:
      env.PADDLE_ENVIRONMENT === 'live'
        ? 'https://api.paddle.com'
        : 'https://sandbox-api.paddle.com',
  };
}

export async function verifyPaddleSignature(header, raw, secret, now) {
  if (typeof header !== 'string' || header.length > 1024) return false;
  const parts = header.split(';').map((part) => part.trim().split('='));
  const timestamps = parts.filter(([name]) => name === 'ts');
  const signatures = parts.filter(([name]) => name === 'h1');
  if (
    timestamps.length !== 1 ||
    !/^\d{10}$/u.test(timestamps[0][1] ?? '') ||
    signatures.length < 1 ||
    signatures.length > 4
  )
    return false;
  const timestamp = timestamps[0][1];
  if (Math.abs(now - Number(timestamp)) > 5) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  for (const [, hex] of signatures) {
    if (!/^[a-f0-9]{64}$/u.test(hex ?? '')) continue;
    const signature = Uint8Array.from(hex.match(/../gu), (byte) => Number.parseInt(byte, 16));
    if (await crypto.subtle.verify('HMAC', key, signature, encoder.encode(`${timestamp}:${raw}`)))
      return true;
  }
  return false;
}

export function validatePaddleTransaction(data, config, operation) {
  const amount = CATALOG[operation];
  const item = data.items?.[0];
  const totals = data.details?.totals;
  requireValue(
    data.currency_code === 'USD' &&
      data.collection_mode === 'automatic' &&
      data.subscription_id === null,
    409,
    'payment_mismatch',
  );
  requireValue(
    data.items?.length === 1 && item.quantity === 1 && item.price?.id === config.prices[operation],
    409,
    'payment_mismatch',
  );
  requireValue(
    item.price?.unit_price?.amount === String(amount) &&
      item.price.unit_price.currency_code === 'USD' &&
      item.price.billing_cycle === null &&
      item.price.trial_period === null &&
      item.price.tax_mode === 'external',
    409,
    'payment_mismatch',
  );
  requireValue(
    data.discount_id === null &&
      totals?.discount === '0' &&
      totals?.subtotal === String(amount) &&
      totals?.currency_code === 'USD',
    409,
    'payment_mismatch',
  );
  requireValue(
    /^\d+$/u.test(totals.tax) &&
      Number.isSafeInteger(Number(totals.tax)) &&
      totals.total === String(amount + Number(totals.tax)),
    409,
    'payment_mismatch',
  );
  return amount;
}

export function paddleVerifier(env) {
  const config = paddleConfiguration(env);
  return async (headers, raw, now) => {
    requireValue(
      await verifyPaddleSignature(
        headers.get('paddle-signature'),
        raw,
        env.PADDLE_WEBHOOK_SECRET,
        now,
      ),
      401,
      'invalid_payment_signature',
    );
    const event = parseBody(raw);
    if (event.event_type !== 'transaction.completed') return { ignored: true };
    const data = event.data;
    requireValue(data?.status === 'completed', 409, 'payment_not_completed');
    const operation = data.custom_data?.kerfdesk_operation;
    requireValue(Object.hasOwn(CATALOG, operation), 409, 'payment_mismatch');
    const amount = validatePaddleTransaction(data, config, operation);
    return {
      eventId: identifier(event.event_id),
      paymentId: identifier(data.id),
      orderId: identifier(data.custom_data.kerfdesk_order_id),
      orderProof: data.custom_data.kerfdesk_order_proof,
      provider: 'paddle',
      providerOrderId: data.id,
      priceId: config.prices[operation],
      amount,
      currency: 'USD',
      status: 'paid',
    };
  };
}

export async function createPaddleTransaction(env, intent, fetcher = fetch) {
  const config = paddleConfiguration(env);
  let response;
  try {
    response = await fetcher(`${config.api}/transactions`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: {
        authorization: `Bearer ${env.PADDLE_API_KEY}`,
        'content-type': 'application/json',
        'paddle-version': '1',
      },
      body: JSON.stringify({
        items: [{ price_id: config.prices[intent.operation], quantity: 1 }],
        currency_code: 'USD',
        collection_mode: 'automatic',
        discount_id: null,
        custom_data: {
          kerfdesk_order_id: intent.orderId,
          kerfdesk_order_proof: intent.orderProof,
          kerfdesk_operation: intent.operation,
        },
        checkout: { url: config.checkout },
      }),
    });
  } catch {
    throw new ServiceError(409, 'checkout_pending');
  }
  // Even an error response can be ambiguous after a proxy timeout. Keep the
  // durable intent rather than issuing a second chargeable checkout automatically.
  requireValue(response.ok, 409, 'checkout_pending');
  let result;
  try {
    result = parseBody(await readBody(response, 131_072));
  } catch {
    throw new ServiceError(503, 'invalid_provider_response');
  }
  const data = result.data;
  requireValue(/^txn_[a-z0-9]{26}$/u.test(data?.id ?? ''), 503, 'invalid_provider_response');
  validatePaddleTransaction(data, config, intent.operation);
  const checkout = new URL(data.checkout?.url);
  const expected = new URL(config.checkout);
  requireValue(
    checkout.origin === expected.origin &&
      checkout.pathname === expected.pathname &&
      !checkout.username &&
      !checkout.password &&
      !checkout.hash &&
      checkout.searchParams.get('_ptxn') === data.id &&
      [...checkout.searchParams.keys()].every((key) => key === '_ptxn'),
    503,
    'invalid_provider_response',
  );
  return { providerOrderId: data.id, checkoutUrl: checkout.href };
}
