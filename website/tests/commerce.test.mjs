// The store ships closed (ADR-247) and can only open fully configured.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { commerce } from '../commerce.config.mjs';
import { commerceErrors, formatPrice, visiblePlans } from '../lib/commerce.mjs';
import { page as pricing } from '../pages/pricing.mjs';
import { site } from '../site.config.mjs';
import { buildToTemp, builtPages, textContent } from './helpers.mjs';

const DRAFT_PLAN = {
  id: 'desktop-pro',
  name: 'Desktop Pro',
  price: 99,
  billing: 'one-time',
  summary: 'Signed desktop builds and a year of updates.',
  includes: ['Signed Windows and macOS installers'],
  checkoutUrl: 'https://checkout.example.com/buy/desktop-pro',
};

const OPEN_STORE = {
  salesOpen: true,
  authorizingAdr: 'ADR-999',
  currency: 'USD',
  termsUrl: '/terms/',
  refundPolicyUrl: '/refunds/',
  plans: [DRAFT_PLAN],
};

function renderPricing(store) {
  return String(pricing.render({ site, commerce: store, siteUrl: null, asset: (p) => `/${p}` }));
}

describe('commerce configuration', () => {
  it('ships with sales closed until a commercial ADR authorizes them (ADR-247)', () => {
    assert.equal(
      commerce.salesOpen,
      false,
      'Opening sales needs the lawyer-reviewed commercial ADR ADR-247 requires; update this test in that same change.',
    );
    assert.equal(commerce.authorizingAdr, null);
    assert.deepEqual(visiblePlans(commerce), []);
    assert.deepEqual(commerceErrors(commerce), []);
  });

  it('refuses to open a store without an ADR, policies, plans and https checkout', () => {
    const errors = commerceErrors({ ...OPEN_STORE, authorizingAdr: null, termsUrl: null });
    assert.ok(errors.some((e) => e.includes('authorizingAdr')));
    assert.ok(errors.some((e) => e.includes('termsUrl')));
    assert.ok(commerceErrors({ ...OPEN_STORE, plans: [] }).some((e) => e.includes('plan')));
    const insecure = { ...DRAFT_PLAN, checkoutUrl: 'http://checkout.example.com/x' };
    assert.ok(
      commerceErrors({ ...OPEN_STORE, plans: [insecure] }).some((e) => e.includes('https')),
    );
    assert.deepEqual(commerceErrors(OPEN_STORE), []);
  });

  it('never renders draft plans, prices or checkout links while closed', () => {
    const closedWithDrafts = { ...OPEN_STORE, salesOpen: false, authorizingAdr: null };
    const html = renderPricing(closedWithDrafts);
    assert.doesNotMatch(html, /Desktop Pro/);
    assert.doesNotMatch(html, /checkout\.example\.com/);
    assert.doesNotMatch(textContent(html), /\$\s?\d/);
  });

  it('renders each plan with its price and checkout link once open', () => {
    const html = renderPricing(OPEN_STORE);
    assert.match(html, /Desktop Pro/);
    assert.match(html, new RegExp(formatPrice(99, 'USD').replace('$', '\\$')));
    assert.match(html, /href="https:\/\/checkout\.example\.com\/buy\/desktop-pro"/);
    assert.match(html, /href="\/terms\/"/);
    assert.match(html, /href="\/refunds\/"/);
  });

  it('formats whole and fractional prices', () => {
    assert.equal(formatPrice(99, 'USD'), '$99');
    assert.equal(formatPrice(49.5, 'USD'), '$49.50');
  });

  it('shows no price anywhere on the built site while sales are closed', () => {
    const { outDir } = buildToTemp();
    for (const { file, html } of builtPages(outDir)) {
      assert.doesNotMatch(textContent(html), /[$€£]\s?\d/, `${file} shows a price`);
    }
  });
});
