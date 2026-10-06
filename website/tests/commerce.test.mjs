// The owner's settled Free and Pro offer is shown (ADR-524 Amendment 1), while
// checkout ships closed and can only open fully configured (ADR-247). Purchases
// start in the desktop app, so the site never links a checkout, and the trial
// is promised for when the desktop app is released (ADR-524 Amendment 2).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { commerce } from '../commerce.config.mjs';
import { commerceErrors, formatPrice } from '../lib/commerce.mjs';
import { page as pricing } from '../pages/pricing.mjs';
import { site } from '../site.config.mjs';
import { attrValues, buildToTemp, builtPages, textContent } from './helpers.mjs';

const PRO = commerce.plans.find((plan) => plan.id === 'pro');
// Every price the site may show, as formatPrice writes it.
const SETTLED_PRICES = ['US$49.50', 'US$20'];

const CHECKOUT_PLAN = { ...PRO, checkoutUrl: 'https://checkout.example.com/buy/pro' };

const TRIAL_STORE = { ...commerce, trialOpen: true };

const OPEN_STORE = {
  ...TRIAL_STORE,
  salesOpen: true,
  authorizingAdr: 'ADR-999',
  termsUrl: '/terms/',
  refundPolicyUrl: '/refunds/',
};

function checkoutLinks(html) {
  return attrValues(html, 'a', 'href').filter((href) => /checkout|paddle|\/buy/i.test(href));
}

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
      'Line Art tracing',
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
    assert.equal(PRO.where, 'the Windows desktop app', 'Pro is desktop only (ADR-540 item 7)');
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

  it('ships with the trial and checkout closed until the desktop app and a payment provider are live', () => {
    assert.equal(
      commerce.trialOpen,
      false,
      'The trial opens once the licensed Windows app is on the download page and the licence service is on; update this test in that same change.',
    );
    assert.equal(
      commerce.salesOpen,
      false,
      'Opening checkout needs a live payment provider, published terms of sale and the commercial ADR ADR-247 requires; update this test in that same change.',
    );
    assert.equal(commerce.authorizingAdr, null);
    assert.equal(commerce.termsUrl, null);
    assert.equal(commerce.refundPolicyUrl, null);
    for (const plan of commerce.plans) assert.ok(!('checkoutUrl' in plan), plan.id);
    assert.deepEqual(commerceErrors(commerce), []);
  });

  // The licence service fulfils only the Paddle checkouts it creates for the
  // desktop app (ADR-523): a payment link would take money without a license.
  it('refuses a checkout URL whether sales are open or closed', () => {
    for (const store of [commerce, OPEN_STORE]) {
      const errors = commerceErrors({ ...store, plans: [CHECKOUT_PLAN] });
      assert.ok(
        errors.some((e) => e.includes('purchases start in the desktop app')),
        errors.join('; '),
      );
    }
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

  it('refuses to open a store without an ADR, policies, plans and the desktop app out', () => {
    const errors = commerceErrors({ ...OPEN_STORE, authorizingAdr: null, termsUrl: null });
    assert.ok(errors.some((e) => e.includes('authorizingAdr')));
    assert.ok(errors.some((e) => e.includes('termsUrl')));
    assert.ok(commerceErrors({ ...OPEN_STORE, plans: [] }).some((e) => e.includes('plan')));
    assert.ok(
      commerceErrors({ ...OPEN_STORE, trialOpen: false }).some((e) => e.includes('trialOpen')),
    );
    assert.ok(
      commerceErrors({ ...commerce, trialOpen: undefined }).some((e) => e.includes('trialOpen')),
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
    assert.match(text, /Each installation of the desktop app counts as one device/);
    assert.match(text, /In the Windows desktop app\./);
    assert.match(
      text,
      /All Pro features are in the desktop app V-carve, 3D relief, Adaptive clearing, Advanced tracing, Camera alignment, Box generator, Design Studio and G-code Inspector are in KerfDesk Pro, which comes with the Windows desktop app\. KerfDesk in the browser is the Free edition/,
    );
    assert.match(text, /Can I use Pro in the browser\? No\. Pro works in the Windows desktop app/);
    assert.doesNotMatch(text, /browser counts as (?:one|a) device/);
    assert.match(
      text,
      /Once the desktop app is released, each device gets a free 30-day Pro trial\. No card needed/,
    );
    assert.match(text, /Free 30-day trial on each device once the desktop app is released\./);
    assert.match(
      text,
      /Can I try Pro today\? Not yet\. Pro comes with the Windows desktop app, which isn’t released yet\./,
    );
    assert.match(
      text,
      /The desktop app with Pro isn’t released yet; the download page will have it/,
    );
    assert.match(text, /only the Pro tools lock, and everything in Free keeps working/);
    assert.match(text, /A license never stops a job from running/);
    assert.match(text, /terms of sale will be published before sales open/);
    assert.doesNotMatch(html, /<form\b/i);
    assert.doesNotMatch(text, /\bBuy Pro\b/);
    assert.doesNotMatch(text, /Get the desktop app/);
    assert.deepEqual(checkoutLinks(html), []);
  });

  it('never renders a checkout link, even if one was pasted in', () => {
    for (const store of [commerce, OPEN_STORE]) {
      const html = renderPricing({ ...store, plans: [CHECKOUT_PLAN] });
      assert.doesNotMatch(html, /checkout\.example\.com/);
    }
  });

  it('links the desktop app for the trial once it is out, with purchase still closed', () => {
    const html = renderPricing(TRIAL_STORE);
    const text = textContent(html);
    assert.match(text, /Get the desktop app Purchase opens soon\./);
    assert.match(text, /Each device gets a free 30-day Pro trial\. No card needed/);
    assert.doesNotMatch(text, /once the desktop app is released|Can I try Pro today/);
    assert.doesNotMatch(text, /\bBuy Pro\b/);
  });

  it('sends buyers to the desktop app once sales open, never to a checkout', () => {
    const html = renderPricing(OPEN_STORE);
    const text = textContent(html);
    assert.match(text, /US\$49\.50/);
    assert.match(html, /href="\/download\/"/);
    assert.match(text, /Buy Pro inside the app, from Help &gt; Licence\./);
    assert.deepEqual(checkoutLinks(html), []);
    assert.match(html, /href="\/terms\/"/);
    assert.match(html, /href="\/refunds\/"/);
    assert.doesNotMatch(text, /Purchase opens soon/);
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
