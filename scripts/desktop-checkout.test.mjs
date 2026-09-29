import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { startCheckoutPage } from '../public/desktop-checkout.mjs';

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
    '',
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
    assert.equal(window.document.getElementById('checkout-agreement').hidden, true);
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

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function agreementBoxes(window) {
  return [...window.document.querySelectorAll('input[data-checkout-agreement]')];
}

function tick(window, box) {
  box.checked = true;
  box.dispatchEvent(new window.Event('change'));
}

test('the buyer agrees to the terms and confirms machine safety before any payment code loads', async () => {
  const window = page();
  await startCheckoutPage(window, async () => new Response(JSON.stringify(configuration)));
  const button = window.document.getElementById('checkout-open');
  const boxes = agreementBoxes(window);
  assert.equal(boxes.length, 2);
  assert.equal(window.document.getElementById('checkout-agreement').hidden, false);
  assert.equal(button.hidden, false);
  assert.equal(button.disabled, true);
  const labels = boxes.map((box) => box.closest('label').textContent.replace(/\s+/gu, ' '));
  assert.match(labels[0], /agree to the Terms of Service and the Refund Policy/u);
  assert.match(labels[1], /machine-safety section/u);
  tick(window, boxes[0]);
  assert.equal(button.disabled, true);
  button.click();
  await settle();
  assert.equal(window.document.querySelector('script[src^="https://"]'), null);
  assert.match(window.document.getElementById('checkout-status').textContent, /Tick both boxes/u);
  window.close();
});

test('the checkout page names the seller and Paddle as merchant of record, with prices plus tax', () => {
  const text = new JSDOM(html).window.document.body.textContent.replace(/\s+/gu, ' ');
  assert.match(text, /Paddle\.com is the Merchant of Record for all our orders/u);
  assert.match(text, /Johannes Stephanus Stolk/u);
  assert.match(text, /US\$49\.50 plus tax/u);
  assert.match(text, /US\$20 plus tax/u);
  assert.match(text, /a licence to use the software, not ownership of it/u);
  assert.doesNotMatch(text, /Make it yours|versions you own/u);
});

test('after agreeing, the verified configuration opens the exact transaction; browser success never issues a licence', async () => {
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
  assert.deepEqual(calls, []);
  for (const box of agreementBoxes(window)) tick(window, box);
  const button = window.document.getElementById('checkout-open');
  assert.equal(button.disabled, false);
  button.click();
  await settle();
  await settle();
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
  button.click();
  await settle();
  assert.deepEqual(calls.at(-1), ['open', opened]);
  assert.equal(calls.filter(([name]) => name === 'initialize').length, 1);
  window.close();
});
