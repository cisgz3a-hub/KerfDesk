// The pricing page that ships with the web app (ADR-524 Amendment 3). Every
// price and term comes from website/commerce.config.mjs, the same settled offer
// the product website shows, and the wording follows its `trialOpen` and
// `salesOpen` switches. Purchases start in the desktop app (ADR-524 Amendment
// 2), so the page never links a checkout.

import { commerce } from '../website/commerce.config.mjs';
import { assertValidCommerce, formatPrice } from '../website/lib/commerce.mjs';
import { site } from '../website/site.config.mjs';
import { escapeText } from './site-pages-markdown.mjs';

function list(items) {
  return `<ul>${items.map((item) => `<li>${escapeText(item)}</li>`).join('')}</ul>`;
}

function freePlan() {
  return `<section class="plan" aria-labelledby="plan-free">
<h2 id="plan-free">KerfDesk ${commerce.free.name}</h2>
<p class="price">Free <small>no time limit</small></p>
<p>In the browser and on the desktop, for personal or business work. No account, no card.</p>
${list(commerce.free.includes)}
<a class="action" href="/">Open the web app</a>
</section>`;
}

function proPlan(plan, price) {
  const trial = commerce.trialOpen ? '' : ' once the desktop app is released';
  const action = commerce.salesOpen
    ? `<p class="fine">Buy ${plan.name} inside the desktop app, from Help &gt; Licence.</p>
<a class="action" href="/download.html">Get the desktop app</a>`
    : '<p class="soon">Purchase opens soon</p>';
  return `<section class="plan" aria-labelledby="plan-${plan.id}">
<h2 id="plan-${plan.id}">KerfDesk ${plan.name}</h2>
<p class="price">${price} <small>one-time</small></p>
<p>In ${plan.where}. ${plan.summary}</p>
${list(plan.includes)}
<p class="fine">Includes one year of updates. Active on up to ${plan.deviceLimit} devices at a time. Free ${plan.trialDays}-day trial on each device${trial}.</p>
${action}
</section>`;
}

function howItWorks(plan, price, updateYear) {
  const trialStart = commerce.trialOpen ? 'Each' : 'Once the desktop app is released, each';
  return `<h2 id="how-pro-works">How a ${plan.name} licence works</h2>
<ul>
<li><strong>Pay once.</strong> A ${plan.name} licence costs ${price}, one time. It is not a subscription.</li>
<li><strong>A year of updates, then yours to keep.</strong> Every licence includes one year of updates. Every version released during that year keeps working forever.</li>
<li><strong>More updates only if you want them.</strong> After the year, ${updateYear} adds another year of updates. It is optional, it is not a subscription and it never renews automatically.</li>
<li><strong>Up to ${plan.deviceLimit} devices at a time.</strong> Each installation of the desktop app counts as one device. To move the licence, deactivate it on one device, then activate it on another.</li>
<li><strong>Try ${plan.name} free for ${plan.trialDays} days.</strong> ${trialStart} device gets a free ${plan.trialDays}-day ${plan.name} trial. No card needed.</li>
<li><strong>Your jobs keep running.</strong> A licence never stops a job from running. When a trial ends, only the ${plan.name} tools lock, and everything in Free keeps working.</li>
</ul>`;
}

function buying(plan) {
  const how = commerce.salesOpen
    ? `Buy ${plan.name} inside the KerfDesk desktop app, from Help &gt; Licence. Paddle, our reseller and merchant of record, takes the payment, adds any sales tax or VAT that applies where you live, and emails your receipt.`
    : `Purchase is not open yet, so nothing can be bought today. When it opens, you will buy ${plan.name} inside the KerfDesk desktop app, from Help &gt; Licence, and Paddle, our reseller and merchant of record, will take the payment, add any sales tax or VAT that applies where you live, and email your receipt.`;
  return `<h2 id="buying">Buying ${plan.name}</h2>
<p>${how}</p>
<p>Prices are in US dollars and exclude sales tax and VAT. The <a href="/terms/">Terms of Service</a> and the <a href="/refunds/">Refund Policy</a> apply to every purchase, and the <a href="/privacy/">Privacy Policy</a> explains what a trial, a licence and a purchase share with us.</p>`;
}

export function pricingPage() {
  assertValidCommerce(commerce);
  const [plan] = commerce.plans;
  const price = formatPrice(plan.price, commerce.currency);
  const updateYear = formatPrice(plan.updateYearPrice, commerce.currency);
  const body = `<h1>KerfDesk pricing</h1>
<p class="lead">${escapeText(site.description)}</p>
<p>KerfDesk Free has no time limit. ${plan.name} adds advanced tools to ${plan.where} for ${price}, paid once.</p>
<div class="plans">
${freePlan()}
${proPlan(plan, price)}
</div>
${howItWorks(plan, price, updateYear)}
${buying(plan)}`;
  return {
    path: '/pricing/',
    title: 'Pricing',
    description: `KerfDesk Free has no time limit. Pro adds advanced tools to the Windows desktop app for ${price}, paid once, with a year of updates.`,
    body,
    sources: ['website/commerce.config.mjs'],
  };
}
