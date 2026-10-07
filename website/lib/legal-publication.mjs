// Confirmed public licensor facts, source readiness and separate disclosure work.
// Content publication does not establish statutory or live-sales compliance.
import { legalPublication } from '../legal-publication.config.mjs';
import { html } from './html.mjs';

export function publicationBlockers(publication = legalPublication) {
  const blockers = [];
  const seller = publication.seller ?? {};
  for (const [field, label] of [
    ['legalName', 'Formal licensor name'],
    ['legalForm', 'Licensor legal form'],
    ['tradingAs', 'Trading name'],
    ['country', 'Licensor country'],
    ['supportEmail', 'Public support email'],
  ]) {
    if (typeof seller[field] !== 'string' || !seller[field].trim())
      blockers.push(label + ' is unresolved.');
  }
  if (typeof seller.vatRegistered !== 'boolean') blockers.push('VAT status is unresolved.');
  const date = publication.informationDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !Number.isFinite(Date.parse(date)))
    blockers.push('Public information date is unresolved.');
  return blockers;
}

export function publicationReviewQuestions() {
  return {
    statutory: [
      'Determine the applicable ECTA supplier disclosure scope for the KerfDesk licensor alongside Paddle resale, and the required authorised public contact arrangement.',
      'Determine the applicable POPIA responsible-party address/notification and international-transfer arrangements for actual processing; factual publication is not compliance certification.',
    ],
    liveSales: [
      'Checkout and new trials stay closed. Opening them needs separately authorised launch and provider, licensed-build, delivery and refund qualification.',
    ],
    paia: [
      'Complete the separate PAIA contact and inspection arrangements and any required Information Officer registration before describing the draft manual as effective.',
    ],
  };
}

export function publicSellerContact({ privacy = false, publication = legalPublication } = {}) {
  const seller = publication.seller;
  if (!seller.legalName || !seller.legalForm || !seller.country || !seller.supportEmail)
    throw new Error('Known public licensor facts are incomplete.');
  return html`<div class="prose">
    <p>
      KerfDesk is made and licensed by ${seller.legalName}, a ${seller.legalForm} trading as
      ${seller.tradingAs}, in ${seller.country}.
    </p>
    <p>
      ${privacy
        ? 'He is responsible for the personal information KerfDesk handles. To request access, correction or deletion, or to ask a privacy question, email '
        : 'For software and licence help, email '}
      <a href="mailto:${seller.supportEmail}">${seller.supportEmail}</a>. Email is our primary
      support route.
    </p>
    ${!privacy &&
    html`<p>
      The proprietor is not VAT-registered. Paddle is the chosen authorised reseller and merchant of
      record for purchases. Paid checkout remains closed; applicable taxes and the total will be
      shown before a future payment.
    </p>`}
    <nav aria-label="Payment information">
      <a href="/pricing/">Pricing</a> · <a href="/terms/">Software terms</a> ·
      <a href="/refunds/">Refund Policy</a> · <a href="/privacy/">Privacy</a>
    </nav>
  </div>`;
}
