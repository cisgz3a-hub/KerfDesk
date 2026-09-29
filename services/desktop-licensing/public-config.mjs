/* global URL */
import { paddleConfiguration } from './paddle.mjs';
import { CATALOG } from './payments.mjs';
import { json } from './http.mjs';
import { createCryptography } from './crypto.mjs';

export async function publicConfiguration(request, env) {
  const prices = {
    purchase: { amount: CATALOG.purchase, currency: 'USD' },
    renewal: { amount: CATALOG.renewal, currency: 'USD' },
  };
  let value = { enabled: false, provider: null, environment: null, clientToken: null, ...prices };
  try {
    paddleConfiguration(env);
    await createCryptography(env);
    if (env.LICENSING_ENABLED === 'true')
      value = {
        ...value,
        enabled: true,
        provider: 'paddle',
        environment: env.PADDLE_ENVIRONMENT,
        clientToken: env.PADDLE_CLIENT_TOKEN,
      };
  } catch {
    /* Configuration stays disabled. */
  }
  const response = json(value);
  try {
    const origin = new URL(env.PADDLE_CHECKOUT_URL).origin;
    if (request.headers.get('origin') === origin) {
      response.headers.set('access-control-allow-origin', origin);
      response.headers.set('vary', 'Origin');
    }
  } catch {
    /* No configured browser origin. */
  }
  return response;
}
