// Pricing. KerfDesk is free to use today, and paid licenses are planned
// (commerce.config.mjs). While sales are closed this page shows the free offer
// beside a "paid licenses are planned" card, and no price. Once a commercial ADR
// opens sales, the configured license plans render beside the free card with
// their hosted checkout links and the planned card goes away. The hero, the
// description and the FAQ describe the closed store: revise them in the same
// change that opens sales.

import { button, faqList, pageHero, section } from '../lib/components.mjs';
import { formatPrice, visiblePlans } from '../lib/commerce.mjs';
import { html } from '../lib/html.mjs';
import { icon } from '../lib/icons.mjs';

const FREE_INCLUDES = [
  'The full app in Chrome, Edge and other Chromium browsers',
  'Early desktop Preview builds for Windows and macOS',
  'Every laser and CNC feature, with no paywall or license key',
  'No account, sign-in or activation',
  'No trial timer and no subscription',
];

function ticks(items) {
  return html`<ul class="ticks">
    ${items.map((item) => html`<li>${icon('check')}<span>${item}</span></li>`)}
  </ul>`;
}

function freePlan(site) {
  return html`<article class="plan plan--free">
    <h2 class="h3">KerfDesk</h2>
    <p class="plan__price">Free</p>
    <p>Everything KerfDesk does today, for everyone.</p>
    ${ticks(FREE_INCLUDES)} ${button(site.appUrl, 'Open the app')}
  </article>`;
}

// Shown only while sales are closed. No price, date or feature promise.
function licensesPlanned(site) {
  return html`<article class="plan" id="paid-licenses">
    <h2 class="h3">Paid licenses are planned</h2>
    <p>
      Paid licenses for KerfDesk are planned for the future. Prices, terms and timing aren’t set
      yet, and nothing is for sale today.
    </p>
    <p>
      There’s no mailing list to join. To follow news, watch the KerfDesk releases page on GitHub.
    </p>
    ${button(site.releasesUrl, 'Watch releases on GitHub', { variant: 'secondary' })}
  </article>`;
}

function paidPlan(plan, currency) {
  const cadence = plan.billing === 'yearly' ? 'per year' : 'one-time';
  return html`<article class="plan">
    <h2 class="h3">${plan.name}</h2>
    <p class="plan__price">${formatPrice(plan.price, currency)} <small>${cadence}</small></p>
    ${plan.summary && html`<p>${plan.summary}</p>`} ${ticks(plan.includes)}
    ${button(plan.checkoutUrl, `Buy ${plan.name}`)}
  </article>`;
}

function salesTerms(commerce) {
  return html`<p class="plans__terms">
    Checkout opens on our payment provider’s page. See the
    <a href="${commerce.termsUrl}">terms of sale</a> and
    <a href="${commerce.refundPolicyUrl}">refund policy</a>.
  </p>`;
}

function faq(site) {
  return [
    {
      id: 'free',
      question: 'Is KerfDesk really free?',
      answer:
        'Yes. Today the web app and the desktop Preview builds cost nothing, need no account and have no trial timer or subscription.',
    },
    {
      id: 'later',
      question: 'Will KerfDesk cost money later?',
      answer:
        'Paid licenses are planned for the future. What they include, what they cost and when they arrive aren’t decided yet, so there’s nothing to buy today.',
    },
    {
      id: 'your-copy',
      question: 'If licenses go on sale, what happens to the version I have?',
      answer: html`<p>
        Versions already released keep the terms they were released under.
        <a href="/license/">See the license details</a>.
      </p>`,
    },
    {
      id: 'new-versions',
      question: 'How do I hear about licenses and new versions?',
      answer: html`<p>
        There’s no mailing list to join. New desktop Previews are published on the
        <a href="${site.releasesUrl}">KerfDesk releases page on GitHub</a>, so watch it to follow
        news. The web app also shows an Update button in its status bar when a new version is ready.
      </p>`,
    },
  ];
}

export const page = {
  path: '/pricing/',
  nav: 'pricing',
  title: 'Pricing',
  description:
    'KerfDesk is free to use today, with every feature, no account and no subscription. Paid licenses are planned for later; nothing is for sale yet.',
  render: ({ site, commerce }) => {
    const plans = visiblePlans(commerce);
    return html`${pageHero({
      eyebrow: 'Pricing',
      title: 'Free to use today',
      lead: 'Every feature, in the browser and on the desktop, at no cost. No account, no trial timer, no subscription. Paid licenses are planned for later, and nothing is for sale yet.',
    })}
    ${section({
      content: html`<div class="plans">
          ${freePlan(site)} ${plans.length === 0 && licensesPlanned(site)}
          ${plans.map((plan) => paidPlan(plan, commerce.currency))}
        </div>
        ${plans.length > 0 && salesTerms(commerce)}`,
    })}
    ${section({
      tone: 'alt',
      narrow: true,
      eyebrow: 'Questions',
      title: 'About pricing and licenses',
      content: faqList(faq(site)),
    })}`;
  },
};
