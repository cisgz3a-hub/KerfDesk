// Pricing: the Free and Pro editions and the Pro license terms, as the owner
// settled them on 2026-09-29 (ADR-524 Amendment 1). Every price and term comes
// from commerce.config.mjs. The prices render while checkout is closed; a buy
// button renders only once `commerce.salesOpen` is true and the plan has its
// hosted checkout URL, so until then the Pro card says purchase opens soon.
// Refund terms are not written here: the terms of sale are published before
// sales open. The hero lead, the terms line and the FAQ follow `salesOpen`, but
// reread all of them in the change that opens checkout.

import { button, faqList, featureGrid, pageHero, section } from '../lib/components.mjs';
import { checkoutUrlFor, formatPrice } from '../lib/commerce.mjs';
import { html } from '../lib/html.mjs';
import { icon } from '../lib/icons.mjs';

function ticks(items) {
  return html`<ul class="ticks">
    ${items.map((item) => html`<li>${icon('check')}<span>${item}</span></li>`)}
  </ul>`;
}

function freePlan(commerce, site) {
  return html`<article class="plan plan--free" id="plan-free">
    <h2 class="h3">KerfDesk ${commerce.free.name}</h2>
    <p class="plan__price">Free <small>no time limit</small></p>
    <p>In the browser and on the desktop. No account, no card.</p>
    ${ticks(commerce.free.includes)} ${button(site.appUrl, 'Open the app')}
  </article>`;
}

function planFacts(plan) {
  return [
    'Includes one year of updates.',
    plan.deviceLimit && `Active on up to ${plan.deviceLimit} devices at a time.`,
    plan.trialDays && `Free ${plan.trialDays}-day trial on each device.`,
  ]
    .filter(Boolean)
    .join(' ');
}

function paidPlan(plan, commerce) {
  const cadence = plan.billing === 'yearly' ? 'per year' : 'one-time';
  const checkoutUrl = checkoutUrlFor(commerce, plan);
  return html`<article class="plan" id="plan-${plan.id}">
    <h2 class="h3">KerfDesk ${plan.name}</h2>
    <p class="plan__price">
      ${formatPrice(plan.price, commerce.currency)} <small>${cadence}</small>
    </p>
    ${plan.where && html`<p>In ${plan.where}.</p>`} ${plan.summary && html`<p>${plan.summary}</p>`}
    ${ticks(plan.includes)}
    <p class="plan__fine">${planFacts(plan)}</p>
    ${checkoutUrl
      ? button(checkoutUrl, `Buy ${plan.name}`)
      : html`<p class="plan__soon">Purchase opens soon</p>`}
  </article>`;
}

function termsLine(commerce) {
  const tax = html`Prices are in ${commerce.currency === 'USD' ? 'US dollars' : commerce.currency}
  and exclude any sales tax or VAT the payment provider adds at checkout.`;
  if (!commerce.salesOpen) {
    return html`<p class="plans__terms">
      ${tax} Purchase isn’t open yet: no payment provider is live, so there’s no checkout and
      nothing can be bought today. The terms of sale will be published before sales open.
    </p>`;
  }
  return html`<p class="plans__terms">
    ${tax} Checkout opens on our payment provider’s page. See the
    <a href="${commerce.termsUrl}">terms of sale</a> and
    <a href="${commerce.refundPolicyUrl}">refund policy</a>.
  </p>`;
}

// How a license works, from the plan's own terms.
function licenseTerms(plan, currency) {
  const cards = [
    {
      icon: 'receipt',
      title: 'Pay once',
      body: `A ${plan.name} license costs ${formatPrice(plan.price, currency)}, one time. It isn’t a subscription.`,
    },
    {
      icon: 'refresh-cw',
      title: 'A year of updates, then yours to keep',
      body: 'Every license includes one year of updates. Every version released during that year keeps working forever.',
    },
    plan.updateYearPrice && {
      icon: 'calendar-plus',
      title: 'More updates only if you want them',
      body: `After the year, ${formatPrice(plan.updateYearPrice, currency)} adds another year of updates. It’s optional, it isn’t a subscription and it never renews automatically.`,
    },
    plan.where && {
      icon: 'monitor',
      title: `${plan.name} is in the desktop app`,
      body: `${plan.name} works in ${plan.where}. KerfDesk in the browser is the Free edition.`,
    },
    plan.deviceLimit && {
      icon: 'monitor-smartphone',
      title: `Up to ${plan.deviceLimit} devices at a time`,
      body: 'Each installation of the desktop app counts as one device. To move the license, deactivate it on one device, then activate it on another.',
    },
    plan.trialDays && {
      icon: 'hourglass',
      title: `Try ${plan.name} free for ${plan.trialDays} days`,
      body: `Each device gets a free ${plan.trialDays}-day ${plan.name} trial. No card needed.`,
    },
    {
      icon: 'shield-check',
      title: 'Your jobs keep running',
      body: `A license never stops a job from running. When a trial ends, only the ${plan.name} tools lock, and everything in Free keeps working.`,
    },
  ].filter(Boolean);
  return section({
    id: 'how-pro-works',
    tone: 'alt',
    eyebrow: `${plan.name} license`,
    title: `How a ${plan.name} license works`,
    content: featureGrid(cards),
  });
}

