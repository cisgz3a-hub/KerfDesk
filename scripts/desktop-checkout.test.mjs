import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { startCheckoutPage } from '../public/desktop-checkout.mjs';
import { PURCHASE_STORAGE_KEY, prepareBrowserPurchase } from '../public/desktop-browser-order.mjs';
import { validBrowserOrder, validClaim } from '../public/desktop-checkout-api.mjs';

const html = await readFile(new URL('../public/buy.html', import.meta.url), 'utf8');
const transaction = `txn_${'a'.repeat(26)}`;
// The server-created transaction, with no field for adding a discount code.
const opened = { transactionId: transaction, settings: { showAddDiscounts: false } };
const configuration = {
  enabled: true,
  provider: 'paddle',
  environment: 'sandbox',
  clientToken: `test_${'A'.repeat(27)}`,
  purchase: { amount: 4950, currency: 'USD' },
  renewal: { amount: 2000, currency: 'USD' },
};

function page(search = `?_ptxn=${transaction}`) {
  return new JSDOM(html, { url: `https://kerfdesk.com/buy.html${search}` }).window;
}

test('only an exact server-created transaction URL can start checkout', async () => {
  for (const search of [
    '?price=1',
    `?_ptxn=${transaction}&price=1`,
    `?_ptxn=${transaction}&_ptxn=${transaction}`,
    '?_ptxn=txn_short',
  ]) {
    const window = page(search);
    let requests = 0;
    await startCheckoutPage(window, async () => {
      requests += 1;
      throw new Error();
    });
    assert.equal(requests, 0);
    assert.equal(window.document.getElementById('checkout-open').hidden, true);
    assert.match(window.document.getElementById('checkout-status').textContent, /desktop app/u);
    window.close();
  }
});

test('disabled, wrong-price and mismatched-environment configurations never load payment code', async () => {
  for (const config of [
    { enabled: false },
    { ...configuration, purchase: { amount: 1, currency: 'USD' } },
    { ...configuration, renewal: { amount: 2000, currency: 'ZAR' } },
    { ...configuration, environment: 'live' },
    { ...configuration, clientToken: 'secret_api_key' },
    { ...configuration, provider: 'untrusted' },
  ]) {
    const window = page();
    await startCheckoutPage(window, async () => new Response(JSON.stringify(config)));
    assert.equal(window.document.querySelector('script[src^="https://"]'), null);
    assert.equal(window.document.getElementById('checkout-open').hidden, true);
    assert.match(window.document.getElementById('checkout-status').textContent, /not available/u);
    window.close();
  }
});

test('oversized or failed public configuration leaves checkout closed', async () => {
  for (const response of [
    new Response('x'.repeat(4097)),
    new Response('{}', { status: 503 }),
    new Response('invalid json'),
  ]) {
    const window = page();
    await startCheckoutPage(window, async () => response);
    assert.equal(window.document.querySelector('script[src^="https://"]'), null);
    assert.equal(window.document.getElementById('checkout-open').hidden, true);
    assert.match(
      window.document.getElementById('checkout-status').textContent,
      /temporarily unavailable/u,
    );
    window.close();
  }
});

test('verified configuration opens the exact transaction; browser success never issues a licence', async () => {
  const window = page();
  const calls = [];
  let callback;
  window.Paddle = {
    Environment: { set: (value) => calls.push(['environment', value]) },
    Initialize: (options) => {
      callback = options.eventCallback;
      calls.push(['initialize', options.token]);
    },
    Checkout: { open: (options) => calls.push(['open', options]) },
  };
  const append = window.document.head.append.bind(window.document.head);
  window.document.head.append = (script) => {
    assert.equal(script.src, 'https://cdn.paddle.com/paddle/v2/paddle.js');
    append(script);
    queueMicrotask(() => script.onload());
  };
  let requests = 0;
  await startCheckoutPage(window, async (url, options) => {
    requests += 1;
    assert.equal(url, 'https://license.kerfdesk.com/v1/public/config');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    return new Response(JSON.stringify(configuration));
  });
  assert.deepEqual(calls, [
    ['environment', 'sandbox'],
    ['initialize', configuration.clientToken],
    ['open', opened],
  ]);
  callback({ name: 'checkout.completed', data: { license: 'forged-client-result' } });
  assert.equal(requests, 1);
  assert.match(
    window.document.getElementById('checkout-status').textContent,
    /Return to KerfDesk.*Check payment/u,
  );
  window.document.getElementById('checkout-open').click();
  assert.deepEqual(calls.at(-1), ['open', opened]);
  window.close();
});

