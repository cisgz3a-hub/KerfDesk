/* global URLSearchParams, AbortSignal, TextDecoder, setTimeout, clearTimeout, fetch, window */
const CONFIG_URL = 'https://license.kerfdesk.com/v1/public/config';

export function checkoutTransaction(search) {
  const params = new URLSearchParams(search);
  if ([...params.keys()].join(',') !== '_ptxn') return null;
  const value = params.get('_ptxn');
  return /^txn_[a-z0-9]{26}$/u.test(value ?? '') ? value : null;
}

export function checkoutConfiguration(value) {
  if (
    value?.enabled !== true ||
    value.provider !== 'paddle' ||
    !['sandbox', 'live'].includes(value.environment) ||
    typeof value.clientToken !== 'string'
  )
    return null;
  const prefix = value.environment === 'sandbox' ? 'test_' : 'live_';
  if (
    !value.clientToken.startsWith(prefix) ||
    !/^(test|live)_[a-zA-Z0-9]{27}$/u.test(value.clientToken)
  )
    return null;
  if (
    value.purchase?.amount !== 4950 ||
    value.purchase.currency !== 'USD' ||
    value.renewal?.amount !== 2000 ||
    value.renewal.currency !== 'USD'
  )
    return null;
  return { token: value.clientToken, environment: value.environment };
}

async function publicConfig(fetcher) {
  const response = await fetcher(CONFIG_URL, {
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok || !response.body) throw new Error('Checkout unavailable');
  const reader = response.body.getReader();
  const parts = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 4096) throw new Error('Invalid checkout configuration');
      parts.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return checkoutConfiguration(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
}

async function paddleScript(document) {
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.paddle.com/paddle/v2/paddle.js';
    script.async = true;
    const timer = setTimeout(() => {
      script.remove();
      reject(new Error('Checkout load timed out'));
    }, 15000);
    script.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error('Checkout failed to load'));
    };
    document.head.append(script);
  });
}

export async function startCheckoutPage(window, fetcher = fetch) {
  const status = window.document.getElementById('checkout-status');
  const button = window.document.getElementById('checkout-open');
  if (!status || !button) return;
  const transaction = checkoutTransaction(window.location.search);
  if (transaction === null) {
    status.textContent =
      'Open Help → Licence in the desktop app to start a purchase or renew updates.';
    return;
  }
  try {
    const config = await publicConfig(fetcher);
    if (config === null) {
      status.textContent =
        'Checkout is not available yet. Return to KerfDesk to check an existing payment.';
      return;
    }
    await paddleScript(window.document);
    const paddle = window.Paddle;
    if (!paddle?.Initialize || !paddle?.Checkout?.open) throw new Error('Checkout unavailable');
    if (config.environment === 'sandbox') paddle.Environment.set('sandbox');
    paddle.Initialize({
      token: config.token,
      eventCallback: (event) => {
        if (event.name === 'checkout.completed')
          status.textContent =
            'Return to KerfDesk and select Check payment to confirm and activate your purchase.';
      },
    });
    // No discount field: the licence service refuses a discounted payment, so a code
    // entered here would take money without issuing a licence (ADR-523 Amendment 3).
    const open = () =>
      paddle.Checkout.open({ transactionId: transaction, settings: { showAddDiscounts: false } });
    button.addEventListener('click', open);
    button.hidden = false;
    status.textContent =
      config.environment === 'sandbox'
        ? 'Test checkout. No real payment will be taken.'
        : 'Your secure checkout is ready.';
    open();
  } catch {
    status.textContent =
      'Checkout is temporarily unavailable. Return to KerfDesk to check an existing payment before trying again.';
  }
}

if (typeof window !== 'undefined') void startCheckoutPage(window);