function faq(commerce, plan) {
  const devices = plan?.deviceLimit ?? 3;
  return [
    !commerce.salesOpen && {
      id: 'buy-now',
      question: 'Can I buy Pro today?',
      answer:
        'Not yet. Purchase opens soon. No payment provider is live yet, so there’s no checkout and nothing can be bought today. The terms of sale will be published before sales open.',
    },
    {
      id: 'free-expire',
      question: 'Does the Free edition expire?',
      answer:
        'No. Free has no time limit, in the browser and on the desktop, and it needs no account or card.',
    },
    {
      id: 'trial-ends',
      question: 'What happens when my trial ends?',
      answer:
        'Only the Pro tools lock. Everything in Free keeps working, and a license never stops a job from running.',
    },
    {
      id: 'after-updates',
      question: 'What happens after my year of updates?',
      answer: html`<p>
        Your license keeps working. Every version released during your year of updates keeps working
        forever.
        ${plan?.updateYearPrice &&
        html`If you want newer versions, ${formatPrice(plan.updateYearPrice, commerce.currency)}
        adds another year of updates. It’s optional, it isn’t a subscription and it never renews
        automatically.`}
      </p>`,
    },
    plan?.where && {
      id: 'pro-browser',
      question: 'Can I use Pro in the browser?',
      answer: `No. ${plan.name} works in ${plan.where}. KerfDesk in the browser is the Free edition, with no time limit.`,
    },
    {
      id: 'devices',
      question: 'How many devices can I use Pro on?',
      answer: `Up to ${devices} at a time. Each installation of the desktop app counts as one device. To move the license, deactivate it on one device, then activate it on the other. In the desktop app, that’s under Help > Licence.`,
    },
    {
      id: 'tax',
      question: 'Do the prices include tax?',
      answer:
        'No. Prices are in US dollars and exclude any sales tax or VAT the payment provider adds at checkout.',
    },
    {
      id: 'refunds',
      question: 'What about refunds?',
      answer: commerce.salesOpen
        ? html`<p>See the <a href="${commerce.refundPolicyUrl}">refund policy</a>.</p>`
        : 'The terms of sale will be published before sales open, so you can read them before you buy.',
    },
    {
      id: 'your-copy',
      question: 'What about the version I have now?',
      answer: html`<p>
        Versions already released keep the terms they were released under.
        <a href="/license/">See the license details</a>.
      </p>`,
    },
  ].filter(Boolean);
}

export const page = {
  path: '/pricing/',
  nav: 'pricing',
  title: 'Pricing',
  description:
    'KerfDesk Free has no time limit. Pro adds advanced tools to the Windows desktop app for US$49.50, paid once, with a year of updates and a 30-day trial.',
  render: ({ site, commerce }) => {
    const [plan] = commerce.plans;
    const lead = [
      'KerfDesk Free runs in the browser and on the desktop, with no time limit.',
      plan &&
        `${plan.name} adds advanced tools${plan.where ? ` to ${plan.where}` : ''} for ${formatPrice(plan.price, commerce.currency)}, paid once.`,
      !commerce.salesOpen && 'Purchase opens soon.',
    ]
      .filter(Boolean)
      .join(' ');
    return html`${pageHero({ eyebrow: 'Pricing', title: 'Free and Pro', lead })}
    ${section({
      content: html`<div class="plans">
          ${freePlan(commerce, site)} ${commerce.plans.map((item) => paidPlan(item, commerce))}
        </div>
        ${termsLine(commerce)}`,
    })}
    ${plan && licenseTerms(plan, commerce.currency)}
    ${section({
      narrow: true,
      eyebrow: 'Questions',
      title: 'About pricing and licenses',
      content: faqList(faq(commerce, plan)),
    })}`;
  },
};