const order = {
  orderId: '00000000-0000-4000-8000-000000000001',
  claimToken: 'c'.repeat(43),
  checkoutUrl: `https://kerfdesk.com/buy.html?_ptxn=${transaction}`,
  amount: 4950,
  currency: 'USD',
};
const paid = {
  licenseId: '00000000-0000-4000-8000-000000000002',
  licenseKey: `KD1.00000000-0000-4000-8000-000000000002.${'k'.repeat(43)}`,
};
function serialLocks() {
  let tail = Promise.resolve();
  return {
    request(_name, _options, action) {
      const next = tail.then(action);
      tail = next.catch(() => undefined);
      return next;
    },
  };
}
function browserPage(storage, locks = serialLocks()) {
  const window = page('');
  Object.defineProperty(window.navigator, 'locks', { value: locks });
  if (storage) Object.defineProperty(window, 'localStorage', { value: storage });
  const opened = [];
  let completed;
  window.Paddle = {
    Environment: { set: () => undefined },
    Initialize: ({ eventCallback }) => {
      completed = eventCallback;
    },
    Checkout: { open: (value) => opened.push(value) },
  };
  const append = window.document.head.append.bind(window.document.head);
  window.document.head.append = (script) => {
    append(script);
    queueMicrotask(() => script.onload());
  };
  return { window, opened, complete: () => completed({ name: 'checkout.completed', data: paid }) };
}
async function clickBrowser(window, id) {
  window.document.getElementById(id).click();
  for (let tries = 0; tries < 100; tries++) {
    await new Promise((resolve) => setTimeout(resolve, 1));
    if (window.document.getElementById('browser-purchase').getAttribute('aria-busy') === 'false')
      return;
  }
  throw new Error('Purchase UI did not settle');
}
const response = (value, status = 200) => new Response(JSON.stringify(value), { status });
const pendingResponse = () => response({ error: { code: 'payment_pending' } }, 409);

test('mobile landing keeps disabled sales closed and never loads Paddle or creates an order', async () => {
  const { window, opened } = browserPage();
  const requests = [];
  await startCheckoutPage(window, async (url) => {
    requests.push(url);
    return response({ enabled: false });
  });
  assert.equal(window.document.querySelector('canvas'), null);
  assert.equal(window.document.getElementById('purchase-open').disabled, true);
  assert.match(window.document.getElementById('checkout-status').textContent, /not open yet/u);
  assert.equal(window.document.querySelector('script[src^="https:"]'), null);
  assert.equal(window.localStorage.getItem(PURCHASE_STORAGE_KEY), null);
  assert.equal(requests.length, 1);
  assert.deepEqual(opened, []);
  window.close();
});

test('browser purchase is saved before payment, then only server claim can reveal and copy its key', async () => {
  const f = browserPage();
  const requests = [];
  let fulfilled = false;
  const fetcher = async (url, options) => {
    requests.push({ url, options });
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    if (url.endsWith('/config')) return response(configuration);
    if (url.endsWith('/checkout')) {
      const saved = JSON.parse(f.window.localStorage.getItem(PURCHASE_STORAGE_KEY));
      const body = JSON.parse(options.body);
      assert.match(saved.requestId, /^[A-Za-z0-9_-]{43}$/u);
      assert.deepEqual(body, { requestId: saved.requestId, operation: 'purchase' });
      return response(order);
    }
    assert.ok(url.endsWith('/orders/claim'));
    assert.deepEqual(JSON.parse(options.body), {
      orderId: order.orderId,
      claimToken: order.claimToken,
    });
    assert.deepEqual(JSON.parse(f.window.localStorage.getItem(PURCHASE_STORAGE_KEY)).order, order);
    return fulfilled ? response(paid) : pendingResponse();
  };
  await startCheckoutPage(f.window, fetcher);
  await clickBrowser(f.window, 'purchase-open');
  assert.deepEqual(f.opened, [opened]);
  assert.equal(f.window.document.getElementById('licence-result').hidden, true);
  f.complete();
  assert.equal(f.window.document.getElementById('licence-result').hidden, true);
  fulfilled = true;
  await clickBrowser(f.window, 'purchase-check');
  const field = f.window.document.getElementById('licence-key');
  assert.equal(field.value, paid.licenseKey);
  assert.equal(field.getAttribute('value'), null);
  assert.equal(
    f.window.localStorage.getItem(PURCHASE_STORAGE_KEY).includes(paid.licenseKey),
    false,
  );
  assert.equal(f.window.document.documentElement.outerHTML.includes(order.claimToken), false);
  assert.equal(f.window.location.search, '');
  const copied = [];
  Object.defineProperty(f.window.navigator, 'clipboard', {
    value: { writeText: async (key) => copied.push(key) },
  });
  f.window.document.getElementById('licence-copy').click();
  await Promise.resolve();
  assert.deepEqual(copied, [paid.licenseKey]);
  assert.equal(
    requests.some(({ url }) => /activate|trial/u.test(url)),
    false,
  );
  f.window.close();
});

