// The owner's settled Free and Pro offer is shown (ADR-524 Amendment 1), while
// checkout ships closed and can only open fully configured (ADR-247).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { commerce } from '../commerce.config.mjs';
import { checkoutUrlFor, commerceErrors, formatPrice } from '../lib/commerce.mjs';
import { page as pricing } from '../pages/pricing.mjs';
import { site } from '../site.config.mjs';
import { attrValues, buildToTemp, builtPages, textContent } from './helpers.mjs';

const PRO = commerce.plans.find((plan) => plan.id === 'pro');
// Every price the site may show, as formatPrice writes it.
const SETTLED_PRICES = ['US$49.50', 'US$20'];

const EARLY_CHECKOUT_PLAN = { ...PRO, checkoutUrl: 'https://checkout.example.com/buy/pro' };

const OPEN_STORE = {
  ...commerce,
  salesOpen: true,
  authorizingAdr: 'ADR-999',
  termsUrl: '/terms/',
  refundPolicyUrl: '/refunds/',
  plans: [EARLY_CHECKOUT_PLAN],
};

function renderPricing(store) {
  return String(pricing.render({ site, commerce: store, siteUrl: null, asset: (p) => `/${p}` }));
}

describe('commerce configuration', () => {
  it('pins the settled Free and Pro offer (ADR-524 Amendment 1)', () => {
    assert.equal(commerce.currency, 'USD');
    assert.equal(commerce.free.name, 'Free');
    assert.deepEqual(commerce.free.includes, [
      'Drawing and text',
      'File import',
      'Basic tracing',
      'Laser cutting and engraving',
      '2D CNC cuts',
      'All machine control',
    ]);
    assert.equal(commerce.plans.length, 1, 'Free and Pro are the only editions');
    assert.ok(PRO, 'the Pro plan is configured');
    assert.equal(PRO.name, 'Pro');
    assert.equal(PRO.price, 49.5);
    assert.equal(
      PRO.billing,
      'one-time',
      'a Pro license is a one-time purchase, not a subscription',
    );
    assert.equal(PRO.updateYearPrice, 20);
    assert.equal(PRO.deviceLimit, 3);
    assert.equal(PRO.trialDays, 30);
    assert.deepEqual(PRO.includes, [
      'V-carve',
      '3D relief',
      'Adaptive clearing',
      'Advanced tracing',
      'Camera alignment',
      'Box generator',
      'Design Studio',
      'G-code Inspector',
    ]);
  });

  it('ships with checkout closed and no checkout URL until a payment provider is live', () => {
    assert.equal(
      commerce.salesOpen,
      false,
      'Opening checkout needs a live payment provider, published terms of sale and the commercial ADR ADR-247 requires; update this test in that same change.',
    );
    assert.equal(commerce.authorizingAdr, null);
    assert.equal(commerce.termsUrl, null);
    assert.equal(commerce.refundPolicyUrl, null);
    for (const plan of commerce.plans) assert.equal(plan.checkoutUrl, null, plan.id);
    assert.deepEqual(commerceErrors(commerce), []);
  });

  it('refuses a checkout URL while sales are closed', () => {
    const early = { ...commerce, plans: [EARLY_CHECKOUT_PLAN] };
    assert.ok(commerceErrors(early).some((e) => e.includes('checkoutUrl must stay empty')));
    assert.equal(checkoutUrlFor(early, EARLY_CHECKOUT_PLAN), null);
  });

  it('refuses an incomplete offer', () => {
    assert.ok(commerceErrors({ ...commerce, free: undefined }).some((e) => e.includes('free')));
    const noDevices = { ...PRO, deviceLimit: 0 };
    assert.ok(
      commerceErrors({ ...commerce, plans: [noDevices] }).some((e) => e.includes('deviceLimit')),
    );
    const badRenewal = { ...PRO, updateYearPrice: -1 };
    assert.ok(
      commerceErrors({ ...commerce, plans: [badRenewal] }).some((e) =>
        e.includes('updateYearPrice'),
      ),
    );
  });

  it('refuses to open a store without an ADR, policies, plans and https checkout', () => {
    const errors = commerceErrors({ ...OPEN_STORE, authorizingAdr: null, termsUrl: null });
    assert.ok(errors.some((e) => e.includes('authorizingAdr')));
    assert.ok(errors.some((e) => e.includes('termsUrl')));
    assert.ok(commerceErrors({ ...OPEN_STORE, plans: [] }).some((e) => e.includes('plan')));
    const insecure = { ...PRO, checkoutUrl: 'http://checkout.example.com/x' };
    assert.ok(
      commerceErrors({ ...OPEN_STORE, plans: [insecure] }).some((e) => e.includes('https')),
    );
    assert.deepEqual(commerceErrors(OPEN_STORE), []);
  });

  it('shows the settled prices and terms but no checkout while closed', () => {
    const html = renderPricing(commerce);
    const text = textContent(html);
    for (const price of SETTLED_PRICES) assert.ok(text.includes(price), `pricing lacks ${price}`);
    assert.match(text, /Purchase opens soon/);
    assert.match(text, /exclude any sales tax or VAT the payment provider adds at checkout/);
    assert.match(text, /Every version released during that year keeps working forever/);
    assert.match(text, /isn’t a subscription and it never renews automatically/);
    assert.match(text, /Up to 3 devices at a time/);
    assert.match(text, /Each desktop app installation or browser counts as one device/);
    assert.match(text, /free 30-day Pro trial\. No card needed/);
    assert.match(text, /only the Pro tools lock, and everything in Free keeps working/);
    assert.match(text, /A license never stops a job from running/);
    assert.match(text, /terms of sale will be published before sales open/);
    assert.doesNotMatch(html, /<form\b/i);
    assert.doesNotMatch(text, /\bBuy Pro\b/);
    const checkoutLinks = attrValues(html, 'a', 'href').filter((href) =>
      /checkout|paddle|\/buy/i.test(href),
    );
    assert.deepEqual(checkoutLinks, []);
  });

  it('never renders a checkout link while closed, even if one was pasted in early', () => {
    const html = renderPricing({ ...commerce, plans: [EARLY_CHECKOUT_PLAN] });
    assert.doesNotMatch(html, /checkout\.example\.com/);
    assert.match(textContent(html), /Purchase opens soon/);
  });

  it('renders each plan with its price and checkout link once open', () => {
    const html = renderPricing(OPEN_STORE);
    assert.match(textContent(html), /US\$49\.50/);
    assert.match(html, /href="https:\/\/checkout\.example\.com\/buy\/pro"/);
    assert.match(html, /href="\/terms\/"/);
    assert.match(html, /href="\/refunds\/"/);
    assert.doesNotMatch(textContent(html), /Purchase opens soon/);
  });

  it('formats whole and fractional prices as unambiguous US dollars', () => {
    assert.equal(formatPrice(20, 'USD'), 'US$20');
    assert.equal(formatPrice(49.5, 'USD'), 'US$49.50');
  });

  it('shows no price on the built site other than the settled ones', () => {
    const { outDir } = buildToTemp();
    let shown = 0;
    for (const { file, html } of builtPages(outDir)) {
      const prices = textContent(html).match(/(?:US)?[$€£]\s?\d[\d,]*(?:\.\d+)?/g) ?? [];
      for (const price of prices) {
        assert.ok(SETTLED_PRICES.includes(price), `${file} shows ${price}`);
        shown += 1;
      }
    }
    assert.ok(shown > 0, 'the settled prices appear on the built site');
  });
});