test('same-origin tabs serialize a single durable purchase and ambiguous requests reuse their ID', async () => {
  const first = browserPage();
  const shared = first.window.localStorage;
  const locks = serialLocks();
  const a = browserPage(shared, locks);
  const b = browserPage(shared, locks);
  const bodies = [];
  let fail = true;
  const fetcher = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    if (fail) {
      fail = false;
      throw new Error('Lost response');
    }
    return response(order);
  };
  await assert.rejects(prepareBrowserPurchase(a.window, fetcher));
  const results = await Promise.all([
    prepareBrowserPurchase(a.window, fetcher),
    prepareBrowserPurchase(b.window, fetcher),
  ]);
  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[0], bodies[1]);
  assert.deepEqual(results, [order, order]);
  first.window.close();
  a.window.close();
  b.window.close();
});

test('unwritable initial intent or returned order never exposes payment', async () => {
  for (const failWrite of [1, 2]) {
    let raw = null;
    let writes = 0;
    const storage = {
      getItem: () => raw,
      setItem: (_key, value) => {
        if (++writes === failWrite) throw new Error('Storage full');
        raw = value;
      },
    };
    const f = browserPage(storage);
    let posts = 0;
    await startCheckoutPage(f.window, async (url) => {
      if (url.endsWith('/config')) return response(configuration);
      posts++;
      return response(order);
    });
    await clickBrowser(f.window, 'purchase-open');
    assert.deepEqual(f.opened, []);
    assert.equal(f.window.document.querySelector('script[src^="https:"]'), null);
    assert.equal(posts, failWrite === 1 ? 0 : 1);
    if (failWrite === 2) assert.match(JSON.parse(raw).requestId, /^[A-Za-z0-9_-]{43}$/u);
    f.window.close();
  }
});

test('a saved order can reveal its confirmed key after reload even while new sales are closed', async () => {
  const f = browserPage();
  f.window.localStorage.setItem(
    PURCHASE_STORAGE_KEY,
    JSON.stringify({ schemaVersion: 1, requestId: 'r'.repeat(43), order }),
  );
  const requests = [];
  await startCheckoutPage(f.window, async (url) => {
    requests.push(url);
    return url.endsWith('/config') ? response({ enabled: false }) : response(paid);
  });
  assert.equal(f.window.document.getElementById('purchase-open').disabled, true);
  assert.equal(f.window.document.getElementById('licence-result').hidden, true);
  await clickBrowser(f.window, 'purchase-check');
  assert.equal(f.window.document.getElementById('licence-key').value, paid.licenseKey);
  assert.equal(
    requests.some((url) => url.endsWith('/checkout')),
    false,
  );
  assert.deepEqual(f.opened, []);
  f.window.close();
});

test('strict response validation rejects altered prices, checkout destinations and mismatched keys', () => {
  for (const invalid of [
    { ...order, amount: 1 },
    { ...order, currency: 'ZAR' },
    { ...order, orderId: 123 },
    { ...order, checkoutUrl: order.checkoutUrl.replace('kerfdesk.com', 'evil.example') },
    { ...order, checkoutUrl: `${order.checkoutUrl}&claimToken=leak` },
  ])
    assert.equal(validBrowserOrder(invalid), false);
  assert.equal(validClaim(paid), true);
  assert.equal(validClaim({ ...paid, licenseKey: 'This is not a licence key' }), false);
  assert.equal(validClaim({ ...paid, licenseId: order.orderId }), false);
});

test('missing Web Locks, corrupt storage and rejected payments fail closed without creating another order', async () => {
  const unsupported = page('');
  await startCheckoutPage(unsupported, async () => response(configuration));
  assert.equal(unsupported.document.getElementById('purchase-open').disabled, true);
  unsupported.close();
  const corrupt = browserPage();
  corrupt.window.localStorage.setItem(PURCHASE_STORAGE_KEY, '{broken');
  let requests = 0;
  await startCheckoutPage(corrupt.window, async () => {
    requests++;
    return response(configuration);
  });
  assert.equal(requests, 0);
  assert.equal(corrupt.window.document.getElementById('purchase-open').disabled, true);
  corrupt.window.close();
  const rejected = browserPage();
  rejected.window.localStorage.setItem(
    PURCHASE_STORAGE_KEY,
    JSON.stringify({ schemaVersion: 1, requestId: 'r'.repeat(43), order }),
  );
  await startCheckoutPage(rejected.window, async (url) =>
    url.endsWith('/config')
      ? response(configuration)
      : response({ error: { code: 'payment_rejected' } }, 409),
  );
  await clickBrowser(rejected.window, 'purchase-open');
  assert.deepEqual(rejected.opened, []);
  assert.match(
    rejected.window.document.getElementById('checkout-status').textContent,
    /Do not pay again/u,
  );
  assert.equal(rejected.window.document.getElementById('licence-result').hidden, true);
  rejected.window.close();
});
